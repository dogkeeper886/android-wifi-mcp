import { AdbClient } from './adb-client.js';
import { WifiCommands } from './wifi-commands.js';
import { Device, DeviceInfo } from '../types.js';

/**
 * Manages connected Android devices and provides unified access
 * to ADB and WiFi commands.
 */
export class DeviceManager {
  private adb: AdbClient;
  private wifi: WifiCommands;
  private devices: Map<string, DeviceInfo> = new Map();

  constructor(adbPath?: string) {
    this.adb = new AdbClient(adbPath);
    this.wifi = new WifiCommands(this.adb);
  }

  /**
   * Get the ADB client instance
   */
  getAdbClient(): AdbClient {
    return this.adb;
  }

  /**
   * Get the WiFi commands instance
   */
  getWifiCommands(): WifiCommands {
    return this.wifi;
  }

  /**
   * Initialize and check ADB availability
   */
  async initialize(): Promise<boolean> {
    const adbAvailable = await this.adb.checkAdb();
    if (!adbAvailable) {
      throw new Error('ADB is not available. Please install Android SDK Platform Tools.');
    }
    return true;
  }

  /**
   * Refresh the list of connected devices
   */
  async refreshDevices(): Promise<Device[]> {
    const devices = await this.adb.listDevices();

    // Update device info cache for connected devices
    for (const device of devices) {
      if (device.state === 'device' && !this.devices.has(device.serial)) {
        try {
          this.adb.selectDevice(device.serial);
          const info = await this.adb.getDeviceInfo();
          this.devices.set(device.serial, info);
        } catch {
          // Ignore errors when getting device info
        }
      }
    }

    // Remove disconnected devices from cache
    const connectedSerials = new Set(devices.map(d => d.serial));
    for (const serial of this.devices.keys()) {
      if (!connectedSerials.has(serial)) {
        this.devices.delete(serial);
      }
    }

    // Restore previous selection if still valid
    const currentSelection = this.adb.getSelectedDevice();
    if (currentSelection && !connectedSerials.has(currentSelection)) {
      this.adb.selectDevice(null);
    }

    return devices;
  }

  /**
   * List connected devices with their info
   */
  async listDevices(): Promise<Array<Device & Partial<DeviceInfo>>> {
    const devices = await this.refreshDevices();

    return devices.map(device => ({
      ...device,
      ...this.devices.get(device.serial),
    }));
  }

  /**
   * Select a device by serial number
   */
  selectDevice(serial: string | null): void {
    if (serial !== null && !this.devices.has(serial)) {
      // Allow selection even if not in cache - device might be new
    }
    this.adb.selectDevice(serial);
  }

  /**
   * Get the currently selected device
   */
  getSelectedDevice(): string | null {
    return this.adb.getSelectedDevice();
  }

  /**
   * Get info for the currently selected device
   */
  async getSelectedDeviceInfo(): Promise<DeviceInfo> {
    return this.adb.getDeviceInfo();
  }

  /**
   * Get cached device info
   */
  getCachedDeviceInfo(serial: string): DeviceInfo | undefined {
    return this.devices.get(serial);
  }

  /**
   * Ensure a device is selected, auto-selecting if only one is connected
   */
  async ensureDeviceSelected(): Promise<string> {
    const currentSelection = this.adb.getSelectedDevice();
    if (currentSelection) {
      return currentSelection;
    }

    const devices = await this.refreshDevices();
    const connectedDevices = devices.filter(d => d.state === 'device');

    if (connectedDevices.length === 0) {
      throw new Error('No Android devices connected. Please connect a device with USB debugging enabled.');
    }

    if (connectedDevices.length > 1) {
      throw new Error(
        `Multiple devices connected: ${connectedDevices.map(d => d.serial).join(', ')}. ` +
        'Please select a device using device_select.'
      );
    }

    // Auto-select the only connected device
    this.adb.selectDevice(connectedDevices[0].serial);
    return connectedDevices[0].serial;
  }

  /**
   * Check device Android version
   */
  async checkAndroidVersion(): Promise<{ supported: boolean; version: number; message: string }> {
    const info = await this.adb.getDeviceInfo();
    const version = info.sdkVersion;

    if (version < 30) {
      return {
        supported: false,
        version,
        message: `Android SDK ${version} detected. This tool requires Android 11 (SDK 30) or higher for full functionality.`,
      };
    }

    return {
      supported: true,
      version,
      message: `Android SDK ${version} detected. Full functionality available.`,
    };
  }
}

// Export a singleton instance
export const deviceManager = new DeviceManager();
