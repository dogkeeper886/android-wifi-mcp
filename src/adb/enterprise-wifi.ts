import { AdbClient } from './adb-client.js';
import {
  EapConfig,
  EnterpriseConnectionResult,
  CertificateInstallResult,
} from '../types.js';

const COMPANION_PACKAGE = 'com.example.wifimcpcompanion';
const COMMAND_FILE = '/sdcard/Download/wifi_mcp_command.json';
const RESULT_FILE = '/sdcard/Download/wifi_mcp_result.json';
const RESULT_TIMEOUT = 30000; // 30 seconds

export class EnterpriseWifiCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  /**
   * Check if the companion app is installed
   */
  async isCompanionAppInstalled(): Promise<boolean> {
    const result = await this.adb.shell(`pm list packages | grep ${COMPANION_PACKAGE}`);
    return result.stdout.includes(COMPANION_PACKAGE);
  }

  /**
   * Connect to an enterprise WiFi network (802.1X/EAP)
   */
  async connectEnterprise(config: EapConfig): Promise<EnterpriseConnectionResult> {
    // Validate config based on EAP method
    if ((config.eapMethod === 'peap' || config.eapMethod === 'ttls') && !config.password) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: 'Password is required for EAP-PEAP/TTLS',
      };
    }

    if (config.eapMethod === 'tls' && (!config.clientCertificate || !config.privateKey)) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: 'Client certificate and private key are required for EAP-TLS',
      };
    }

    // Check if companion app is installed
    const appInstalled = await this.isCompanionAppInstalled();
    if (!appInstalled) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: `Companion app not installed. Please install ${COMPANION_PACKAGE}`,
      };
    }

    // Write config to file
    const commandPayload = {
      action: 'connect_enterprise',
      timestamp: Date.now(),
      ...config,
    };

    await this.writeCommandFile(commandPayload);

    // Send broadcast to companion app
    const broadcastResult = await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.CONNECT_ENTERPRISE ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver ` +
      `--es config_file "${COMMAND_FILE}"`
    );

    if (!broadcastResult.success) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: `Failed to send broadcast: ${broadcastResult.stderr}`,
      };
    }

    // Wait for result
    const result = await this.waitForResult<EnterpriseConnectionResult>(config.ssid);
    return result || {
      success: false,
      ssid: config.ssid,
      eapMethod: config.eapMethod,
      error: 'Timeout waiting for connection result',
    };
  }

  /**
   * Install a certificate for enterprise WiFi
   */
  async installCertificate(
    certificate: string,
    alias: string,
    type: 'ca' | 'client'
  ): Promise<CertificateInstallResult> {
    // Check if companion app is installed
    const appInstalled = await this.isCompanionAppInstalled();
    if (!appInstalled) {
      return {
        success: false,
        alias,
        type,
        error: `Companion app not installed. Please install ${COMPANION_PACKAGE}`,
      };
    }

    // Write config to file
    const commandPayload = {
      action: 'install_certificate',
      timestamp: Date.now(),
      certificate,
      alias,
      type,
    };

    await this.writeCommandFile(commandPayload);

    // Send broadcast to companion app
    const broadcastResult = await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.INSTALL_CERTIFICATE ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver ` +
      `--es config_file "${COMMAND_FILE}"`
    );

    if (!broadcastResult.success) {
      return {
        success: false,
        alias,
        type,
        error: `Failed to send broadcast: ${broadcastResult.stderr}`,
      };
    }

    // Wait for result
    const result = await this.waitForResult<CertificateInstallResult>(alias);
    return result || {
      success: false,
      alias,
      type,
      error: 'Timeout waiting for certificate installation result',
    };
  }

  /**
   * Write command payload to file on device
   */
  private async writeCommandFile(payload: object): Promise<void> {
    const json = JSON.stringify(payload);
    // Escape for shell and write to file
    const escaped = json.replace(/'/g, "'\\''");
    await this.adb.shell(`echo '${escaped}' > ${COMMAND_FILE}`);
  }

  /**
   * Wait for result from companion app
   */
  private async waitForResult<T>(identifier: string): Promise<T | null> {
    const startTime = Date.now();
    const pollInterval = 500; // 500ms

    // Clear any existing result file
    await this.adb.shell(`rm -f ${RESULT_FILE}`);

    while (Date.now() - startTime < RESULT_TIMEOUT) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      // Check if result file exists
      const checkResult = await this.adb.shell(`cat ${RESULT_FILE} 2>/dev/null`);
      if (checkResult.success && checkResult.stdout.trim()) {
        try {
          const result = JSON.parse(checkResult.stdout) as T;
          // Clean up
          await this.adb.shell(`rm -f ${RESULT_FILE}`);
          return result;
        } catch {
          // JSON not ready yet, continue waiting
        }
      }
    }

    return null;
  }

  /**
   * Get list of installed certificates (via companion app)
   */
  async listCertificates(): Promise<string[]> {
    const appInstalled = await this.isCompanionAppInstalled();
    if (!appInstalled) {
      return [];
    }

    const commandPayload = {
      action: 'list_certificates',
      timestamp: Date.now(),
    };

    await this.writeCommandFile(commandPayload);

    await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.LIST_CERTIFICATES ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver ` +
      `--es config_file "${COMMAND_FILE}"`
    );

    const result = await this.waitForResult<{ certificates: string[] }>('list');
    return result?.certificates || [];
  }
}
