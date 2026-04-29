import { AdbClient } from './adb-client.js';
import {
  EapConfig,
  EapMethod,
  EnterpriseConnectionResult,
  CertificateInstallResult,
} from '../types.js';

const COMPANION_PACKAGE = 'com.example.wifimcpcompanion';
// IPC files live in the companion app's private filesDir, accessed via
// `run-as`. /sdcard/Download/ was the previous location but Android 11+
// scoped storage blocks the app from reading shell-written files there.
const COMMAND_FILE_NAME = 'wifi_mcp_command.json';
const RESULT_FILE_NAME = 'wifi_mcp_result.json';
const RESULT_FILE_REL = `files/${RESULT_FILE_NAME}`;
const COMMAND_FILE_REL = `files/${COMMAND_FILE_NAME}`;
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
    await this.clearResultFile();

    // Send broadcast to companion app
    const broadcastResult = await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.CONNECT_ENTERPRISE ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );

    if (!broadcastResult.success) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: `Failed to send broadcast: ${broadcastResult.stderr}`,
      };
    }

    // Wait for result. The companion app emits a wire format with `message`
    // (and optional `ssid` / `eapMethod`); normalize into our typed result so
    // `error` is always populated on failure.
    const raw = await this.waitForResult<Record<string, unknown>>(config.ssid);
    if (!raw) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: 'Timeout waiting for connection result',
      };
    }
    const success = !!raw.success;
    return {
      success,
      ssid: (typeof raw.ssid === 'string' ? raw.ssid : config.ssid),
      eapMethod: (typeof raw.eapMethod === 'string' ? raw.eapMethod as EapMethod : config.eapMethod),
      error: success
        ? undefined
        : (typeof raw.error === 'string' ? raw.error
          : typeof raw.message === 'string' ? raw.message
          : 'Unknown error'),
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
    await this.clearResultFile();

    // Send broadcast to companion app
    const broadcastResult = await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.INSTALL_CERTIFICATE ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );

    if (!broadcastResult.success) {
      return {
        success: false,
        alias,
        type,
        error: `Failed to send broadcast: ${broadcastResult.stderr}`,
      };
    }

    // Wait for result. Normalize companion `message` → our typed `error`.
    const raw = await this.waitForResult<Record<string, unknown>>(alias);
    if (!raw) {
      return {
        success: false,
        alias,
        type,
        error: 'Timeout waiting for certificate installation result',
      };
    }
    const success = !!raw.success;
    return {
      success,
      alias: (typeof raw.alias === 'string' ? raw.alias : alias),
      type: (raw.type === 'ca' || raw.type === 'client' ? raw.type : type),
      error: success
        ? undefined
        : (typeof raw.error === 'string' ? raw.error
          : typeof raw.message === 'string' ? raw.message
          : 'Unknown error'),
    };
  }

  /**
   * Write command payload into the companion app's private filesDir via run-as.
   * Payload is base64-encoded so embedded JSON quotes / cert hyphens cannot
   * break shell escaping.
   */
  private async writeCommandFile(payload: object): Promise<void> {
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    await this.adb.shell(
      `run-as ${COMPANION_PACKAGE} sh -c 'echo ${b64} | base64 -d > ${COMMAND_FILE_REL}'`
    );
  }

  private async clearResultFile(): Promise<void> {
    await this.adb.shell(`run-as ${COMPANION_PACKAGE} rm -f ${RESULT_FILE_REL}`);
  }

  /**
   * Poll for the result file the companion app writes after handling a broadcast.
   *
   * Caller must call `clearResultFile()` between writing the command file and
   * sending the broadcast. The receiver runs synchronously (~50 ms) so a
   * post-broadcast cleanup would race the app's write and produce spurious
   * timeouts.
   */
  private async waitForResult<T>(identifier: string): Promise<T | null> {
    const startTime = Date.now();
    const pollInterval = 500; // 500ms

    while (Date.now() - startTime < RESULT_TIMEOUT) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const checkResult = await this.adb.shell(
        `run-as ${COMPANION_PACKAGE} cat ${RESULT_FILE_REL} 2>/dev/null`
      );
      if (checkResult.success && checkResult.stdout.trim()) {
        try {
          const result = JSON.parse(checkResult.stdout) as T;
          await this.clearResultFile();
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
    await this.clearResultFile();

    await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.LIST_CERTIFICATES ` +
      `-n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );

    const result = await this.waitForResult<{ certificates: string[] }>('list');
    return result?.certificates || [];
  }
}
