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
   * Check for captive portal
   */
  async checkCaptivePortal(): Promise<CaptivePortalResult> {
    // Android's captive portal detection URL
    const captiveCheckUrl = 'http://connectivitycheck.gstatic.com/generate_204';

    const result = await this.adb.shell(
      `curl -s -o /dev/null -w "%{http_code}\\n%{redirect_url}" --connect-timeout 5 --max-time 10 -L "${captiveCheckUrl}"`
    );

    if (!result.success) {
      return {
        isCaptive: false,
        error: 'Failed to check captive portal',
      };
    }

    const lines = result.stdout.trim().split('\n');
    const httpCode = parseInt(lines[0], 10);
    const redirectUrl = lines[1] || '';

    // 204 = No captive portal
    if (httpCode === 204) {
      return {
        isCaptive: false,
      };
    }

    // 301/302 with redirect = Captive portal
    if ((httpCode === 301 || httpCode === 302) && redirectUrl) {
      return {
        isCaptive: true,
        portalUrl: redirectUrl,
      };
    }

    // 200 with different content = Captive portal serving a page
    if (httpCode === 200) {
      // Get actual content to see if it's a portal
      const contentResult = await this.adb.shell(
        `curl -s --connect-timeout 5 --max-time 10 "${captiveCheckUrl}" | head -c 200`
      );

      if (contentResult.success && contentResult.stdout.length > 0) {
        // If we got content, it's likely a captive portal
        return {
          isCaptive: true,
          portalUrl: captiveCheckUrl,
        };
      }
    }

    return {
      isCaptive: false,
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
