/**
 * Device state snapshot/restore — runs adb directly (bypassing the MCP server)
 * so test setup doesn't depend on the very thing under test.
 *
 * snapshot: WiFi enabled, currently-connected SSID (best-effort), saved-network IDs.
 * restore:  match WiFi enabled state, forget any networks added during the test.
 *
 * We do NOT manually reconnect to the original SSID — Android auto-reconnects
 * to known saved networks when WiFi comes up.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DeviceSnapshot {
  wifiEnabled: boolean;
  currentSsid: string | null;
  savedNetworkIds: number[];
}

const ADB = process.env.ADB_PATH || 'adb';

function adbArgs(): string {
  const serial = process.env.TEST_DEVICE_SERIAL;
  return serial ? `-s ${serial}` : '';
}

async function adbShell(cmd: string, timeout = 15000): Promise<string> {
  const { stdout } = await execAsync(`${ADB} ${adbArgs()} shell ${cmd}`, { timeout });
  return stdout;
}

export async function snapshotDeviceState(): Promise<DeviceSnapshot> {
  const statusOut = await adbShell('cmd wifi status');
  const wifiEnabled = /wifi is enabled/i.test(statusOut);

  let currentSsid: string | null = null;
  if (wifiEnabled) {
    try {
      const dumpsys = await adbShell('dumpsys wifi | grep -E "SSID:" | head -3');
      const match = dumpsys.match(/SSID:\s*["']?([^"',\n]+)["']?/i);
      if (match && match[1] && match[1] !== '<none>' && match[1].trim() !== '') {
        currentSsid = match[1].trim();
      }
    } catch {
      // Best-effort — leave null
    }
  }

  const savedNetworkIds = await listSavedNetworkIds();

  return { wifiEnabled, currentSsid, savedNetworkIds };
}

export async function restoreDeviceState(snapshot: DeviceSnapshot): Promise<void> {
  // Match WiFi enabled state.
  const currentStatus = await adbShell('cmd wifi status');
  const isEnabled = /wifi is enabled/i.test(currentStatus);
  if (snapshot.wifiEnabled && !isEnabled) {
    await adbShell('cmd wifi set-wifi-enabled enabled');
  } else if (!snapshot.wifiEnabled && isEnabled) {
    await adbShell('cmd wifi set-wifi-enabled disabled');
  }

  // Forget any networks added during the test.
  const currentIds = await listSavedNetworkIds();
  const originalSet = new Set(snapshot.savedNetworkIds);
  const added = currentIds.filter((id) => !originalSet.has(id));
  for (const id of added) {
    try {
      await adbShell(`cmd wifi forget-network ${id}`);
    } catch {
      // Best-effort — a missing network ID is not fatal.
    }
  }
}

async function listSavedNetworkIds(): Promise<number[]> {
  try {
    const output = await adbShell('cmd wifi list-networks');
    const ids = new Set<number>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('Network Id')) continue;
      const match = trimmed.match(/^(\d+)\s+/);
      if (match) ids.add(parseInt(match[1], 10));
    }
    return Array.from(ids);
  } catch {
    return [];
  }
}
