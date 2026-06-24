import { AdbClient } from './adb-client.js';

/**
 * Reads SMS messages from the device's content provider for OTP capture.
 *
 * Works without root and without a companion app. Some Samsung/OEM devices
 * restrict `content://sms/inbox` even via adb shell — when that happens the
 * tool returns an empty list with a `warning` rather than failing, and the
 * caller can fall back to the notification listener (see #3).
 */
export class SmsCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  async readRecent(opts: SmsReadRecentOptions = {}): Promise<SmsReadRecentResult> {
    const limit = opts.limit ?? 10;
    const result = await this.adb.shell(
      `content query --uri content://sms/inbox --projection address,body,date`
    );

    if (!result.success) {
      return {
        messages: [],
        count: 0,
        warning: `content query failed: ${result.stderr || result.stdout}`,
      };
    }

    const stdout = result.stdout.trim();
    if (!stdout || /no result found/i.test(stdout)) {
      return {
        messages: [],
        count: 0,
        warning:
          'No SMS rows returned. On Samsung/OEM devices, content://sms/inbox is often restricted even via adb shell. Use the companion app notification listener (see #3) for those devices.',
      };
    }

    let messages = parseContentQuery(stdout);

    // Apply filters
    if (opts.senderFilter) {
      const re = new RegExp(opts.senderFilter, 'i');
      messages = messages.filter((m) => re.test(m.sender));
    }

    if (opts.bodyRegex) {
      const re = new RegExp(opts.bodyRegex);
      const out: SmsMessage[] = [];
      for (const m of messages) {
        const match = m.body.match(re);
        if (!match) continue;
        // Use a capture group if present; else fall back to the digits heuristic.
        m.otp = match[1] ?? extractOtp(m.body);
        out.push(m);
      }
      messages = out;
    } else {
      for (const m of messages) {
        m.otp = extractOtp(m.body);
      }
    }

    if (opts.sinceSeconds !== undefined) {
      const cutoff = Date.now() - opts.sinceSeconds * 1000;
      messages = messages.filter((m) => m.timestamp >= cutoff);
    }

    messages.sort((a, b) => b.timestamp - a.timestamp);
    messages = messages.slice(0, limit);

    return { messages, count: messages.length };
  }

  async waitForOtp(opts: SmsWaitForOtpOptions = {}): Promise<SmsWaitForOtpResult> {
    const timeoutMs = opts.timeoutMs ?? 60000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2000;
    const sinceSeconds = opts.sinceSeconds ?? 60;
    const start = Date.now();

    let lastWarning: string | undefined;

    while (Date.now() - start < timeoutMs) {
      const r = await this.readRecent({
        senderFilter: opts.senderFilter,
        bodyRegex: opts.bodyRegex,
        sinceSeconds,
        limit: 5,
      });
      lastWarning = r.warning;

      const hit = r.messages.find((m) => m.otp);
      if (hit && hit.otp) {
        return {
          found: true,
          otp: hit.otp,
          sender: hit.sender,
          body: hit.body,
          timestamp: hit.timestamp,
          waitedMs: Date.now() - start,
          warning: r.warning,
        };
      }

      await new Promise((res) => setTimeout(res, pollIntervalMs));
    }

    return {
      found: false,
      waitedMs: Date.now() - start,
      warning: lastWarning,
    };
  }
}

export interface SmsMessage {
  sender: string;
  body: string;
  timestamp: number; // ms since epoch
  otp?: string;
}

export interface SmsReadRecentOptions {
  limit?: number;
  senderFilter?: string;
  bodyRegex?: string;
  sinceSeconds?: number;
}

export interface SmsReadRecentResult {
  messages: SmsMessage[];
  count: number;
  warning?: string;
}

export interface SmsWaitForOtpOptions {
  senderFilter?: string;
  bodyRegex?: string;
  sinceSeconds?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type SmsWaitForOtpResult =
  | {
      found: true;
      otp: string;
      sender: string;
      body: string;
      timestamp: number;
      waitedMs: number;
      warning?: string;
    }
  | {
      found: false;
      waitedMs: number;
      warning?: string;
    };

/**
 * Parse `content query --projection address,body,date` output.
 *
 * Each row looks like:
 *   Row: 0 address=AlertBank, body=Your code is 123456, date=1633000000000
 *
 * Bodies can legitimately contain commas, so we anchor on the known column
 * names instead of splitting on `, `. Assumes the projection order
 * address,body,date — the same order our query passes.
 *
 * `date` is the final column and its value is a numeric epoch, so we anchor on
 * the LAST `, date=<digits>` (end of row) rather than the first occurrence — a
 * body that itself contains `, date=` would otherwise truncate the message and
 * drop the row to a NaN timestamp (#82).
 *
 * Exported for unit testing.
 */
export function parseContentQuery(stdout: string): SmsMessage[] {
  const messages: SmsMessage[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trimStart().startsWith('Row:')) continue;

    const addressIdx = line.indexOf('address=');
    const bodyIdx = line.indexOf(', body=');
    // The real date delimiter is the trailing numeric one, not the first match.
    const dateMatch = line.match(/, date=(\d+)\s*$/);
    if (addressIdx === -1 || bodyIdx === -1 || !dateMatch) continue;
    const dateIdx = line.lastIndexOf(', date=');
    if (!(addressIdx < bodyIdx && bodyIdx < dateIdx)) continue;

    const sender = line.slice(addressIdx + 'address='.length, bodyIdx).trim();
    const body = line.slice(bodyIdx + ', body='.length, dateIdx);
    const timestamp = parseInt(dateMatch[1], 10);

    if (!sender || isNaN(timestamp)) continue;
    messages.push({ sender, body, timestamp });
  }
  return messages;
}

/**
 * Heuristic OTP extraction: first standalone 4-8 digit run in the body.
 */
function extractOtp(body: string): string | undefined {
  const match = body.match(/\b(\d{4,8})\b/);
  return match ? match[1] : undefined;
}
