/**
 * Unit tests for src/log/traceparent.ts.
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTraceparent, traceIdToUuid } from '../../dist/log/traceparent.js';

const VALID = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

// ============ parseTraceparent ============

test('parseTraceparent: undefined returns null', () => {
  assert.equal(parseTraceparent(undefined), null);
});

test('parseTraceparent: empty string returns null', () => {
  assert.equal(parseTraceparent(''), null);
});

test('parseTraceparent: valid sampled header parses', () => {
  const out = parseTraceparent(VALID);
  assert.deepEqual(out, {
    version: '00',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    parent_id: 'b7ad6b7169203331',
    trace_flags: '01',
    sampled: true,
  });
});

test('parseTraceparent: trace_flags=00 yields sampled=false', () => {
  const h = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00';
  assert.equal(parseTraceparent(h)?.sampled, false);
});

test('parseTraceparent: rejects all-zero trace_id', () => {
  const h = '00-00000000000000000000000000000000-b7ad6b7169203331-01';
  assert.equal(parseTraceparent(h), null);
});

test('parseTraceparent: rejects all-zero parent_id', () => {
  const h = '00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01';
  assert.equal(parseTraceparent(h), null);
});

test('parseTraceparent: rejects version ff (reserved)', () => {
  const h = 'ff-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  assert.equal(parseTraceparent(h), null);
});

test('parseTraceparent: rejects upper-case hex (spec is lower-case only)', () => {
  const h = '00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01';
  assert.equal(parseTraceparent(h), null);
});

test('parseTraceparent: rejects wrong segment lengths', () => {
  assert.equal(parseTraceparent('00-deadbeef-b7ad6b7169203331-01'), null);
  assert.equal(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-shortspan-01'), null);
  assert.equal(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-1'), null);
});

test('parseTraceparent: rejects non-hex chars', () => {
  const h = '00-0af7651916cd43dd8448eb211c803zzzz-b7ad6b7169203331-01';
  assert.equal(parseTraceparent(h), null);
});

test('parseTraceparent: handles comma-separated list (uses first)', () => {
  // RFC allows multi-vendor lists; we honor only the first entry.
  const h = `${VALID}, 00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-cccccccccccccccc-00`;
  assert.equal(parseTraceparent(h)?.trace_id, '0af7651916cd43dd8448eb211c80319c');
});

test('parseTraceparent: trims whitespace', () => {
  assert.equal(parseTraceparent(`   ${VALID}   `)?.trace_id, '0af7651916cd43dd8448eb211c80319c');
});

test('parseTraceparent: accepts unknown future version (forward compat)', () => {
  const h = '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
  assert.equal(parseTraceparent(h)?.version, '01');
});

// ============ traceIdToUuid ============

test('traceIdToUuid: converts 32-hex to UUID format', () => {
  const out = traceIdToUuid('0af7651916cd43dd8448eb211c80319c');
  assert.equal(out, '0af76519-16cd-43dd-8448-eb211c80319c');
});

test('traceIdToUuid: throws on wrong length', () => {
  assert.throws(() => traceIdToUuid('deadbeef'), /32 hex chars/);
});
