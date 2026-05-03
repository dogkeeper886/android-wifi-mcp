/**
 * Unit tests for src/log/query.ts buildQuery — the pure SQL builder used
 * by the query_log tool (Phase 5 of #51).
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 *
 * runQuery's DB-execution path is verified manually against a live
 * Postgres in the PR's "End-to-end verification" section.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from '../../dist/log/query.js';

// Helper: collapse whitespace so SQL comparisons aren't formatting-sensitive.
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ============ no filters ============

test('buildQuery: no filters → no WHERE clause, default limit', () => {
  const q = buildQuery({});
  assert.equal(q.callsParams.length, 0);
  assert.match(norm(q.callsSql), /FROM tool_calls\s+ORDER BY started_at DESC LIMIT 50 OFFSET 0/);
  assert.doesNotMatch(norm(q.callsSql), /WHERE/);
  assert.match(norm(q.countSql), /^SELECT count\(\*\)::int AS total FROM tool_calls$/);
});

// ============ each filter individually ============

test('buildQuery: trace_id filter parameterizes', () => {
  const q = buildQuery({ trace_id: 'abc' });
  assert.deepEqual(q.callsParams, ['abc']);
  assert.match(norm(q.callsSql), /WHERE trace_id = \$1/);
});

test('buildQuery: tool_name filter', () => {
  const q = buildQuery({ tool_name: 'wifi_connect' });
  assert.deepEqual(q.callsParams, ['wifi_connect']);
  assert.match(norm(q.callsSql), /tool_name = \$1/);
});

test('buildQuery: surface filter', () => {
  const q = buildQuery({ surface: 'proxy:playwright' });
  assert.deepEqual(q.callsParams, ['proxy:playwright']);
  assert.match(norm(q.callsSql), /surface = \$1/);
});

test('buildQuery: since/until parsed as Date', () => {
  const q = buildQuery({ since: '2026-05-03T00:00:00Z', until: '2026-05-04T00:00:00Z' });
  assert.equal(q.callsParams.length, 2);
  assert.ok(q.callsParams[0] instanceof Date);
  assert.ok(q.callsParams[1] instanceof Date);
  assert.match(norm(q.callsSql), /started_at >= \$1 AND started_at <= \$2/);
});

test('buildQuery: invalid since timestamp throws', () => {
  assert.throws(() => buildQuery({ since: 'not a date' }), /Invalid since timestamp/);
});

test('buildQuery: errors_only emits IS NOT NULL (no parameter)', () => {
  const q = buildQuery({ errors_only: true });
  assert.equal(q.callsParams.length, 0);
  assert.match(norm(q.callsSql), /error IS NOT NULL/);
});

test('buildQuery: errors_only=false adds no clause', () => {
  const q = buildQuery({ errors_only: false });
  assert.doesNotMatch(norm(q.callsSql), /WHERE/);
});

test('buildQuery: classification filter uses JSONB extract', () => {
  const q = buildQuery({ classification: 'physical_disconnect' });
  assert.deepEqual(q.callsParams, ['physical_disconnect']);
  assert.match(
    norm(q.callsSql),
    /error->'attribution'->>'classification' = \$1/
  );
});

test('buildQuery: unknown classification throws', () => {
  assert.throws(
    () => buildQuery({ classification: 'made_up' }),
    /Unknown classification/
  );
});

// ============ combinations ============

test('buildQuery: multiple filters combine with AND, params ordered', () => {
  const q = buildQuery({
    trace_id: 'T',
    tool_name: 'wifi_connect',
    errors_only: true,
    classification: 'rsa_revoked',
  });
  // 3 parameterized + 1 IS NOT NULL
  assert.deepEqual(q.callsParams, ['T', 'wifi_connect', 'rsa_revoked']);
  assert.match(
    norm(q.callsSql),
    /WHERE trace_id = \$1 AND tool_name = \$2 AND error IS NOT NULL AND error->'attribution'->>'classification' = \$3/
  );
});

test('buildQuery: countSql uses identical WHERE and params', () => {
  const q = buildQuery({ trace_id: 'T', surface: 'native' });
  assert.deepEqual(q.countParams, q.callsParams);
  assert.match(norm(q.countSql), /WHERE trace_id = \$1 AND surface = \$2$/);
});

// ============ pagination ============

test('buildQuery: limit clamped to MAX_LIMIT (1000)', () => {
  const q = buildQuery({ limit: 99999 });
  assert.match(norm(q.callsSql), /LIMIT 1000 OFFSET 0/);
});

test('buildQuery: limit clamped to 1 minimum', () => {
  const q = buildQuery({ limit: 0 });
  assert.match(norm(q.callsSql), /LIMIT 1 /);
});

test('buildQuery: offset honored', () => {
  const q = buildQuery({ offset: 100 });
  assert.match(norm(q.callsSql), /OFFSET 100/);
});

test('buildQuery: offset floored, never negative', () => {
  const q = buildQuery({ offset: -5 });
  assert.match(norm(q.callsSql), /OFFSET 0/);
});

// ============ events query ============

test('buildQuery: include_events without trace_id → no events query', () => {
  const q = buildQuery({ include_events: true });
  assert.equal(q.eventsSql, undefined);
});

test('buildQuery: include_events + trace_id → events query is built', () => {
  const q = buildQuery({ include_events: true, trace_id: 'T123' });
  assert.match(norm(q.eventsSql), /FROM device_events\s+WHERE trace_id = \$1\s+ORDER BY occurred_at ASC/);
  assert.deepEqual(q.eventsParams, ['T123']);
});

test('buildQuery: include_events default false → no events query', () => {
  const q = buildQuery({ trace_id: 'T' });
  assert.equal(q.eventsSql, undefined);
});

// ============ no SQL injection surface ============

test('buildQuery: filter values containing SQL fragments stay parameterized', () => {
  const evil = "'; DROP TABLE tool_calls; --";
  const q = buildQuery({ tool_name: evil });
  // Value lands in params, not the SQL string.
  assert.deepEqual(q.callsParams, [evil]);
  assert.doesNotMatch(q.callsSql, /DROP TABLE/);
});
