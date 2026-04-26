import { writeFileSync } from 'fs';
import { AdbClient } from './adb-client.js';

/**
 * Wraps Android UI-automation primitives via `adb shell input`, `am start`,
 * `screencap`, `uiautomator dump`, and `pm list packages`. Lower-level than
 * Playwright/Appium — operates at the OS pixel/UI-tree level, not the DOM.
 */
export class UICommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  /**
   * Launch an app. Accepts either an explicit `pkg/.Activity` component or a
   * bare package name (uses the monkey trick for the LAUNCHER intent).
   */
  async launchApp(target: string): Promise<{ success: boolean; target: string; method: string; output: string }> {
    const isComponent = target.includes('/');
    const command = isComponent
      ? `am start -n ${shellQuote(target)}`
      : `monkey -p ${shellQuote(target)} -c android.intent.category.LAUNCHER 1`;

    const result = await this.adb.shell(command);
    if (!result.success) {
      throw new Error(`Failed to launch ${target}: ${result.stderr || result.stdout}`);
    }

    return {
      success: true,
      target,
      method: isComponent ? 'am-start' : 'monkey',
      output: result.stdout,
    };
  }

  /**
   * Open a URL in the default browser via VIEW intent.
   */
  async openUrl(url: string): Promise<{ success: boolean; url: string; output: string }> {
    const command = `am start -a android.intent.action.VIEW -d ${shellQuote(url)}`;
    const result = await this.adb.shell(command);
    if (!result.success) {
      throw new Error(`Failed to open URL: ${result.stderr || result.stdout}`);
    }
    return { success: true, url, output: result.stdout };
  }

  /**
   * Tap at (x, y) screen coordinates.
   */
  async tap(x: number, y: number): Promise<{ success: boolean; x: number; y: number }> {
    const result = await this.adb.shell(`input tap ${x} ${y}`);
    if (!result.success) {
      throw new Error(`Tap failed: ${result.stderr || result.stdout}`);
    }
    return { success: true, x, y };
  }

  /**
   * Swipe from (x1, y1) to (x2, y2) over `durationMs`.
   */
  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs: number = 300
  ): Promise<{ success: boolean; from: { x: number; y: number }; to: { x: number; y: number }; durationMs: number }> {
    const result = await this.adb.shell(`input swipe ${x1} ${y1} ${x2} ${y2} ${durationMs}`);
    if (!result.success) {
      throw new Error(`Swipe failed: ${result.stderr || result.stdout}`);
    }
    return {
      success: true,
      from: { x: x1, y: y1 },
      to: { x: x2, y: y2 },
      durationMs,
    };
  }

  /**
   * Type text into the focused field. Spaces become %s; single quotes are
   * escaped for shell wrapping. Some special characters may not survive
   * `adb shell input text` — the caller should send those via keyevent
   * codes if reliability matters.
   */
  async typeText(text: string): Promise<{ success: boolean; text: string }> {
    const escaped = text.replace(/ /g, '%s');
    const result = await this.adb.shell(`input text ${shellQuote(escaped)}`);
    if (!result.success) {
      throw new Error(`Type failed: ${result.stderr || result.stdout}`);
    }
    return { success: true, text };
  }

  /**
   * Send a keyevent. Accepts a numeric code or a name like `KEYCODE_HOME`.
   */
  async keyevent(keycode: string | number): Promise<{ success: boolean; keycode: string | number }> {
    const result = await this.adb.shell(`input keyevent ${keycode}`);
    if (!result.success) {
      throw new Error(`Keyevent failed: ${result.stderr || result.stdout}`);
    }
    return { success: true, keycode };
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

  /**
   * Dump the on-screen UI hierarchy as XML.
   * Writes to a temp file on the device, cats it back, then cleans up.
   */
  async uiDump(): Promise<{ success: boolean; xml: string; bytes: number }> {
    const devicePath = '/sdcard/window_dump.xml';

    // uiautomator dump writes to the path we pass it.
    const dumpResult = await this.adb.shell(`uiautomator dump ${devicePath}`);
    if (!dumpResult.success || !dumpResult.stdout.includes('UI hierchary dumped')) {
      // Note: Android historically misspells "hierarchy" as "hierchary" in this output.
      // We don't fail just on the typo check — only on shell failure.
      if (!dumpResult.success) {
        throw new Error(`uiautomator dump failed: ${dumpResult.stderr || dumpResult.stdout}`);
      }
    }

    const catResult = await this.adb.shell(`cat ${devicePath}`);
    if (!catResult.success) {
      throw new Error(`Failed to read dump file: ${catResult.stderr}`);
    }

    // Best-effort cleanup
    await this.adb.shell(`rm -f ${devicePath}`);

    return {
      success: true,
      xml: catResult.stdout,
      bytes: catResult.stdout.length,
    };
  }

  /**
   * List installed app packages. Optional substring `filter` is passed to
   * `pm list packages`.
   */
  async listPackages(filter?: string): Promise<{ count: number; packages: string[] }> {
    const cmd = filter ? `pm list packages ${shellQuote(filter)}` : 'pm list packages';
    const result = await this.adb.shell(cmd);
    if (!result.success) {
      throw new Error(`Failed to list packages: ${result.stderr || result.stdout}`);
    }
    const packages = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('package:'))
      .map((line) => line.slice('package:'.length));

    return { count: packages.length, packages };
  }
}

/**
 * Wrap a string in single quotes for shell, escaping any embedded single quotes.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
