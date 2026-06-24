/**
 * Unit tests for adb error redaction (#81).
 *
 * AdbClient.exec() used to fall back to Node's err.message on failure, which
 * for a timeout is `Command failed: <full command>` — leaking secret args
 * (Wi-Fi password, EAP creds) into AdbResult.stderr and tool_calls.error.
 * formatAdbError() must never echo the command.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAdbError } from '../../dist/adb/adb-client.js';

const SECRET = 'hunter2';
// What child_process rejects with when `adb ... connect-network '<ssid>' wpa2 '<pw>'` times out.
const TIMEOUT_ERR = {
  killed: true,
  signal: 'SIGTERM',
  stdout: '',
  stderr: '',
  message: `Command failed: adb -s 38301FDJH00CYN shell cmd wifi connect-network 'MySSID' wpa2 '${SECRET}'`,
};

test('formatAdbError: timeout message omits the command (no password leak)', () => {
  const msg = formatAdbError(TIMEOUT_ERR, 30000);
  assert.equal(msg, 'adb command timed out after 30000ms');
  assert.ok(!msg.includes(SECRET), 'must not leak the password');
  assert.ok(!msg.includes('connect-network'), 'must not echo the command');
});

test('formatAdbError: never returns err.message even when stderr is empty', () => {
  const msg = formatAdbError(
    { message: "Command failed: adb ... 'topsecret'", stderr: '', code: 7 },
    5000
  );
  assert.ok(!msg.includes('topsecret'), 'must not leak via the exit path either');
  assert.equal(msg, 'adb command failed (exit 7)');
});

test('formatAdbError: passes through device stderr (no command line) when present', () => {
  assert.equal(
    formatAdbError({ stderr: "error: device '38301FDJH00CYN' not found", code: 1 }, 30000),
    "error: device '38301FDJH00CYN' not found"
  );
});

test('formatAdbError: generic message on a bare failure with no detail', () => {
  assert.equal(formatAdbError({}, 30000), 'adb command failed');
});
