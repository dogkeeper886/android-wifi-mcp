import { AdbClient } from './adb-client.js';
import { CompanionAppBridge, COMPANION_PACKAGE } from './companion-bridge.js';
import {
  EapConfig,
  EapMethod,
  EnterpriseConnectionResult,
  CertificateInstallResult,
} from '../types.js';

export class EnterpriseWifiCommands {
  private adb: AdbClient;
  private bridge: CompanionAppBridge;

  constructor(adb: AdbClient) {
    this.adb = adb;
    this.bridge = new CompanionAppBridge(adb, { resultTimeoutMs: 30_000, pollIntervalMs: 500 });
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

    if (!(await this.isCompanionAppInstalled())) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: `Companion app not installed. Please install ${COMPANION_PACKAGE}`,
      };
    }

    const payload = {
      action: 'connect_enterprise',
      timestamp: Date.now(),
      ...config,
    };
    const { raw, broadcastError } = await this.bridge.sendBroadcastAndWait('CONNECT_ENTERPRISE', payload);

    if (broadcastError) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: `Failed to send broadcast: ${broadcastError}`,
      };
    }
    if (!raw) {
      return {
        success: false,
        ssid: config.ssid,
        eapMethod: config.eapMethod,
        error: 'Timeout waiting for connection result',
      };
    }

    return normalizeEnterpriseResult(raw, config.ssid, config.eapMethod);
  }

  /**
   * Install a certificate for enterprise WiFi
   */
  async installCertificate(
    certificate: string,
    alias: string,
    type: 'ca' | 'client'
  ): Promise<CertificateInstallResult> {
    if (!(await this.isCompanionAppInstalled())) {
      return {
        success: false,
        alias,
        type,
        error: `Companion app not installed. Please install ${COMPANION_PACKAGE}`,
      };
    }

    const payload = {
      action: 'install_certificate',
      timestamp: Date.now(),
      certificate,
      alias,
      type,
    };
    const { raw, broadcastError } = await this.bridge.sendBroadcastAndWait('INSTALL_CERTIFICATE', payload);

    if (broadcastError) {
      return {
        success: false,
        alias,
        type,
        error: `Failed to send broadcast: ${broadcastError}`,
      };
    }
    if (!raw) {
      return {
        success: false,
        alias,
        type,
        error: 'Timeout waiting for certificate installation result',
      };
    }

    return normalizeCertificateResult(raw, alias, type);
  }

  /**
   * Get list of installed certificates (via companion app)
   */
  async listCertificates(): Promise<string[]> {
    if (!(await this.isCompanionAppInstalled())) {
      return [];
    }

    const payload = { action: 'list_certificates', timestamp: Date.now() };
    const { raw } = await this.bridge.sendBroadcastAndWait('LIST_CERTIFICATES', payload);
    if (!raw) return [];
    const certs = raw.certificates;
    return Array.isArray(certs) ? (certs as string[]) : [];
  }
}

/**
 * Translate the companion app's wire format into our typed result.
 *
 * Companion emits `message` for diagnostics and may omit `ssid` / `eapMethod`
 * when it failed before reaching the EAP layer (e.g. "Failed to read config
 * file"). The host type expects `error` and always-populated identity fields,
 * so we normalize at the boundary.
 */
function normalizeEnterpriseResult(
  raw: Record<string, unknown>,
  fallbackSsid: string,
  fallbackEapMethod: EapMethod
): EnterpriseConnectionResult {
  const success = !!raw.success;
  return {
    success,
    ssid: typeof raw.ssid === 'string' ? raw.ssid : fallbackSsid,
    eapMethod:
      raw.eapMethod === 'peap' || raw.eapMethod === 'ttls' || raw.eapMethod === 'tls'
        ? raw.eapMethod
        : fallbackEapMethod,
    error: success ? undefined : pickErrorMessage(raw),
  };
}

function normalizeCertificateResult(
  raw: Record<string, unknown>,
  fallbackAlias: string,
  fallbackType: 'ca' | 'client'
): CertificateInstallResult {
  const success = !!raw.success;
  return {
    success,
    alias: typeof raw.alias === 'string' ? raw.alias : fallbackAlias,
    type: raw.type === 'ca' || raw.type === 'client' ? raw.type : fallbackType,
    error: success ? undefined : pickErrorMessage(raw),
  };
}

/** Prefer companion's `error` over `message`; fall back to a generic string. */
function pickErrorMessage(raw: Record<string, unknown>): string {
  if (typeof raw.error === 'string') return raw.error;
  if (typeof raw.message === 'string') return raw.message;
  return 'Unknown error';
}
