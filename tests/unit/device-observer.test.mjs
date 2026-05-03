/**
 * Unit tests for src/adb/device-observer.ts pure helpers + the framer.
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 *
 * Subprocess + DB integration is verified manually with a real device — see
 * the PR's "End-to-end verification" section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTrackDevicesPayload,
  diffSnapshots,
  FrameDecoder,
} from '../../dist/adb/device-observer.js';

// ============ parseTrackDevicesPayload ============

test('parse: empty string → no devices', () => {
  assert.deepEqual(parseTrackDevicesPayload(''), []);
});

test('parse: single device line', () => {
  assert.deepEqual(parseTrackDevicesPayload('R5CR12ATMCB\tdevice\n'), [
    { serial: 'R5CR12ATMCB', state: 'device' },
  ]);
});

test('parse: multiple devices', () => {
  const payload = 'R5CR12ATMCB\tdevice\nemulator-5554\tdevice\n';
  assert.deepEqual(parseTrackDevicesPayload(payload), [
    { serial: 'R5CR12ATMCB', state: 'device' },
    { serial: 'emulator-5554', state: 'device' },
  ]);
});

test('parse: handles unauthorized + offline + recovery states', () => {
  const payload = 'A\tunauthorized\nB\toffline\nC\trecovery\n';
  assert.deepEqual(parseTrackDevicesPayload(payload), [
    { serial: 'A', state: 'unauthorized' },
    { serial: 'B', state: 'offline' },
    { serial: 'C', state: 'recovery' },
  ]);
});

test('parse: skips lines without a tab', () => {
  assert.deepEqual(parseTrackDevicesPayload('garbage\nA\tdevice\n'), [
    { serial: 'A', state: 'device' },
  ]);
});

test('parse: tolerates trailing whitespace', () => {
  assert.deepEqual(parseTrackDevicesPayload('A\tdevice  \n'), [
    { serial: 'A', state: 'device' },
  ]);
});

// ============ diffSnapshots ============

const ts = new Date('2026-05-03T03:00:00Z');

test('diff: identical snapshots → no transitions', () => {
  const s = [{ serial: 'A', state: 'device' }];
  assert.deepEqual(diffSnapshots(s, s, ts), []);
});

test('diff: new device appearing', () => {
  const out = diffSnapshots([], [{ serial: 'A', state: 'device' }], ts);
  assert.deepEqual(out, [
    { serial: 'A', prev_state: null, new_state: 'device', ts },
  ]);
});

test('diff: device disappearing', () => {
  const out = diffSnapshots([{ serial: 'A', state: 'device' }], [], ts);
  assert.deepEqual(out, [
    { serial: 'A', prev_state: 'device', new_state: null, ts },
  ]);
});

test('diff: state change is one transition', () => {
  const out = diffSnapshots(
    [{ serial: 'A', state: 'unauthorized' }],
    [{ serial: 'A', state: 'device' }],
    ts
  );
  assert.deepEqual(out, [
    { serial: 'A', prev_state: 'unauthorized', new_state: 'device', ts },
  ]);
});

test('diff: simultaneous add + remove + change', () => {
  const prev = [
    { serial: 'A', state: 'device' },
    { serial: 'B', state: 'unauthorized' },
  ];
  const next = [
    { serial: 'B', state: 'device' },
    { serial: 'C', state: 'device' },
  ];
  const out = diffSnapshots(prev, next, ts);
  // Order: present-in-next (changed B, new C), then absent-in-next (gone A).
  assert.deepEqual(out, [
    { serial: 'B', prev_state: 'unauthorized', new_state: 'device', ts },
    { serial: 'C', prev_state: null, new_state: 'device', ts },
    { serial: 'A', prev_state: 'device', new_state: null, ts },
  ]);
});

// ============ FrameDecoder ============

function encode(payload) {
  const len = Buffer.byteLength(payload, 'utf8').toString(16).padStart(4, '0');
  return Buffer.concat([Buffer.from(len, 'ascii'), Buffer.from(payload, 'utf8')]);
}

test('framer: decodes a complete single frame', () => {
  const fd = new FrameDecoder();
  const out = fd.push(encode('R5CR12ATMCB\tdevice\n'));
  assert.deepEqual(out, ['R5CR12ATMCB\tdevice\n']);
});

test('framer: decodes multiple frames in one chunk', () => {
  const fd = new FrameDecoder();
  const out = fd.push(Buffer.concat([encode('A\tdevice\n'), encode('B\toffline\n')]));
  assert.deepEqual(out, ['A\tdevice\n', 'B\toffline\n']);
});

test('framer: handles partial reads (length prefix split)', () => {
  const fd = new FrameDecoder();
  const enc = encode('A\tdevice\n');
  // Split mid-prefix.
  assert.deepEqual(fd.push(enc.subarray(0, 2)), []);
  assert.deepEqual(fd.push(enc.subarray(2)), ['A\tdevice\n']);
});

test('framer: handles partial reads (payload split)', () => {
  const fd = new FrameDecoder();
  const enc = encode('A\tdevice\n');
  // Split mid-payload.
  assert.deepEqual(fd.push(enc.subarray(0, 7)), []);
  assert.deepEqual(fd.push(enc.subarray(7)), ['A\tdevice\n']);
});

test('framer: handles empty payload (no devices)', () => {
  const fd = new FrameDecoder();
  const out = fd.push(Buffer.from('0000', 'ascii'));
  assert.deepEqual(out, ['']);
});

test('framer: drops corrupt non-hex prefix and resyncs on next chunk', () => {
  const fd = new FrameDecoder();
  // Corrupt — non-hex chars in the prefix slot.
  fd.push(Buffer.from('zzzz', 'ascii'));
  // After the drop, a clean frame should decode normally.
  const out = fd.push(encode('A\tdevice\n'));
  assert.deepEqual(out, ['A\tdevice\n']);
});
