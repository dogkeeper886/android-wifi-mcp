import { AdbClient } from '../adb/adb-client.js';
import {
  PingResult,
  DnsResult,
  ConnectivityResult,
  CaptivePortalResult,
} from '../types.js';

export class NetworkCheck {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  /**
   * Ping a host from the device
   */
  async ping(host: string, count: number = 4): Promise<PingResult> {
    const result = await this.adb.shell(`ping -c ${count} -W 5 ${shQuote(host)}`);

    const pingResult: PingResult = {
      host,
      alive: false,
      output: result.stdout || result.stderr,
    };

    if (result.success) {
      // Parse ping output
      pingResult.alive = !result.stdout.includes('100% packet loss');

      // Extract average time
      const timeMatch = result.stdout.match(/avg[^=]*=\s*[\d.]+\/([\d.]+)/);
      if (timeMatch) {
        pingResult.time = parseFloat(timeMatch[1]);
      }

      // Extract packet loss
      const lossMatch = result.stdout.match(/(\d+)%\s*packet loss/);
      if (lossMatch) {
        pingResult.packetLoss = parseInt(lossMatch[1], 10);
      }
    }

    return pingResult;
  }

  /**
   * Resolve a hostname from the device.
   *
   * Modern Android ships no `nslookup`/`getent` (only ping/nc/toybox), so the
   * old multi-tool fallback chain always fell through to ping anyway. We resolve
   * directly with `ping -c 1`, which prints the resolved address as
   * `PING host (1.2.3.4)`. IPv4 only, matching the prior behavior.
   */
  async dnsLookup(hostname: string): Promise<DnsResult> {
    const dnsResult: DnsResult = {
      hostname,
      addresses: [],
    };

    const result = await this.adb.shell(`ping -c 1 -W 2 ${shQuote(hostname)}`);
    const match = result.stdout.match(/\(([0-9.]+)\)/);
    if (match) {
      dnsResult.addresses.push(match[1]);
    }

    if (dnsResult.addresses.length === 0) {
      dnsResult.error = 'DNS lookup failed';
    }

    return dnsResult;
  }

  /**
   * Check internet connectivity.
   *
   * The old implementation probed HTTP endpoints with `curl`, which doesn't
   * exist on modern Android (it only ever worked via the ping fallback). We
   * prefer Android's own `VALIDATED` verdict — the result of its connectivity
   * validation, the same signal #76 uses for captive detection — and fall back
   * to a `ping` when no validated Wi-Fi network is present.
   */
  async checkInternet(): Promise<ConnectivityResult> {
    const dump = await this.adb.shell('dumpsys connectivity');
    if (dump.success) {
      const agentLine = findActiveWifiAgentLine(dump.stdout);
      if (agentLine && parseCapabilities(agentLine).includes('VALIDATED')) {
        return {
          hasInternet: true,
          endpoint: 'android-connectivity (VALIDATED)',
        };
      }
    }

    // Fallback: a network without VALIDATED (or non-Wi-Fi) may still reach the
    // internet — confirm with a ping.
    const pingResult = await this.ping('8.8.8.8', 1);
    if (pingResult.alive) {
      return {
        hasInternet: true,
        latency: pingResult.time,
        endpoint: '8.8.8.8 (ping)',
      };
    }

    return {
      hasInternet: false,
      error: 'No VALIDATED network and 8.8.8.8 is unreachable',
    };
  }

  /**
   * Check for a captive portal using Android's own network validation.
   *
   * The previous implementation shelled out to `curl`, but modern Android
   * images ship no HTTP client (no curl/wget — only ping/nc/toybox). Every
   * call therefore failed with exit 127 and returned a false `isCaptive:false`
   * on *every* network, captive or not (#76). Instead we read the verdict that
   * Android's ConnectivityService already computed — the same one that raises
   * the "Sign in to Wi-Fi network" notification — from `dumpsys connectivity`.
   */
  async checkCaptivePortal(): Promise<CaptivePortalResult> {
    const dump = await this.adb.shell('dumpsys connectivity');
    if (!dump.success) {
      return {
        isCaptive: false,
        status: 'unknown',
        error: 'Failed to read connectivity state (dumpsys connectivity)',
      };
    }

    const agentLine = findActiveWifiAgentLine(dump.stdout);
    if (agentLine === null) {
      return {
        isCaptive: false,
        status: 'unknown',
        error: 'No connected Wi-Fi network found',
      };
    }

    const caps = parseCapabilities(agentLine);

    if (caps.includes('CAPTIVE_PORTAL')) {
      return {
        isCaptive: true,
        status: 'captive',
        portalUrl: extractPortalUrl(agentLine),
      };
    }

    if (caps.includes('VALIDATED')) {
      return { isCaptive: false, status: 'open' };
    }

    // Connected but neither captive nor validated yet — partial/limbo. Report
    // 'unknown' rather than 'open' so callers don't read it as a clean pass.
    return {
      isCaptive: false,
      status: 'unknown',
      error: 'Network connected but not yet validated (no captive-portal flag)',
    };
  }

  /**
   * Get network interface information.
   *
   * The old version hardcoded `wlan0` (DOWN on devices that use `wlan1`) and
   * read DNS from `getprop net.dns*` (empty on modern Android), so it returned
   * nothing useful. We read the active Wi-Fi network's LinkProperties from
   * `dumpsys connectivity` (one call → interface, IPv4, gateway, DNS) and fall
   * back to the routing table (`ip route get 8.8.8.8`) to fill any gaps or
   * cover the no-Wi-Fi-agent case.
   */
  async getInterfaceInfo(): Promise<{
    interface: string;
    ipAddress?: string;
    gateway?: string;
    dns?: string[];
  }> {
    const result: {
      interface: string;
      ipAddress?: string;
      gateway?: string;
      dns?: string[];
    } = {
      interface: 'unknown',
    };

    const dump = await this.adb.shell('dumpsys connectivity');
    const agentLine = dump.success ? findActiveWifiAgentLine(dump.stdout) : null;
    if (agentLine) {
      const iface = parseInterfaceName(agentLine);
      if (iface) result.interface = iface;
      const ip = parseIpv4LinkAddress(agentLine);
      if (ip) result.ipAddress = ip;
      const gw = parseGateway(agentLine);
      if (gw) result.gateway = gw;
      const dns = parseDnsAddresses(agentLine);
      if (dns.length > 0) result.dns = dns;
    }

    // Fill gaps from the routing table. `ip route get 8.8.8.8` resolves the
    // outgoing route (dev/src/via) regardless of whether the target is
    // reachable, so it works pre-auth and on non-wlan0 interfaces.
    if (result.interface === 'unknown' || !result.ipAddress || !result.gateway) {
      const route = await this.adb.shell('ip route get 8.8.8.8');
      if (route.success) {
        const r = parseRouteGet(route.stdout);
        if (result.interface === 'unknown' && r.interface) result.interface = r.interface;
        if (!result.ipAddress && r.ipAddress) result.ipAddress = r.ipAddress;
        if (!result.gateway && r.gateway) result.gateway = r.gateway;
      }
    }

    return result;
  }
}

/**
 * Single-quote a string for safe interpolation into a device `adb shell`
 * command (the host side uses execFile, but the device runs the string in sh).
 */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Find the `NetworkAgentInfo` line for the device's Wi-Fi network in
 * `dumpsys connectivity` output (each agent prints on one line). Prefers the
 * agent whose id matches the `Active default network: N` header — important
 * when several networks are briefly connected at once, e.g. during a Wi-Fi
 * handover (the captive→post-auth transition this tool exists for) or a
 * primary + restricted/guest pair, where the *first* WIFI agent is not
 * necessarily the one carrying the live verdict. Falls back to the first
 * connected Wi-Fi agent (covers the case where the default network is
 * cellular because Wi-Fi failed validation). Returns null if none found.
 *
 * Pure function — exported for unit testing.
 */
export function findActiveWifiAgentLine(dump: string): string | null {
  const lines = dump.split('\n');
  const isConnectedWifi = (line: string): boolean =>
    line.includes('NetworkAgentInfo') && /ni\{WIFI CONNECTED/.test(line);

  const def = dump.match(/Active default network:\s*(\d+)/);
  if (def) {
    const marker = `NetworkAgentInfo{network{${def[1]}}`;
    for (const line of lines) {
      if (line.includes(marker) && isConnectedWifi(line)) return line;
    }
  }
  for (const line of lines) {
    if (isConnectedWifi(line)) return line;
  }
  return null;
}

/**
 * Parse the NetworkCapabilities token list out of a NetworkAgentInfo line,
 * e.g. `... nc{[ ... Capabilities: NOT_METERED&INTERNET&VALIDATED&... ]}`.
 * Returns the tokens split on `&` so callers match exactly (a substring test
 * would conflate a token with a longer one). Empty array if none found.
 *
 * Pure function — exported for unit testing.
 */
export function parseCapabilities(agentLine: string): string[] {
  const m = agentLine.match(/Capabilities:\s*([A-Za-z_&]+)/);
  return m ? m[1].split('&') : [];
}

/**
 * Best-effort extraction of a captive-portal URL from a single
 * NetworkAgentInfo line (Android exposes it via CaptivePortalData when
 * present). Scoped to the agent line — not the whole dump — so it can't pick
 * up an unrelated URL elsewhere in the output. Returns undefined when no URL
 * is advertised, which is common since many portals only redirect.
 *
 * Pure function — exported for unit testing.
 */
export function extractPortalUrl(agentLine: string): string | undefined {
  const m = agentLine.match(
    /(?:userPortalUrl|CaptivePortalApiUrl|venueInfoUrl|redirectUrl)=([^\s,}\]]+)/
  );
  return m && m[1] && m[1] !== 'null' ? m[1] : undefined;
}

/**
 * Parse the interface name from a NetworkAgentInfo line's LinkProperties,
 * e.g. `lp{{InterfaceName: wlan1 LinkAddresses: [...] ...}}`. Undefined if absent.
 *
 * Pure function — exported for unit testing.
 */
export function parseInterfaceName(agentLine: string): string | undefined {
  const m = agentLine.match(/InterfaceName:\s*(\S+)/);
  return m ? m[1] : undefined;
}

/**
 * Pick the IPv4 address out of `LinkAddresses: [ fe80::.../64,192.168.6.133/24 ]`.
 * Skips IPv6 entries. Undefined if no IPv4 link address is present.
 *
 * Pure function — exported for unit testing.
 */
export function parseIpv4LinkAddress(agentLine: string): string | undefined {
  const block = agentLine.match(/LinkAddresses:\s*\[([^\]]*)\]/);
  if (!block) return undefined;
  for (const addr of block[1].split(',')) {
    const v4 = addr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/\d+$/);
    if (v4) return v4[1];
  }
  return undefined;
}

/**
 * Parse `DnsAddresses: [ /192.168.6.1, /8.8.8.8 ]` into a list of IPv4 strings
 * (leading `/` stripped, IPv6 skipped). Empty array if absent.
 *
 * Pure function — exported for unit testing.
 */
export function parseDnsAddresses(agentLine: string): string[] {
  const block = agentLine.match(/DnsAddresses:\s*\[([^\]]*)\]/);
  if (!block) return [];
  return block[1]
    .split(',')
    .map(s => s.trim().replace(/^\//, ''))
    .filter(s => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s));
}

/**
 * Parse the gateway from a LinkProperties `ServerAddress: /192.168.6.1`.
 * Undefined if absent.
 *
 * Pure function — exported for unit testing.
 */
export function parseGateway(agentLine: string): string | undefined {
  const m = agentLine.match(/ServerAddress:\s*\/?(\d{1,3}(?:\.\d{1,3}){3})/);
  return m ? m[1] : undefined;
}

/**
 * Parse `ip route get 8.8.8.8` output, e.g.
 * `8.8.8.8 via 192.168.6.1 dev wlan1 table 1048 src 192.168.6.133 uid 2000`.
 * Returns whichever of interface/ipAddress/gateway are present.
 *
 * Pure function — exported for unit testing.
 */
export function parseRouteGet(output: string): {
  interface?: string;
  ipAddress?: string;
  gateway?: string;
} {
  const res: { interface?: string; ipAddress?: string; gateway?: string } = {};
  const dev = output.match(/\bdev\s+(\S+)/);
  if (dev) res.interface = dev[1];
  const src = output.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})/);
  if (src) res.ipAddress = src[1];
  const via = output.match(/\bvia\s+(\d{1,3}(?:\.\d{1,3}){3})/);
  if (via) res.gateway = via[1];
  return res;
}
