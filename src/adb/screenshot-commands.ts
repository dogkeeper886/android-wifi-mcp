import { writeFileSync } from 'fs';
import { AdbClient } from './adb-client.js';

/**
 * Capture screenshots from the device via `adb exec-out screencap -p`.
 *
 * Generic UI automation (taps, swipes, key events, type, app launch, URL
 * open, ui dump, package list) is intentionally not provided here — those
 * tools were removed in the option-A trim (#20). Compose with
 * `mobile-next/mobile-mcp` for selector-based UI work, and with
 * `android-playwright` (Chrome Canary CDP) for in-browser DOM. Screenshots
 * stay in this project because they're a cheap verification primitive used
 * by our own WiFi/network/OTP flows.
 */
export class ScreenshotCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  /**
   * Capture a PNG screenshot. If `outputPath` is provided, save to that host
   * path and return metadata. Otherwise return the PNG as base64.
   */
  async screenshot(outputPath?: string): Promise<
    | { success: true; outputPath: string; bytes: number }
    | { success: true; mimeType: 'image/png'; base64: string; bytes: number }
  > {
    const buf = await this.adb.execBinary(['exec-out', 'screencap', '-p'], 30000);

    if (outputPath) {
      writeFileSync(outputPath, buf);
      return { success: true, outputPath, bytes: buf.length };
    }

    return {
      success: true,
      mimeType: 'image/png',
      base64: buf.toString('base64'),
      bytes: buf.length,
    };
  }
}
