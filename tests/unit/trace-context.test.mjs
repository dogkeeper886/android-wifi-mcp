/**
 * Unit tests for src/log/trace-context.ts.
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithTraceContext,
  getTraceContext,
  getTraceId,
  newTraceContext,
  establishTraceContext,
} from '../../dist/log/trace-context.js';

const ctxA = {
  trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  parent_span_id: '1111111111111111',
  trace_flags: '01',
  sampled: true,
};

const ctxB = {
  trace_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  parent_span_id: '2222222222222222',
  trace_flags: '00',
  sampled: false,
};

test('trace-context: getTraceContext returns undefined outside any run', () => {
  assert.equal(getTraceContext(), undefined);
  assert.equal(getTraceId(), undefined);
});

test('trace-context: runWithTraceContext exposes ctx to sync callees', () => {
  runWithTraceContext(ctxA, () => {
    assert.deepEqual(getTraceContext(), ctxA);
    assert.equal(getTraceId(), ctxA.trace_id);
  });
  // After the run returns, store is gone again.
  assert.equal(getTraceContext(), undefined);
});

test('trace-context: ctx survives awaits inside the run', async () => {
  await runWithTraceContext(ctxA, async () => {
    assert.equal(getTraceId(), ctxA.trace_id);
    await new Promise((r) => setImmediate(r));
    assert.equal(getTraceId(), ctxA.trace_id);
  });
});

test('trace-context: concurrent runs do not bleed', async () => {
  const results = await Promise.all([
    runWithTraceContext(ctxA, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getTraceId();
    }),
    runWithTraceContext(ctxB, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return getTraceId();
    }),
  ]);
  assert.deepEqual(results, [ctxA.trace_id, ctxB.trace_id]);
});

test('trace-context: nested runs shadow then restore', () => {
  runWithTraceContext(ctxA, () => {
    assert.equal(getTraceId(), ctxA.trace_id);
    runWithTraceContext(ctxB, () => {
      assert.equal(getTraceId(), ctxB.trace_id);
    });
    // After the inner run, outer ctx is back.
    assert.equal(getTraceId(), ctxA.trace_id);
  });
});

// ============ newTraceContext ============

test('newTraceContext: trace_id is 32 hex chars (W3C format)', () => {
  const ctx = newTraceContext();
  assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
});

test('newTraceContext: parent_span_id is null on a freshly-minted context', () => {
  assert.equal(newTraceContext().parent_span_id, null);
});

test('newTraceContext: always sampled (server is the trace origin)', () => {
  const ctx = newTraceContext();
  assert.equal(ctx.sampled, true);
  assert.equal(ctx.trace_flags, '01');
});

test('newTraceContext: produces a new trace_id each call', () => {
  const a = newTraceContext().trace_id;
  const b = newTraceContext().trace_id;
  assert.notEqual(a, b);
});

// ============ establishTraceContext ============

const VALID_TP = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

test('establishTraceContext: honors a valid traceparent header', () => {
  const req = { header: (n) => (n === 'traceparent' ? VALID_TP : undefined) };
  const ctx = establishTraceContext(req);
  assert.equal(ctx.trace_id, '0af7651916cd43dd8448eb211c80319c');
  assert.equal(ctx.parent_span_id, 'b7ad6b7169203331');
  assert.equal(ctx.trace_flags, '01');
  assert.equal(ctx.sampled, true);
});

test('establishTraceContext: missing header → fresh context', () => {
  const req = { header: () => undefined };
  const ctx = establishTraceContext(req);
  assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
  assert.equal(ctx.parent_span_id, null);
});

test('establishTraceContext: malformed header → fresh context', () => {
  const req = { header: () => 'garbage' };
  const ctx = establishTraceContext(req);
  // Did not adopt the bogus value; minted fresh.
  assert.match(ctx.trace_id, /^[0-9a-f]{32}$/);
  assert.notEqual(ctx.trace_id, 'garbage');
});

test('establishTraceContext: sampled=false from upstream is preserved', () => {
  const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00';
  const req = { header: () => tp };
  const ctx = establishTraceContext(req);
  assert.equal(ctx.sampled, false);
  assert.equal(ctx.trace_flags, '00');
});
