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
  // LIMIT and OFFSET are now parameterized, so callsParams = [50, 0].
  assert.deepEqual(q.callsParams, [50, 0]);
  assert.equal(q.countParams.length, 0);
  assert.match(norm(q.callsSql), /FROM tool_calls\s+ORDER BY started_at DESC LIMIT \$1 OFFSET \$2/);
  assert.doesNotMatch(norm(q.callsSql), /WHERE/);
  assert.match(norm(q.countSql), /^SELECT count\(\*\)::int AS total FROM tool_calls$/);
});

// ============ each filter individually ============

test('buildQuery: trace_id filter parameterizes', () => {
  const q = buildQuery({ trace_id: 'abc' });
  // [WHERE param, LIMIT, OFFSET]
  assert.deepEqual(q.callsParams, ['abc', 50, 0]);
  assert.deepEqual(q.countParams, ['abc']);
  assert.match(norm(q.callsSql), /WHERE trace_id = \$1/);
});

test('buildQuery: tool_name filter', () => {
  const q = buildQuery({ tool_name: 'wifi_connect' });
  assert.deepEqual(q.callsParams, ['wifi_connect', 50, 0]);
  assert.match(norm(q.callsSql), /tool_name = \$1/);
});

test('buildQuery: surface filter', () => {
  const q = buildQuery({ surface: 'proxy:playwright' });
  assert.deepEqual(q.callsParams, ['proxy:playwright', 50, 0]);
  assert.match(norm(q.callsSql), /surface = \$1/);
});

test('buildQuery: since/until parsed as Date', () => {
  const q = buildQuery({ since: '2026-05-03T00:00:00Z', until: '2026-05-04T00:00:00Z' });
  // [since, until, LIMIT, OFFSET] — only WHERE params count toward injection surface.
  assert.equal(q.countParams.length, 2);
  assert.ok(q.countParams[0] instanceof Date);
  assert.ok(q.countParams[1] instanceof Date);
  assert.match(norm(q.callsSql), /started_at >= \$1 AND started_at <= \$2/);
});

test('buildQuery: invalid since timestamp throws', () => {
  assert.throws(() => buildQuery({ since: 'not a date' }), /Invalid since timestamp/);
});

test('buildQuery: errors_only emits IS NOT NULL (no parameter)', () => {
  const q = buildQuery({ errors_only: true });
  // No WHERE-clause param; only LIMIT + OFFSET in callsParams.
  assert.deepEqual(q.countParams, []);
  assert.deepEqual(q.callsParams, [50, 0]);
  assert.match(norm(q.callsSql), /error IS NOT NULL/);
});

test('buildQuery: errors_only=false adds no clause', () => {
  const q = buildQuery({ errors_only: false });
  assert.doesNotMatch(norm(q.callsSql), /WHERE/);
});

test('buildQuery: classification filter uses JSONB extract', () => {
  const q = buildQuery({ classification: 'physical_disconnect' });
  assert.deepEqual(q.countParams, ['physical_disconnect']);
  assert.deepEqual(q.callsParams, ['physical_disconnect', 50, 0]);
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
  // 3 WHERE params + IS NOT NULL (no param) + LIMIT + OFFSET
  assert.deepEqual(q.countParams, ['T', 'wifi_connect', 'rsa_revoked']);
  assert.deepEqual(q.callsParams, ['T', 'wifi_connect', 'rsa_revoked', 50, 0]);
  assert.match(
    norm(q.callsSql),
    /WHERE trace_id = \$1 AND tool_name = \$2 AND error IS NOT NULL AND error->'attribution'->>'classification' = \$3/
  );
  // LIMIT/OFFSET are placeholders 4 and 5 — verify they advance past the WHERE params.
  assert.match(norm(q.callsSql), /LIMIT \$4 OFFSET \$5/);
});

test('buildQuery: countSql shares WHERE params with callsSql but has no LIMIT/OFFSET', () => {
  const q = buildQuery({ trace_id: 'T', surface: 'native' });
  assert.deepEqual(q.countParams, ['T', 'native']);
  // callsParams = countParams + [limit, offset]
  assert.deepEqual(q.callsParams, ['T', 'native', 50, 0]);
  assert.match(norm(q.countSql), /WHERE trace_id = \$1 AND surface = \$2$/);
});

// ============ pagination ============

test('buildQuery: limit clamped to MAX_LIMIT (1000)', () => {
  const q = buildQuery({ limit: 99999 });
  // [LIMIT, OFFSET] — limit value lands in the params, capped.
  assert.deepEqual(q.callsParams, [1000, 0]);
});

test('buildQuery: limit clamped to 1 minimum', () => {
  const q = buildQuery({ limit: 0 });
  assert.deepEqual(q.callsParams, [1, 0]);
});

test('buildQuery: offset honored', () => {
  const q = buildQuery({ offset: 100 });
  assert.deepEqual(q.callsParams, [50, 100]);
});

test('buildQuery: offset floored, never negative', () => {
  const q = buildQuery({ offset: -5 });
  assert.deepEqual(q.callsParams, [50, 0]);
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
  // Value lands in params (along with LIMIT/OFFSET tail), not the SQL string.
  assert.deepEqual(q.callsParams, [evil, 50, 0]);
  assert.doesNotMatch(q.callsSql, /DROP TABLE/);
});
