import { AdbClient } from './adb-client.js';

export type SettingsNamespace = 'system' | 'secure' | 'global';

export interface SettingsGetResult {
  namespace: SettingsNamespace;
  key: string;
  value: string | null;
  error?: string;
}

export interface SettingsPutResult {
  namespace: SettingsNamespace;
  key: string;
  value: string;
  success: boolean;
  error?: string;
}

export interface SettingsDeleteResult {
  namespace: SettingsNamespace;
  key: string;
  success: boolean;
  error?: string;
}

/**
 * Read, write, and delete entries in Android's settings provider via
 * `adb shell settings get|put|delete <namespace> <key> [<value>]`.
 *
 * Three namespaces — `system` (user prefs), `secure` (security/auth), `global`
 * (device-wide). The ADB shell user holds `WRITE_SECURE_SETTINGS` by default
 * on dev/userdebug builds, so all three are writable from the host without
 * additional permission grants.
 */
export class SettingsCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  async get(namespace: SettingsNamespace, key: string): Promise<SettingsGetResult> {
    const result = await this.adb.shell(`settings get ${namespace} ${shellQuote(key)}`);
    if (!result.success) {
      return {
        namespace,
        key,
        value: null,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
    const trimmed = result.stdout.trim();
    // `settings get` prints the literal string "null" when the key is unset.
    const value = trimmed === 'null' || trimmed === '' ? null : trimmed;
    return { namespace, key, value };
  }

  async put(namespace: SettingsNamespace, key: string, value: string): Promise<SettingsPutResult> {
    const result = await this.adb.shell(
      `settings put ${namespace} ${shellQuote(key)} ${shellQuote(value)}`
    );
    if (!result.success) {
      return {
        namespace,
        key,
        value,
        success: false,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
    return { namespace, key, value, success: true };
  }

  async delete(namespace: SettingsNamespace, key: string): Promise<SettingsDeleteResult> {
    const result = await this.adb.shell(`settings delete ${namespace} ${shellQuote(key)}`);
    if (!result.success) {
      return {
        namespace,
        key,
        success: false,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
    return { namespace, key, success: true };
  }
}

function shellQuote(s: string): string {
  // Single-quote and escape any embedded single quotes. Safe for both host
  // execFile (no host shell) and the device shell that adb forwards to.
  return `'${s.replace(/'/g, "'\\''")}'`;
}
