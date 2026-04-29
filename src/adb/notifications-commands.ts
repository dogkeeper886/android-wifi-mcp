import { AdbClient } from './adb-client.js';
import { CompanionAppBridge } from './companion-bridge.js';

/**
 * Talks to the companion app's NotificationCaptureService over the file-IPC
 * bridge (see {@link CompanionAppBridge}).
 *
 * The service captures every notification posted system-wide (WhatsApp,
 * email, banking apps, etc.) so we can extract OTPs that don't come via
 * SMS. Requires the user to have granted notification access once via
 * Settings → Notifications → Notification access.
 */
export class NotificationCommands {
  private bridge: CompanionAppBridge;

  constructor(adb: AdbClient) {
    // 10 s + 300 ms poll — single round-trip; no retries from the caller.
    this.bridge = new CompanionAppBridge(adb, { resultTimeoutMs: 10_000, pollIntervalMs: 300 });
  }

  async getStatus(): Promise<NotificationStatus> {
    const { raw } = await this.bridge.sendBroadcastAndWait('NOTIFICATION_STATUS');
    if (!raw) {
      return {
        listenerConnected: false,
        capturedCount: 0,
        warning:
          'No response from companion app. Is it installed? See wifi_check_companion_app.',
      };
    }
    return {
      listenerConnected: !!raw.listenerConnected,
      capturedCount: typeof raw.capturedCount === 'number' ? raw.capturedCount : 0,
      warning: raw.success
        ? undefined
        : typeof raw.message === 'string'
        ? raw.message
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
    const { raw: result } = await this.bridge.sendBroadcastAndWait('LIST_NOTIFICATIONS', config);
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
