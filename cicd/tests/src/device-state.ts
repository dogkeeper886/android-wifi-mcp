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

/**
 * Trigger a scan and confirm an SSID is currently in range. Best-effort: a throttled
 * or failed scan still reads the cached results; returns false if nothing matches or
 * the read fails. Used by a case's `requires.ssidInRange` precondition.
 */
export async function ensureSsidInRange(ssid: string, settleMs = 4000): Promise<boolean> {
  try {
    await adbShell('cmd wifi start-scan');
  } catch {
    // throttled/failed — fall through and read whatever is cached
  }
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  try {
    const out = await adbShell('cmd wifi list-scan-results');
    return out.split('\n').some((line) => line.includes(ssid));
  } catch {
    return false;
  }
}

/**
 * Forget saved networks — the "clear config" primitive for a case's `setup`/`teardown`.
 * Boundary so a shared phone is never wiped: `all` requires `TEST_DEDICATED_DEVICE=true`;
 * otherwise only networks whose SSID is in `ssids` (the caller's explicit allowlist) are
 * forgotten — an unlisted (personal) network is never touched. Returns how many were
 * forgotten.
 */
export async function clearSavedNetworks(opts: { ssids?: string[]; all?: boolean }): Promise<number> {
  const dedicated = /^(1|true|yes)$/i.test(process.env.TEST_DEDICATED_DEVICE || '');
  const saved = await listSavedNetworks();

  let targets: Array<{ id: number; ssid: string }>;
  if (opts.all) {
    if (!dedicated) {
      throw new Error(
        'clearSavedNetworks({ all: true }) refused: set TEST_DEDICATED_DEVICE=true to wipe all saved networks (guards a shared phone).'
      );
    }
    targets = saved;
  } else {
    const allow = new Set(opts.ssids ?? []);
    targets = saved.filter((n) => allow.has(n.ssid));
  }

  const forgotten = new Set<number>();
  for (const n of targets) {
    if (forgotten.has(n.id)) continue;
    try {
      await adbShell(`cmd wifi forget-network ${n.id}`);
      forgotten.add(n.id);
    } catch {
      // best-effort — a missing id is not fatal
    }
  }
  return forgotten.size;
}

/** Saved networks as {id, ssid}. Parses `cmd wifi list-networks` where the SSID column
 *  may contain spaces (id is the first token, security the last, SSID everything between);
 *  dedupes the per-security-param duplicate rows by id. */
async function listSavedNetworks(): Promise<Array<{ id: number; ssid: string }>> {
  try {
    const output = await adbShell('cmd wifi list-networks');
    const nets: Array<{ id: number; ssid: string }> = [];
    const seen = new Set<number>();
    for (const line of output.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('Network Id')) continue;
      const m = t.match(/^(\d+)\s+(.+?)\s+\S+$/);
      if (!m) continue;
      const id = parseInt(m[1], 10);
      if (seen.has(id)) continue;
      seen.add(id);
      nets.push({ id, ssid: m[2].trim() });
    }
    return nets;
  } catch {
    return [];
  }
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
