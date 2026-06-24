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
    const result = await this.adb.shell(`ping -c ${count} -W 5 ${host}`);

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
   * Perform DNS lookup from the device
   */
  async dnsLookup(hostname: string): Promise<DnsResult> {
    // Try nslookup first
    let result = await this.adb.shell(`nslookup ${hostname}`);

    const dnsResult: DnsResult = {
      hostname,
      addresses: [],
    };

    if (result.success) {
      // Parse nslookup output
      const lines = result.stdout.split('\n');
      let inAnswer = false;

      for (const line of lines) {
        if (line.includes('Name:')) {
          inAnswer = true;
        }
        if (inAnswer) {
          const addrMatch = line.match(/Address(?:\s+\d)?:\s*([0-9.]+|[0-9a-f:]+)/i);
          if (addrMatch && !addrMatch[1].includes(':')) {
            // Skip IPv6 for now, just get IPv4
            dnsResult.addresses.push(addrMatch[1]);
          }
        }
      }
    }

    // If nslookup didn't work, try getent
    if (dnsResult.addresses.length === 0) {
      result = await this.adb.shell(`getent hosts ${hostname}`);
      if (result.success) {
        const match = result.stdout.match(/^([0-9.]+)/);
        if (match) {
          dnsResult.addresses.push(match[1]);
        }
      }
    }

    // If still no results, try ping with count 1 to get IP
    if (dnsResult.addresses.length === 0) {
      result = await this.adb.shell(`ping -c 1 ${hostname}`);
      if (result.success) {
        const match = result.stdout.match(/\(([0-9.]+)\)/);
        if (match) {
          dnsResult.addresses.push(match[1]);
        }
      }
    }

    if (dnsResult.addresses.length === 0) {
      dnsResult.error = 'DNS lookup failed';
    }

    return dnsResult;
  }

  /**
   * Check internet connectivity
   */
  async checkInternet(): Promise<ConnectivityResult> {
    const testUrls = [
      { url: 'https://www.google.com/generate_204', expected: 204 },
      { url: 'https://connectivitycheck.gstatic.com/generate_204', expected: 204 },
      { url: 'https://www.cloudflare.com/cdn-cgi/trace', expected: 200 },
    ];

    for (const test of testUrls) {
      const startTime = Date.now();
      const result = await this.adb.shell(
        `curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "${test.url}"`
      );
      const latency = Date.now() - startTime;

      if (result.success) {
        const httpCode = parseInt(result.stdout.trim(), 10);
        if (httpCode === test.expected || (httpCode >= 200 && httpCode < 400)) {
          return {
            hasInternet: true,
            latency,
            endpoint: test.url,
          };
        }
      }
    }

    // Try a simple ping as fallback
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
      error: 'Failed to reach any internet endpoints',
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
   * Get network interface information
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
      interface: 'wlan0',
    };

    // Get IP address
    const ipResult = await this.adb.shell('ip addr show wlan0 | grep "inet "');
    if (ipResult.success) {
      const match = ipResult.stdout.match(/inet\s+([0-9.]+)/);
      if (match) {
        result.ipAddress = match[1];
      }
    }

    // Get gateway
    const gwResult = await this.adb.shell('ip route | grep default');
    if (gwResult.success) {
      const match = gwResult.stdout.match(/via\s+([0-9.]+)/);
      if (match) {
        result.gateway = match[1];
      }
    }

    // Get DNS servers
    const dnsResult = await this.adb.shell('getprop net.dns1 && getprop net.dns2');
    if (dnsResult.success) {
      const dnsServers = dnsResult.stdout.split('\n').filter(line => line.trim());
      if (dnsServers.length > 0) {
        result.dns = dnsServers;
      }
    }

    return result;
  }
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
