/**
 * Unit tests for wifi_connect association verification (#65).
 *
 * connect() used a single 3s sleep + one status check, false-negativing slow
 * associations (measured 4.8–8.6s on a Pixel 8). It now polls getStatus until
 * the target SSID is reported, with an early-bail when the supplicant settles
 * in a terminal state after having been active.
 *
 * These cover the bail *mechanism* (terminal-after-active → fail), not a
 * guarantee that every device failure fast-fails: on real hardware a wrong
 * password can sit in ASSOCIATING past the deadline and fall back to the
 * timeout result (see #65 follow-up). The deadline is the backstop.
 *
 * Drives connect() against a fake AdbClient that serves a scripted sequence of
 * `dumpsys wifi` snapshots. Success/bail paths resolve well before the 10s
 * deadline, so the tests stay fast.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WifiCommands } from '../../dist/adb/wifi-commands.js';

const ok = stdout => ({ success: true, stdout, stderr: '', exitCode: 0 });

// dumpsys-grep snapshots that getStatus() parses.
const ASSOCIATING = 'mWifiInfo SSID: "<unknown ssid>", RSSI: -127, Supplicant state: ASSOCIATING';
const CONNECTED = 'mWifiInfo SSID: "TestNet", RSSI: -45, Supplicant state: COMPLETED';
const DISCONNECTED = 'mWifiInfo SSID: "<unknown ssid>", RSSI: -127, Supplicant state: DISCONNECTED';

class FakeAdb {
  constructor(dumpsysSeq) {
    this.seq = dumpsysSeq;
    this.calls = [];
  }
  async shell(cmd) {
    this.calls.push(cmd);
    if (cmd.includes('connect-network')) return ok(''); // accepted, no error keywords
    if (cmd.includes('dumpsys wifi')) {
      return ok(this.seq.length > 1 ? this.seq.shift() : this.seq[0]);
    }
    if (cmd.includes('cmd wifi status')) return ok('Wifi is enabled');
    return ok('');
  }
}

test('succeeds once the target SSID is reported (slow association)', async () => {
  const wifi = new WifiCommands(new FakeAdb([ASSOCIATING, CONNECTED]));
  const r = await wifi.connect('TestNet', 'open');
  assert.equal(r.success, true);
  assert.equal(r.ssid, 'TestNet');
});

test('early-bails with the supplicant state once it settles terminal after being active', async () => {
  // Mechanism check: active (ASSOCIATING) then a sustained terminal state →
  // fail fast with the state in the error. (Real auth failures don't always
  // present this way within the deadline — see the file header.)
  const wifi = new WifiCommands(new FakeAdb([ASSOCIATING, DISCONNECTED, DISCONNECTED]));
  const r = await wifi.connect('TestNet', 'wpa2', 'somepass');
  assert.equal(r.success, false);
  assert.match(r.error, /supplicant state: DISCONNECTED/);
});

test('does NOT bail on an initial DISCONNECTED before any active state', async () => {
  // Pre-association DISCONNECTED must not be treated as a failure; once the
  // SSID shows up the connect still succeeds.
  const wifi = new WifiCommands(new FakeAdb([DISCONNECTED, DISCONNECTED, CONNECTED]));
  const r = await wifi.connect('TestNet', 'open');
  assert.equal(r.success, true);
});

test('reports stdout errors from connect-network immediately', async () => {
  const adb = new FakeAdb([CONNECTED]);
  adb.shell = async cmd => {
    adb.calls.push(cmd);
    if (cmd.includes('connect-network')) return ok('Error: unknown network');
    return ok('');
  };
  const wifi = new WifiCommands(adb);
  const r = await wifi.connect('TestNet', 'open');
  assert.equal(r.success, false);
  assert.match(r.error, /unknown network/i);
});
