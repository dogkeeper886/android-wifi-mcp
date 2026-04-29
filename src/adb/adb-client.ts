import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { Device, DeviceInfo, AdbResult } from '../types.js';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_BUFFER = 1024 * 1024 * 8; // 8 MB; covers ui_dump and wifi_scan with headroom

export class AdbClient {
  private adbPath: string;
  private selectedDevice: string | null = null;

  constructor(adbPath: string = 'adb') {
    this.adbPath = adbPath;
  }

  /**
   * Execute an ADB command.
   *
   * Uses `execFile` so adb is invoked directly with an args array — no host
   * /bin/sh layer between us and adb. That keeps shell metacharacters in
   * shell-command args (`|`, `>`, single quotes around `sh -c '...'`)
   * intact when adb forwards them to the device shell.
   */
  async exec(args: string[], timeout: number = 30000): Promise<AdbResult> {
    const deviceArgs = this.selectedDevice ? ['-s', this.selectedDevice] : [];
    const fullArgs = [...deviceArgs, ...args];

    try {
      const { stdout, stderr } = await execFileAsync(this.adbPath, fullArgs, {
        timeout,
        maxBuffer: MAX_OUTPUT_BUFFER,
      });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        success: false,
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message || 'Unknown error',
        exitCode: err.code || 1,
      };
    }
  }

  /**
   * Execute a shell command on the device
   */
  async shell(command: string, timeout: number = 30000): Promise<AdbResult> {
    return this.exec(['shell', command], timeout);
  }

  /**
   * List connected devices
   */
  async listDevices(): Promise<Device[]> {
    const result = await this.exec(['devices', '-l']);
    if (!result.success) {
      throw new Error(`Failed to list devices: ${result.stderr}`);
    }

    const lines = result.stdout.split('\n').slice(1); // Skip "List of devices attached"
    const devices: Device[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      // Parse: SERIAL STATE [property:value ...]
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const serial = parts[0];
      const state = parts[1] as Device['state'];

      const device: Device = { serial, state };

      // Parse additional properties
      for (let i = 2; i < parts.length; i++) {
        const [key, value] = parts[i].split(':');
        if (key === 'product') device.product = value;
        else if (key === 'model') device.model = value;
        else if (key === 'device') device.device = value;
        else if (key === 'transport_id') device.transportId = value;
      }

      devices.push(device);
    }

    return devices;
  }

  /**
   * Select a device for subsequent operations
   */
  selectDevice(serial: string | null): void {
    this.selectedDevice = serial;
  }

  /**
   * Get currently selected device
   */
  getSelectedDevice(): string | null {
    return this.selectedDevice;
  }

  /**
   * Get detailed device information
   */
  async getDeviceInfo(): Promise<DeviceInfo> {
    if (!this.selectedDevice) {
      const devices = await this.listDevices();
      const connectedDevices = devices.filter(d => d.state === 'device');
      if (connectedDevices.length === 0) {
        throw new Error('No devices connected');
      }
      if (connectedDevices.length > 1) {
        throw new Error('Multiple devices connected. Please select a device first.');
      }
      this.selectedDevice = connectedDevices[0].serial;
    }

    const props = [
      'ro.product.model',
      'ro.product.brand',
      'ro.product.manufacturer',
      'ro.build.version.release',
      'ro.build.version.sdk',
      'ro.build.id',
    ];

    const results: Record<string, string> = {};

    for (const prop of props) {
      const result = await this.shell(`getprop ${prop}`);
      results[prop] = result.success ? result.stdout : '';
    }

    return {
      serial: this.selectedDevice,
      model: results['ro.product.model'] || 'Unknown',
      brand: results['ro.product.brand'] || 'Unknown',
      manufacturer: results['ro.product.manufacturer'] || 'Unknown',
      androidVersion: results['ro.build.version.release'] || 'Unknown',
      sdkVersion: parseInt(results['ro.build.version.sdk'] || '0', 10),
      buildId: results['ro.build.id'] || 'Unknown',
    };
  }

  /**
   * Setup port forwarding (host -> device)
   */
  async forward(localPort: number, remotePort: number): Promise<void> {
    const result = await this.exec(['forward', `tcp:${localPort}`, `tcp:${remotePort}`]);
    if (!result.success) {
      throw new Error(`Failed to setup port forwarding: ${result.stderr}`);
    }
  }

  /**
   * Setup reverse port forwarding (device -> host)
   */
  async reverse(remotePort: number, localPort: number): Promise<void> {
    const result = await this.exec(['reverse', `tcp:${remotePort}`, `tcp:${localPort}`]);
    if (!result.success) {
      throw new Error(`Failed to setup reverse port forwarding: ${result.stderr}`);
    }
  }

  /**
   * Remove port forwarding
   */
  async removeForward(localPort: number): Promise<void> {
    await this.exec(['forward', '--remove', `tcp:${localPort}`]);
  }

  /**
   * Remove reverse port forwarding
   */
  async removeReverse(remotePort: number): Promise<void> {
    await this.exec(['reverse', '--remove', `tcp:${remotePort}`]);
  }

  /**
   * Check if ADB is available
   */
  async checkAdb(): Promise<boolean> {
    try {
      const result = await this.exec(['version']);
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Wait for a device to be connected
   */
  async waitForDevice(timeout: number = 30000): Promise<void> {
    const result = await this.exec(['wait-for-device'], timeout);
    if (!result.success) {
      throw new Error(`Timeout waiting for device: ${result.stderr}`);
    }
  }

  /**
   * Execute an ADB command and capture stdout as a Buffer.
   * Used for binary streams (e.g. `adb exec-out screencap -p`).
   */
  async execBinary(args: string[], timeout: number = 30000): Promise<Buffer> {
    const deviceArgs = this.selectedDevice ? ['-s', this.selectedDevice] : [];
    const fullArgs = [...deviceArgs, ...args];

    return new Promise((resolve, reject) => {
      const proc = spawn(this.adbPath, fullArgs);
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`adb ${args.join(' ')} timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(Buffer.concat(chunks));
        } else {
          const err = Buffer.concat(errChunks).toString().trim();
          reject(new Error(`adb exited with code ${code}: ${err}`));
        }
      });
    });
  }
}
