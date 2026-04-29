import { AdbClient } from './adb-client.js';

export interface FileTransferResult {
  success: boolean;
  localPath: string;
  remotePath: string;
  output: string;
  error?: string;
}

/**
 * File staging primitives via `adb push` / `adb pull`. Used for cert install
 * (push), captured downloaded files / app-private dumps (pull), or anything
 * else that needs to cross the host/device boundary as bytes rather than
 * shell text.
 *
 * Scoping notes:
 *   • `/data/local/tmp/` is the safest target — shell-owned, readable on
 *     pull, writable on push.
 *   • `/sdcard/Download/` works for pull (host can `adb pull`) but on
 *     Android 11+ apps cannot read shell-written files there (scoped
 *     storage), so it is a poor staging area for handing files to apps.
 *     For app-private staging use `adb shell run-as <pkg> ...` (see the
 *     enterprise-wifi bridge), not push.
 *   • `/data/data/<pkg>/` is unwritable from `adb push` even on debuggable
 *     apps — `run-as` is required for that.
 */
export class FileCommands {
  private adb: AdbClient;

  constructor(adb: AdbClient) {
    this.adb = adb;
  }

  async push(localPath: string, remotePath: string): Promise<FileTransferResult> {
    const result = await this.adb.exec(['push', localPath, remotePath]);
    if (!result.success) {
      return {
        success: false,
        localPath,
        remotePath,
        output: result.stdout,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
    return {
      success: true,
      localPath,
      remotePath,
      // adb writes the progress / summary to stderr; stdout is usually empty.
      output: result.stderr || result.stdout,
    };
  }

  async pull(remotePath: string, localPath: string): Promise<FileTransferResult> {
    const result = await this.adb.exec(['pull', remotePath, localPath]);
    if (!result.success) {
      return {
        success: false,
        localPath,
        remotePath,
        output: result.stdout,
        error: result.stderr || result.stdout || 'Unknown error',
      };
    }
    return {
      success: true,
      localPath,
      remotePath,
      output: result.stderr || result.stdout,
    };
  }
}
