/**
 * Unit tests for the companion-app IPC bridge.
 *
 * Covers the invariants we caught the hard way (#21 race, #22 scoped storage,
 * #25 message passthrough). Drives the public methods of EnterpriseWifiCommands
 * and NotificationCommands against a fake AdbClient that records every shell
 * call and serves scripted result-file content.
 *
 * Run with: npm run test:unit
 * Requires: npm run build (these tests import from dist/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnterpriseWifiCommands } from '../../dist/adb/enterprise-wifi.js';
import { NotificationCommands } from '../../dist/adb/notifications-commands.js';

const COMPANION_PACKAGE = 'com.example.wifimcpcompanion';

/**
 * Minimal AdbClient stand-in. Records every `shell` call. Branches on command
 * pattern to script useful responses (companion-app installed check, the
 * `cat files/wifi_mcp_result.json` poll). Everything else returns success
 * with empty stdout — enough to drive the real callers' control flow without
 * touching a device.
 */
class FakeAdbClient {
  constructor(opts = {}) {
    this.calls = [];
    this.resultFileContent = opts.resultFileContent ?? null;
    this.companionAppInstalled = opts.companionAppInstalled ?? true;
    this.commandWriteError = opts.commandWriteError ?? null;
  }

  async shell(command, _timeout) {
    this.calls.push(command);
    if (command.includes('pm list packages')) {
      return ok(this.companionAppInstalled ? `package:${COMPANION_PACKAGE}` : '');
    }
    // Simulate a failed command-file write (run-as denied, oversized payload, …).
    if (this.commandWriteError && command.includes('base64 -d > files/wifi_mcp_command.json')) {
      return fail(this.commandWriteError);
    }
    if (command.includes('cat files/wifi_mcp_result.json')) {
      return ok(this.resultFileContent ?? '');
    }
    return ok('');
  }

  async exec(_args, _timeout) {
    return ok('');
  }
}

function ok(stdout) {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

function fail(stderr) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

function validPeapConfig() {
  return {
    ssid: 'TestSSID',
    eapMethod: 'peap',
    identity: 'user',
    domainSuffixMatch: 'corp.example.com',
    password: 'pw',
  };
}

// ============ Race-fix invariant (#21) ============
//
// Contract: between `am broadcast` and the first `cat` poll of the result
// file, the bridge MUST NOT call `rm -f` on the result file. The receiver
// runs synchronously (~50 ms) and writes the result file before the host can
// resume — a `rm` in this window would delete the live result and the poll
// would time out for nothing.
//
// (A `rm -f` AFTER a cat that successfully read+parsed JSON is fine — that's
// the legitimate post-read cleanup at the tail of waitForResult.)

function assertNoClearBetweenBroadcastAndFirstCat(calls) {
  const broadcastIdx = calls.findIndex((c) => c.includes('am broadcast'));
  assert.ok(broadcastIdx >= 0, 'expected an am broadcast call');
  const firstCatIdx = calls.findIndex(
    (c, i) => i > broadcastIdx && c.includes('cat files/wifi_mcp_result.json')
  );
  assert.ok(firstCatIdx > broadcastIdx, 'expected a cat call after broadcast');
  for (let i = broadcastIdx + 1; i < firstCatIdx; i++) {
    assert.doesNotMatch(
      calls[i],
      /rm -f files\/wifi_mcp_result\.json/,
      `clearResultFile must not happen between broadcast and first cat poll ` +
        `(would race the receiver write); call #${i}: ${calls[i]}`
    );
  }
}

test('race: connectEnterprise clears result before broadcast, not after', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, ssid: 'TestSSID', eapMethod: 'peap' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  await ent.connectEnterprise(validPeapConfig());

  assert.match(fake.calls[1], /run-as .* base64 -d > files\/wifi_mcp_command\.json/);
  assert.match(fake.calls[2], /run-as .* rm -f files\/wifi_mcp_result\.json/);
  assert.match(fake.calls[3], /am broadcast/);
  assertNoClearBetweenBroadcastAndFirstCat(fake.calls);
});

test('race: installCertificate clears result before broadcast, not after', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, alias: 'a', type: 'ca' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  await ent.installCertificate('PEM', 'a', 'ca');

  assertNoClearBetweenBroadcastAndFirstCat(fake.calls);
});

test('race: getStatus clears result before broadcast, not after', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, listenerConnected: true, capturedCount: 0 }),
  });
  const notif = new NotificationCommands(fake);
  await notif.getStatus();

  assertNoClearBetweenBroadcastAndFirstCat(fake.calls);
});

test('race: listRecent clears result before broadcast, not after', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, count: 0, notifications: [] }),
  });
  const notif = new NotificationCommands(fake);
  await notif.listRecent({});

  assertNoClearBetweenBroadcastAndFirstCat(fake.calls);
});

// ============ Result normalization (#25) ============
//
// connectEnterprise / installCertificate translate the companion app's wire
// format into our typed result. The companion writes `message`; the host type
// expects `error`. The normalization needs to hide that difference.

test('normalize: success=true returns success with no error', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, ssid: 'TestSSID', eapMethod: 'peap' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  // verify:false isolates normalization (the suggestion-accepted path) from the
  // #70 association poll, which is covered by enterprise-verify.test.mjs.
  const result = await ent.connectEnterprise({ ...validPeapConfig(), verify: false });

  assert.equal(result.success, true);
  assert.equal(result.error, undefined);
  assert.equal(result.ssid, 'TestSSID');
  assert.equal(result.eapMethod, 'peap');
});

test('normalize: failure with raw.error uses error verbatim', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: false, error: 'cert validation failed' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  const result = await ent.connectEnterprise(validPeapConfig());

  assert.equal(result.success, false);
  assert.equal(result.error, 'cert validation failed');
});

test('normalize: failure with only raw.message uses message', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: false, message: 'Failed to read config file' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  const result = await ent.connectEnterprise(validPeapConfig());

  assert.equal(result.success, false);
  assert.equal(result.error, 'Failed to read config file');
});

test('normalize: failure with both error and message prefers error (more specific)', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({
      success: false,
      error: 'specific reason',
      message: 'generic reason',
    }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  const result = await ent.connectEnterprise(validPeapConfig());

  assert.equal(result.error, 'specific reason');
});

test('normalize: ssid / eapMethod fall back to call-site values when companion omits them', async () => {
  // Companion app's "Failed to read config file" path can't populate ssid /
  // eapMethod (it never reached the EAP layer). Normalizer falls back.
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: false, message: 'Failed to read config file' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  const result = await ent.connectEnterprise(validPeapConfig());

  assert.equal(result.ssid, 'TestSSID');
  assert.equal(result.eapMethod, 'peap');
});

// ============ Run-as command shape (#22) ============
//
// writeCommandFile must produce a shell-correct command that survives
// child_process.execFile + adb shell tokenization to land in the app's
// private filesDir. The b64-pipe-decode pattern was chosen specifically so
// JSON quotes and cert hyphens cannot break shell escaping.

test('run-as: writeCommandFile produces b64-pipe-decode command with correct payload', async () => {
  const fake = new FakeAdbClient({
    resultFileContent: JSON.stringify({ success: true, ssid: 'TestSSID', eapMethod: 'peap' }),
  });
  const ent = new EnterpriseWifiCommands(fake);
  await ent.connectEnterprise(validPeapConfig());

  const writeCall = fake.calls.find(
    (c) => c.includes('base64 -d') && c.includes('files/wifi_mcp_command.json')
  );
  assert.ok(writeCall, 'expected a writeCommandFile call');

  // Shape: run-as <pkg> sh -c 'echo <b64> | base64 -d > files/wifi_mcp_command.json'
  assert.match(writeCall, /^run-as com\.example\.wifimcpcompanion sh -c '/);
  assert.match(writeCall, /'echo [A-Za-z0-9+/=]+ \| base64 -d > files\/wifi_mcp_command\.json'$/);

  // Decode the b64 and verify it round-trips to the expected JSON
  const m = writeCall.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/);
  assert.ok(m, 'expected b64 payload in command');
  const decoded = JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'));

  assert.equal(decoded.action, 'connect_enterprise');
  assert.equal(decoded.ssid, 'TestSSID');
  assert.equal(decoded.eapMethod, 'peap');
  assert.equal(decoded.identity, 'user');
  assert.equal(decoded.domainSuffixMatch, 'corp.example.com');
  assert.equal(decoded.password, 'pw');
  assert.ok(typeof decoded.timestamp === 'number');
});

// ============ Command-file write failure (#115) ============
//
// A failed command-file write used to be ignored: the bridge broadcast anyway,
// the companion read a stale/missing file, and the host burned the full 30 s
// result-poll before reporting a bare timeout. The write must now fail fast
// with the underlying reason, and must NOT broadcast or poll.

test('write-failure: connectEnterprise fails fast with the write error, no broadcast', async () => {
  const fake = new FakeAdbClient({
    commandWriteError: 'run-as: Package is not debuggable',
  });
  const ent = new EnterpriseWifiCommands(fake);
  const result = await ent.connectEnterprise(validPeapConfig());

  assert.equal(result.success, false);
  assert.match(result.error, /run-as: Package is not debuggable/);
  // Must abort before broadcasting / polling — that was the 30 s hang.
  assert.ok(
    !fake.calls.some((c) => c.includes('am broadcast')),
    'must not broadcast after a failed command-file write'
  );
  assert.ok(
    !fake.calls.some((c) => c.includes('cat files/wifi_mcp_result.json')),
    'must not poll for a result after a failed command-file write'
  );
});
