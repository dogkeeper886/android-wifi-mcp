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
} from '../../dist/log/trace-context.js';

const ctxA = {
  trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  parent_id: '1111111111111111',
  trace_flags: '01',
  sampled: true,
};

const ctxB = {
  trace_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  parent_id: '2222222222222222',
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
