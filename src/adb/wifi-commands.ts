import { AdbClient } from './adb-client.js';
import {
  ScanResult,
  SavedNetwork,
  WifiStatus,
  WifiConnectionResult,
  SecurityType,
} from '../types.js';

export class WifiCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  /**
   * Check if WiFi is enabled
   */
  async isEnabled(): Promise<boolean> {
    const result = await this.adb.shell('cmd wifi status');
    if (!result.success) {
      throw new Error(`Failed to get WiFi status: ${result.stderr}`);
    }
    return result.stdout.toLowerCase().includes('wifi is enabled');
  }

  /**
   * Enable or disable WiFi
   */
  async setEnabled(enabled: boolean): Promise<void> {
    const state = enabled ? 'enabled' : 'disabled';
    const result = await this.adb.shell(`cmd wifi set-wifi-enabled ${state}`);
    if (!result.success) {
      throw new Error(`Failed to ${enabled ? 'enable' : 'disable'} WiFi: ${result.stderr}`);
    }
  }

  /**
   * Start a WiFi scan
   */
  async startScan(): Promise<void> {
    const result = await this.adb.shell('cmd wifi start-scan');
    if (!result.success) {
      throw new Error(`Failed to start scan: ${result.stderr}`);
    }
  }

  /**
   * Get scan results
   */
  async getScanResults(): Promise<ScanResult[]> {
    const result = await this.adb.shell('cmd wifi list-scan-results');
    if (!result.success) {
      throw new Error(`Failed to get scan results: ${result.stderr}`);
    }

    return this.parseScanResults(result.stdout);
  }

  /**
   * Scan for networks (start scan + get results)
   */
  async scan(): Promise<ScanResult[]> {
    await this.startScan();
    // Wait a bit for scan to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    return this.getScanResults();
  }

  /**
   * Parse scan results from cmd wifi output
   * Format: BSSID  Frequency  RSSI  Age(sec)  SSID  [Flags]
   * Example: 84:18:3a:06:be:58  2412  -51  17.210  Wednesday  [WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]
   */
  private parseScanResults(output: string): ScanResult[] {
    const results: ScanResult[] = [];
    const lines = output.split('\n');

    // Skip header line if present
    const startIndex = lines[0]?.includes('BSSID') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const bssidPattern = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
      let bssid = '';
      let frequency = 0;
      let rssi = 0;
      let security = 'Open';
      let ssid = '';

      // Find the first bracket to separate SSID from flags
      const firstBracketIndex = line.indexOf('[');
      const mainPart = firstBracketIndex !== -1 ? line.substring(0, firstBracketIndex) : line;
      const flagsPart = firstBracketIndex !== -1 ? line.substring(firstBracketIndex) : '';

      // Parse the main part: BSSID  Frequency  RSSI  Age  SSID
      const parts = mainPart.trim().split(/\s+/);
      if (parts.length < 3) continue;

      // First part should be BSSID
      if (bssidPattern.test(parts[0])) {
        bssid = parts[0];
      } else {
        continue;
      }

      // Second part is frequency
      if (/^\d{4,5}$/.test(parts[1])) {
        frequency = parseInt(parts[1], 10);
      }

      // Third part is RSSI
      if (/^-?\d{1,3}$/.test(parts[2])) {
        rssi = parseInt(parts[2], 10);
      }

      // Fourth part is Age (skip it), fifth+ parts are SSID
      // SSID starts at index 4 (after BSSID, Freq, RSSI, Age)
      if (parts.length > 4) {
        ssid = parts.slice(4).join(' ').trim();
      }

      // Parse security from flags
      if (flagsPart) {
        if (flagsPart.includes('SAE')) security = 'SAE';
        else if (flagsPart.includes('WPA3')) security = 'WPA3';
        else if (flagsPart.includes('WPA2')) security = 'WPA2';
        else if (flagsPart.includes('WPA')) security = 'WPA';
        else if (flagsPart.includes('WEP')) security = 'WEP';
        else if (flagsPart.includes('OWE')) security = 'OWE';
        else security = 'Open';
      }

      if (bssid) {
        results.push({
          ssid: ssid || '<hidden>',
          bssid,
          frequency,
          rssi,
          security,
        });
      }
    }

    return results;
  }

  /**
   * Connect to a WiFi network
   */
  async connect(
    ssid: string,
    security: SecurityType,
    password?: string
  ): Promise<WifiConnectionResult> {
    let command = `cmd wifi connect-network "${ssid}" ${security}`;
    if (password && security !== 'open') {
      command += ` "${password}"`;
    }

    const result = await this.adb.shell(command);

    if (!result.success || result.stdout.toLowerCase().includes('error')) {
      return {
        success: false,
        ssid,
        error: result.stderr || result.stdout || 'Connection failed',
      };
    }

    // Wait for connection to establish
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Verify connection
    const status = await this.getStatus();
    const connected = status.connected && status.ssid === ssid;

    return {
      success: connected,
      ssid,
      error: connected ? undefined : 'Failed to verify connection',
    };
  }

  /**
   * Disconnect from current network
   * @param mode - 'toggle' (disable/enable WiFi) or 'forget' (remove saved network)
   */
  async disconnect(mode: 'toggle' | 'forget' = 'toggle'): Promise<void> {
    if (mode === 'forget') {
      // Get current network and forget it
      const status = await this.getStatus();
      if (!status.connected || !status.ssid) {
        throw new Error('Not connected to any network');
      }
      const networks = await this.listSavedNetworks();
      const current = networks.find(n => n.ssid === status.ssid);
      if (current) {
        await this.forgetNetwork(current.networkId);
      } else {
        throw new Error(`Could not find saved network for "${status.ssid}"`);
      }
    } else {
      // Toggle WiFi off then on
      await this.setEnabled(false);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await this.setEnabled(true);
    }
  }

  /**
   * List saved networks
   */
  async listSavedNetworks(): Promise<SavedNetwork[]> {
    const result = await this.adb.shell('cmd wifi list-networks');
    if (!result.success) {
      throw new Error(`Failed to list networks: ${result.stderr}`);
    }

    return this.parseSavedNetworks(result.stdout);
  }

  /**
   * Parse saved networks from cmd wifi output
   */
  private parseSavedNetworks(output: string): SavedNetwork[] {
    const networks: SavedNetwork[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format varies: "Network ID: X SSID: Y" or just "id ssid"
      const idMatch = trimmed.match(/(?:Network\s+)?ID:?\s*(\d+)/i);
      const ssidMatch = trimmed.match(/SSID:?\s*["']?([^"'\n]+)["']?/i);

      if (idMatch) {
        networks.push({
          networkId: parseInt(idMatch[1], 10),
          ssid: ssidMatch ? ssidMatch[1].trim() : 'Unknown',
        });
      }
    }

    return networks;
  }

  /**
   * Forget a saved network
   */
  async forgetNetwork(networkId: number): Promise<void> {
    const result = await this.adb.shell(`cmd wifi forget-network ${networkId}`);
    if (!result.success) {
      throw new Error(`Failed to forget network: ${result.stderr}`);
    }
  }

  /**
   * Get current WiFi status
   */
  async getStatus(): Promise<WifiStatus> {
    // Get basic WiFi state
    const statusResult = await this.adb.shell('cmd wifi status');

    // Get more detailed info from dumpsys
    const dumpsysResult = await this.adb.shell('dumpsys wifi | grep -E "mWifiInfo|Wi-Fi is|current SSID|IP address|Link speed|Frequency|RSSI"');

    const status: WifiStatus = {
      enabled: statusResult.stdout.toLowerCase().includes('wifi is enabled'),
      connected: false,
    };

    // Parse connection info from dumpsys
    const dumpsys = dumpsysResult.stdout;

    // Check if connected
    if (dumpsys.includes('state: COMPLETED') || dumpsys.includes('CONNECTED')) {
      status.connected = true;
    }

    // Extract SSID
    const ssidMatch = dumpsys.match(/SSID:\s*["']?([^"',\n]+)["']?/i);
    if (ssidMatch && ssidMatch[1] !== '<none>') {
      status.ssid = ssidMatch[1].trim();
    }

    // Extract BSSID
    const bssidMatch = dumpsys.match(/BSSID:\s*([0-9a-f:]{17})/i);
    if (bssidMatch) {
      status.bssid = bssidMatch[1];
    }

    // Extract IP address
    const ipMatch = dumpsys.match(/IP(?:\s+address)?:\s*([0-9.]+)/i);
    if (ipMatch) {
      status.ipAddress = ipMatch[1];
    }

    // Extract link speed
    const speedMatch = dumpsys.match(/Link\s+speed:\s*(\d+)/i);
    if (speedMatch) {
      status.linkSpeed = parseInt(speedMatch[1], 10);
    }

    // Extract RSSI
    const rssiMatch = dumpsys.match(/RSSI:\s*(-?\d+)/i);
    if (rssiMatch) {
      status.rssi = parseInt(rssiMatch[1], 10);
    }

    // Extract frequency
    const freqMatch = dumpsys.match(/Frequency:\s*(\d+)/i);
    if (freqMatch) {
      status.frequency = parseInt(freqMatch[1], 10);
    }

    return status;
  }

  /**
   * Get IP address via alternative method
   */
  async getIpAddress(): Promise<string | null> {
    const result = await this.adb.shell('ip addr show wlan0 | grep "inet "');
    if (!result.success) {
      return null;
    }

    const match = result.stdout.match(/inet\s+([0-9.]+)/);
    return match ? match[1] : null;
  }
}
