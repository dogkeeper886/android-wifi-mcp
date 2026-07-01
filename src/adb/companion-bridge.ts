import { AdbClient } from './adb-client.js';

export const COMPANION_PACKAGE = 'com.example.wifimcpcompanion';

// IPC files live in the companion app's private filesDir, accessed via
// `run-as`. /sdcard/Download/ was the previous location but Android 11+
// scoped storage blocks the app from reading shell-written files there.
const COMMAND_FILE_REL = 'files/wifi_mcp_command.json';
const RESULT_FILE_REL = 'files/wifi_mcp_result.json';

const DEFAULT_RESULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

export interface BridgeOptions {
  /** How long to wait for the companion app to write its result file. */
  resultTimeoutMs?: number;
  /** How often to poll the result file while waiting. */
  pollIntervalMs?: number;
}

export interface BridgeResponse {
  /** Parsed result from the companion app, or `null` on timeout. */
  raw: Record<string, unknown> | null;
  /** Set when `am broadcast` itself failed (rare — usually a malformed action). */
  broadcastError?: string;
}

/**
 * Single owner of the file-IPC bridge to the companion app.
 *
 * Used by `EnterpriseWifiCommands` and `NotificationCommands` to send a
 * broadcast and read the response file the companion writes. The race
 * contract — *clear before broadcast, never between broadcast and the first
 * cat poll* — is enforced inside {@link sendBroadcastAndWait}; callers cannot
 * forget the order because they don't write it.
 *
 * History: this class is the dedupe of two previously-parallel implementations
 * in `enterprise-wifi.ts` and `notifications-commands.ts`. See #21 (race fix),
 * #22 (scoped-storage rewrite), #25 (message passthrough), #38 (test net),
 * #39 (this dedupe).
 */
export class CompanionAppBridge {
  private adb: AdbClient;
  private resultTimeoutMs: number;
  private pollIntervalMs: number;

  constructor(adb: AdbClient, opts: BridgeOptions = {}) {
    this.adb = adb;
    this.resultTimeoutMs = opts.resultTimeoutMs ?? DEFAULT_RESULT_TIMEOUT_MS;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * Send `action` to the companion app's `AdbBridgeReceiver`, optionally with
   * a JSON `payload` written into its filesDir, and wait for the response.
   *
   * Returns `{ raw }` with the parsed JSON on success, `{ raw: null }` on
   * timeout, or `{ broadcastError }` if `am broadcast` itself failed.
   *
   * The order is fixed: write payload (if any) → clear stale result → broadcast
   * → poll. Specifically, no `clearResultFile` happens between broadcast and the
   * first cat poll — that would race the receiver's synchronous write (~50 ms).
   */
  async sendBroadcastAndWait(action: string, payload?: object): Promise<BridgeResponse> {
    if (payload !== undefined) {
      const writeError = await this.writeCommandFile(payload);
      if (writeError) {
        // A silently-ignored write failure here is exactly what turned a bad
        // command file into a 30 s result-poll timeout (#115). Fail fast with
        // the real reason instead — the companion would otherwise read a stale
        // or missing file and never write a result.
        return { raw: null, broadcastError: `Failed to write command file: ${writeError}` };
      }
    }
    await this.clearResultFile();

    const broadcastResult = await this.adb.shell(
      `am broadcast -a ${COMPANION_PACKAGE}.${action} -n ${COMPANION_PACKAGE}/.AdbBridgeReceiver`
    );
    if (!broadcastResult.success) {
      return { raw: null, broadcastError: broadcastResult.stderr || broadcastResult.stdout || 'Unknown error' };
    }

    const raw = await this.waitForResult();
    return { raw };
  }

  /**
   * Write `payload` as JSON into the companion app's filesDir.
   * Payload is base64-encoded so embedded JSON quotes / cert hyphens cannot
   * break shell escaping.
   *
   * Returns an error string when the write fails (`run-as` denied, redirect
   * failed, oversized payload), or `undefined` on success. The caller must not
   * broadcast on failure — see {@link sendBroadcastAndWait}.
   */
  private async writeCommandFile(payload: object): Promise<string | undefined> {
    const json = JSON.stringify(payload);
    const b64 = Buffer.from(json, 'utf-8').toString('base64');
    const result = await this.adb.shell(
      `run-as ${COMPANION_PACKAGE} sh -c 'echo ${b64} | base64 -d > ${COMMAND_FILE_REL}'`
    );
    if (!result.success) {
      return result.stderr || result.stdout || 'Unknown error';
    }
    return undefined;
  }

  private async clearResultFile(): Promise<void> {
    await this.adb.shell(`run-as ${COMPANION_PACKAGE} rm -f ${RESULT_FILE_REL}`);
  }

  /**
   * Poll the result file the companion app writes after handling a broadcast.
   * Caller must have already cleared the result file before broadcasting;
   * this method does not — see {@link sendBroadcastAndWait} for the contract.
   */
  private async waitForResult(): Promise<Record<string, unknown> | null> {
    const startTime = Date.now();
    while (Date.now() - startTime < this.resultTimeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      const checkResult = await this.adb.shell(
        `run-as ${COMPANION_PACKAGE} cat ${RESULT_FILE_REL} 2>/dev/null`
      );
      if (checkResult.success && checkResult.stdout.trim()) {
        try {
          const parsed = JSON.parse(checkResult.stdout) as Record<string, unknown>;
          await this.clearResultFile();
          return parsed;
        } catch {
          // Partial write — keep polling.
        }
      }
    }
    return null;
  }
}
