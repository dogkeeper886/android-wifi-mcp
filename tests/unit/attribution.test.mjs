/**
 * Unit tests for src/log/attribution.ts (Phase 4 classifier) and the
 * middleware's wiring of attribution into recorded errors.
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeFailure } from '../../dist/log/attribution.js';
import { buildRecordingHandler } from '../../dist/log/middleware.js';

const ts0 = new Date('2026-05-03T05:00:00Z');
const tsCallStart = new Date('2026-05-03T05:00:10Z');
const tsCallEnd = new Date('2026-05-03T05:00:11Z');
const tsBeforeWindow = new Date('2026-05-03T05:00:04Z'); // 6s before start, outside 5s window
const tsInWindow = new Date('2026-05-03T05:00:09Z'); // 1s before start
const tsDuringCall = new Date('2026-05-03T05:00:10.5Z');
const tsJustAfter = new Date('2026-05-03T05:00:11.5Z'); // within 1s post-window

const call = { started_at: tsCallStart, completed_at: tsCallEnd };

// ============ attributeFailure ============

test('attribution: no events → null', () => {
  assert.equal(attributeFailure(call, []), null);
});

test('attribution: event before window → null', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: null, ts: tsBeforeWindow },
  ];
  assert.equal(attributeFailure(call, events), null);
});

test('attribution: event in pre-window classifies', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: null, ts: tsInWindow },
  ];
  const out = attributeFailure(call, events);
  assert.equal(out?.classification, 'physical_disconnect');
  assert.equal(out?.related_event?.serial, 'A');
});

test('attribution: event during call classifies', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: null, ts: tsDuringCall },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'physical_disconnect'
  );
});

test('attribution: event in post-window classifies', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: null, ts: tsJustAfter },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'physical_disconnect'
  );
});

test('attribution: unauthorized → gone = rsa_revoked', () => {
  const events = [
    { serial: 'A', prev_state: 'unauthorized', new_state: null, ts: tsInWindow },
  ];
  const out = attributeFailure(call, events);
  assert.equal(out?.classification, 'rsa_revoked');
  assert.match(out.hint, /unauthorized/);
});

test('attribution: → unauthorized = rsa_revoked', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: 'unauthorized', ts: tsInWindow },
  ];
  assert.equal(attributeFailure(call, events)?.classification, 'rsa_revoked');
});

test('attribution: offline → gone = adb_server_confusion', () => {
  const events = [
    { serial: 'A', prev_state: 'offline', new_state: null, ts: tsInWindow },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'adb_server_confusion'
  );
});

test('attribution: → offline = adb_server_confusion', () => {
  const events = [
    { serial: 'A', prev_state: 'device', new_state: 'offline', ts: tsInWindow },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'adb_server_confusion'
  );
});

test('attribution: unrecognizable transition shape = unknown_disconnect', () => {
  const events = [
    { serial: 'A', prev_state: 'recovery', new_state: null, ts: tsInWindow },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'unknown_disconnect'
  );
});

test('attribution: device APPEARING in window → null (correlation noise)', () => {
  // Startup-time `null → device` transition shouldn't attach attribution to
  // an unrelated tool failure that happens shortly after.
  const events = [
    { serial: 'A', prev_state: null, new_state: 'device', ts: tsInWindow },
  ];
  assert.equal(attributeFailure(call, events), null);
});

test('attribution: state-improvement (offline → device) in window → null', () => {
  const events = [
    { serial: 'A', prev_state: 'offline', new_state: 'device', ts: tsInWindow },
  ];
  assert.equal(attributeFailure(call, events), null);
});

test('attribution: hint includes serial and timestamp', () => {
  const events = [
    { serial: 'R5CR12ATMCB', prev_state: 'device', new_state: null, ts: tsInWindow },
  ];
  const out = attributeFailure(call, events);
  assert.match(out.hint, /R5CR12ATMCB/);
  assert.match(out.hint, /2026-05-03T05:00:09/);
});

test('attribution: picks first event when multiple in window (newest-first)', () => {
  // getRecent returns newest-first; classifier uses .find() which picks the
  // first match (= the most recent in window).
  const events = [
    { serial: 'A', prev_state: 'unauthorized', new_state: null, ts: tsInWindow },
    { serial: 'B', prev_state: 'device', new_state: null, ts: tsBeforeWindow },
  ];
  assert.equal(
    attributeFailure(call, events)?.classification,
    'rsa_revoked'
  );
});

// ============ middleware wiring ============

const mkRequest = (name, args) => ({ params: { name, arguments: args } });

test('middleware: attribution attached to recorded error when transition matches', async () => {
  const recorded = [];
  const original = async () => {
    throw new Error('adb: no devices/emulators found');
  };
  const observer = {
    getRecent: () => [
      { serial: 'A', prev_state: 'device', new_state: null, ts: new Date() },
    ],
  };
  const handler = buildRecordingHandler(
    original,
    undefined,
    async (c) => recorded.push(c),
    observer
  );

  await assert.rejects(() => handler(mkRequest('wifi_status', {}), {}));
  assert.equal(recorded.length, 1);
  const err = recorded[0].error;
  assert.equal(err.source, 'thrown');
  assert.equal(err.attribution.classification, 'physical_disconnect');
  assert.equal(err.attribution.related_event.serial, 'A');
});

test('middleware: no attribution attached when no observer wired', async () => {
  const recorded = [];
  const original = async () => {
    throw new Error('boom');
  };
  const handler = buildRecordingHandler(
    original,
    undefined,
    async (c) => recorded.push(c)
  );

  await assert.rejects(() => handler(mkRequest('wifi_status', {}), {}));
  assert.equal(recorded[0].error.attribution, undefined);
});

test('middleware: no attribution attached when call succeeds', async () => {
  const recorded = [];
  const original = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  const observer = {
    getRecent: () => [
      { serial: 'A', prev_state: 'device', new_state: null, ts: new Date() },
    ],
  };
  const handler = buildRecordingHandler(
    original,
    undefined,
    async (c) => recorded.push(c),
    observer
  );

  await handler(mkRequest('device_list', {}), {});
  assert.equal(recorded[0].error, undefined);
});

test('middleware: attribution attached to isError tool result', async () => {
  const recorded = [];
  const original = async () => ({
    isError: true,
    content: [{ type: 'text', text: 'wifi_connect failed' }],
  });
  const observer = {
    getRecent: () => [
      { serial: 'A', prev_state: 'device', new_state: 'unauthorized', ts: new Date() },
    ],
  };
  const handler = buildRecordingHandler(
    original,
    undefined,
    async (c) => recorded.push(c),
    observer
  );

  await handler(mkRequest('wifi_connect', {}), {});
  const err = recorded[0].error;
  assert.equal(err.source, 'tool_result');
  assert.equal(err.attribution.classification, 'rsa_revoked');
});
