import { AdbClient } from './adb-client.js';
import { WifiCommands } from './wifi-commands.js';
import { ScreenshotCommands } from './screenshot-commands.js';
import { SmsCommands } from './sms-commands.js';
import { NotificationCommands } from './notifications-commands.js';
import { SettingsCommands } from './settings-commands.js';
import { FileCommands } from './file-commands.js';
import { Device, DeviceInfo } from '../types.js';
import type { DeviceObserver } from './device-observer.js';

function formatElapsed(ms: number): string {
  if (ms < 0) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

/**
 * Manages connected Android devices and provides unified access
 * to ADB, WiFi, UI, SMS, notification, settings, and file commands.
 */
export class DeviceManager {
  private adb: AdbClient;
  private wifi: WifiCommands;
  private screenshot: ScreenshotCommands;
  private sms: SmsCommands;
  private notifications: NotificationCommands;
  private settings: SettingsCommands;
  private files: FileCommands;
  private devices: Map<string, DeviceInfo> = new Map();
  private observer: DeviceObserver | null = null;

  constructor(adbPath?: string) {
    this.adb = new AdbClient(adbPath);
    this.wifi = new WifiCommands(this.adb);
    this.screenshot = new ScreenshotCommands(this.adb);
    this.sms = new SmsCommands(this.adb);
    this.notifications = new NotificationCommands(this.adb);
    this.settings = new SettingsCommands(this.adb);
    this.files = new FileCommands(this.adb);
  }

  /**
   * Wire in the device observer so ensureDeviceSelected() can enrich its
   * "no device" error with last-seen state. Optional — DeviceManager runs
   * without it (just throws the plain message).
   */
  setObserver(observer: DeviceObserver): void {
    this.observer = observer;
  }

  getObserver(): DeviceObserver | null {
    return this.observer;
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
   * Get the screenshot commands instance
   */
  getScreenshotCommands(): ScreenshotCommands {
    return this.screenshot;
  }

  /**
   * Get the SMS commands instance
   */
  getSmsCommands(): SmsCommands {
    return this.sms;
  }

  /**
   * Get the notification commands instance
   */
  getNotificationCommands(): NotificationCommands {
    return this.notifications;
  }

  /**
   * Get the settings commands instance
   */
  getSettingsCommands(): SettingsCommands {
    return this.settings;
  }

  /**
   * Get the file transfer commands instance
   */
  getFileCommands(): FileCommands {
    return this.files;
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
      throw new Error(this.formatNoDeviceError());
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
   * Build the "no device" error message, enriching with last-seen state from
   * the observer when available. Goal is to let an agent decide between
   * "ask user to replug", "restart emulator", and "re-accept RSA prompt"
   * without falling back to host-side probing — the operational pain
   * documented in #49.
   */
  private formatNoDeviceError(): string {
    const base = 'No Android devices connected. Please connect a device with USB debugging enabled.';
    if (!this.observer) return base;

    const detach = this.observer.getMostRecentDetach();
    if (!detach) return base;

    const elapsedMs = Date.now() - detach.ts.getTime();
    const elapsed = formatElapsed(elapsedMs);
    const fromState = detach.prev_state ?? 'unknown';

    return (
      `${base} ` +
      `Last seen: ${detach.serial} left '${fromState}' state ${elapsed} ago ` +
      `(at ${detach.ts.toISOString()}). ` +
      `Hint: depending on the prior state — 'device' suggests physical disconnect, ` +
      `USB autosuspend, or device sleep; 'unauthorized' suggests RSA revocation; ` +
      `'offline' suggests adb-server confusion or emulator death. ` +
      `Use device_event_log for the full transition history.`
    );
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
