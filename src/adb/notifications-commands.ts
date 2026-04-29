import { AdbClient } from './adb-client.js';

const COMPANION_PACKAGE = 'com.example.wifimcpcompanion';
// IPC files live in the companion app's private filesDir, accessed via run-as.
const COMMAND_FILE_REL = 'files/wifi_mcp_command.json';
const RESULT_FILE_REL = 'files/wifi_mcp_result.json';
const RESULT_TIMEOUT = 10000; // 10s for a single broadcast round-trip

/**
 * Talks to the companion app's NotificationCaptureService over the same
 * file-IPC bridge the enterprise-wifi flow uses.
 *
 * The service captures every notification posted system-wide (WhatsApp,
 * email, banking apps, etc.) so we can extract OTPs that don't come via
 * SMS. Requires the user to have granted notification access once via
 * Settings → Notifications → Notification access.
 */
export class NotificationCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  async getStatus(): Promise<NotificationStatus> {
    await this.clearResultFile();
    await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.NOTIFICATION_STATUS -n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );
    const result = await this.waitForResult();
    if (!result) {
      return {
        listenerConnected: false,
        capturedCount: 0,
        warning:
          'No response from companion app. Is it installed? See wifi_check_companion_app.',
      };
    }
    return {
      listenerConnected: !!result.listenerConnected,
      capturedCount: typeof result.capturedCount === 'number' ? result.capturedCount : 0,
      warning: result.success
        ? undefined
        : typeof result.message === 'string'
        ? result.message
        : 'Unknown error',
    };
  }

  async listRecent(opts: NotificationListOptions = {}): Promise<NotificationListResult> {
    const config: Record<string, unknown> = {};
    if (opts.sinceSeconds !== undefined) {
      config.sinceMs = Date.now() - opts.sinceSeconds * 1000;
    }
    if (opts.packageFilter !== undefined) {
      config.packageFilter = opts.packageFilter;
    }
    if (opts.limit !== undefined) {
      config.limit = opts.limit;
    }
    await this.writeCommandFile(config);
    await this.clearResultFile();
    await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.LIST_NOTIFICATIONS -n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );
    const result = await this.waitForResult();
    if (!result) {
      return {
        notifications: [],
        count: 0,
        warning: 'No response from companion app. Is it installed and is notification access granted?',
      };
    }
    if (!result.success) {
      return {
        notifications: [],
        count: 0,
        warning: typeof result.message === 'string' ? result.message : 'Unknown error',
      };
    }
    const raw = Array.isArray(result.notifications) ? (result.notifications as unknown[]) : [];
    const notifications: CapturedNotification[] = raw.map((n) => {
      const o = n as Record<string, unknown>;
      const cap: CapturedNotification = {
        packageName: typeof o.packageName === 'string' ? o.packageName : '',
        title: typeof o.title === 'string' ? o.title : '',
        text: typeof o.text === 'string' ? o.text : '',
        timestamp: typeof o.timestamp === 'number' ? o.timestamp : 0,
      };
      if (opts.bodyRegex) {
        const re = new RegExp(opts.bodyRegex);
        const haystack = `${cap.title}\n${cap.text}`;
        const match = haystack.match(re);
        if (!match) return null as unknown as CapturedNotification;
        cap.otp = match[1] ?? extractOtp(haystack);
      } else {
        cap.otp = extractOtp(`${cap.title}\n${cap.text}`);
      }
      return cap;
    }).filter(Boolean) as CapturedNotification[];

    return { notifications, count: notifications.length };
  }

  async waitForOtp(opts: WaitForOtpOptions = {}): Promise<WaitForOtpResult> {
    const timeoutMs = opts.timeoutMs ?? 60000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2000;
    const sinceSeconds = opts.sinceSeconds ?? 60;
    const start = Date.now();

    let lastWarning: string | undefined;
    while (Date.now() - start < timeoutMs) {
      const r = await this.listRecent({
        packageFilter: opts.packageFilter,
        bodyRegex: opts.bodyRegex,
        sinceSeconds,
        limit: 10,
      });
      lastWarning = r.warning;
      const hit = r.notifications.find((n) => n.otp);
      if (hit?.otp) {
        return {
          found: true,
          otp: hit.otp,
          packageName: hit.packageName,
          title: hit.title,
          text: hit.text,
          timestamp: hit.timestamp,
          waitedMs: Date.now() - start,
          warning: r.warning,
        };
      }
      await new Promise((res) => setTimeout(res, pollIntervalMs));
    }
    return { found: false, waitedMs: Date.now() - start, warning: lastWarning };
  }

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

  private async waitForResult(): Promise<Record<string, unknown> | null> {
    const start = Date.now();
    const pollInterval = 300;
    while (Date.now() - start < RESULT_TIMEOUT) {
      await new Promise((res) => setTimeout(res, pollInterval));
      const cat = await this.adb.shell(
        `run-as ${COMPANION_PACKAGE} cat ${RESULT_FILE_REL} 2>/dev/null`
      );
      if (cat.success && cat.stdout.trim()) {
        try {
          const parsed = JSON.parse(cat.stdout) as Record<string, unknown>;
          await this.clearResultFile();
          return parsed;
        } catch {
          // partial write — keep polling
        }
      }
    }
    return null;
  }
}

export interface NotificationStatus {
  listenerConnected: boolean;
  capturedCount: number;
  warning?: string;
}

export interface CapturedNotification {
  packageName: string;
  title: string;
  text: string;
  timestamp: number;
  otp?: string;
}

export interface NotificationListOptions {
  packageFilter?: string;
  bodyRegex?: string;
  sinceSeconds?: number;
  limit?: number;
}

export interface NotificationListResult {
  notifications: CapturedNotification[];
  count: number;
  warning?: string;
}

export interface WaitForOtpOptions {
  packageFilter?: string;
  bodyRegex?: string;
  sinceSeconds?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type WaitForOtpResult =
  | {
      found: true;
      otp: string;
      packageName: string;
      title: string;
      text: string;
      timestamp: number;
      waitedMs: number;
      warning?: string;
    }
  | {
      found: false;
      waitedMs: number;
      warning?: string;
    };

function extractOtp(haystack: string): string | undefined {
  const m = haystack.match(/\b(\d{4,8})\b/);
  return m ? m[1] : undefined;
}
