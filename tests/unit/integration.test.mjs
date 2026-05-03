/**
 * Integration tests that close the seams flagged in #55 and #58: the
 * unit suite covers the pure parser / ALS / classifier / middleware
 * builder in isolation, but nothing exercised the *composition* —
 * the wrap that `installCallRecording` does on a live McpServer, with
 * the trace context flowing through from `runWithTraceContext`. A
 * regression where the wiring drops one of those pieces would have
 * been silent before.
 *
 * These tests stand up a real McpServer, register a fake tool, install
 * the recording layer with a captured recorder, dispatch a call through
 * the SDK's internal request-handler map, and assert the recorded row.
 *
 * Note on failure modes: when a tool's handler throws, the SDK catches
 * it and returns `{ isError: true, content: [{ type:'text', text }] }`.
 * Our middleware sees a normal result with `isError === true`, not a
 * thrown exception — so failed-call rows always have
 * `error.source === 'tool_result'` regardless of whether the underlying
 * handler threw or returned the failure shape. The 'thrown' branch
 * fires for higher-level errors (proxy network failures, unknown tool
 * names) which aren't reachable from this seam-level test.
 *
 * Run with: npm run test:unit
 * Requires: npm run build
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { installCallRecording } from '../../dist/log/middleware.js';
import { runWithTraceContext } from '../../dist/log/trace-context.js';

function dispatchHandler(server) {
  // The wrapped handler installCallRecording sets is stored on the inner
  // Server's private _requestHandlers map. We grab it directly so the test
  // doesn't depend on JSON-RPC framing.
  return server.server._requestHandlers.get('tools/call');
}

function callRequest(name, args = {}) {
  return { method: 'tools/call', params: { name, arguments: args } };
}

const ctxFromHeader = {
  trace_id: '0af7651916cd43dd8448eb211c80319c',
  parent_span_id: 'b7ad6b7169203331',
  trace_flags: '01',
  sampled: true,
  session_id: null,
};

const ctxWithSession = {
  ...ctxFromHeader,
  session_id: 'sess-abc-123',
};

test('integration: trace_id from ALS flows through installCallRecording → recorder', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('echo', 'echo', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

  installCallRecording(server, undefined, undefined, async (c) => recorded.push(c));

  await runWithTraceContext(ctxFromHeader, () =>
    dispatchHandler(server)(callRequest('echo'), {})
  );

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].trace_id, ctxFromHeader.trace_id);
  assert.equal(recorded[0].tool_name, 'echo');
  assert.equal(recorded[0].surface, 'native');
});

test('integration: missing ALS context → fallback trace_id is W3C 32-hex', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('echo', 'echo', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

  installCallRecording(server, undefined, undefined, async (c) => recorded.push(c));

  // No runWithTraceContext wrap — middleware should mint a fallback id.
  await dispatchHandler(server)(callRequest('echo'), {});

  assert.match(recorded[0].trace_id, /^[0-9a-f]{32}$/);
});

test('integration: failing tool + observer → attribution attached', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  // The SDK catches this throw and returns { isError: true, ... }, so the
  // middleware sees a tool_result-shaped failure. That's the realistic path.
  server.tool('failing', 'fails', {}, async () => {
    throw new Error('simulated handler failure');
  });

  const observer = {
    getRecent: () => [
      { serial: 'A', prev_state: 'device', new_state: null, ts: new Date() },
    ],
  };

  installCallRecording(server, undefined, observer, async (c) => recorded.push(c));

  const result = await dispatchHandler(server)(callRequest('failing'), {});
  assert.equal(result.isError, true);
  assert.equal(recorded.length, 1);

  const err = recorded[0].error;
  assert.equal(err.source, 'tool_result');
  assert.equal(err.attribution.classification, 'physical_disconnect');
  assert.equal(err.attribution.related_event.serial, 'A');
});

test('integration: no observer → no attribution even on failure', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('failing', 'fails', {}, async () => {
    throw new Error('boom');
  });

  installCallRecording(server, undefined, undefined, async (c) => recorded.push(c));

  await dispatchHandler(server)(callRequest('failing'), {});

  assert.equal(recorded[0].error.source, 'tool_result');
  assert.equal(recorded[0].error.attribution, undefined);
});

test('integration: session_id from ALS lands on the recorded row (Phase 2)', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('echo', 'echo', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

  installCallRecording(server, undefined, undefined, async (c) => recorded.push(c));

  await runWithTraceContext(ctxWithSession, () =>
    dispatchHandler(server)(callRequest('echo'), {})
  );

  assert.equal(recorded[0].session_id, 'sess-abc-123');
  // Trace id still flows alongside.
  assert.equal(recorded[0].trace_id, ctxWithSession.trace_id);
});

test('integration: missing session_id in ALS → recorded session_id is null', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('echo', 'echo', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }));

  installCallRecording(server, undefined, undefined, async (c) => recorded.push(c));

  // Run without any ALS context — middleware should see undefined session_id
  // and write null (matching tool_calls.session_id which is nullable).
  await dispatchHandler(server)(callRequest('echo'), {});
  assert.equal(recorded[0].session_id, null);
});

test('integration: trace_id and attribution co-exist on a failed call', async () => {
  const recorded = [];
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('failing', 'fails', {}, async () => {
    throw new Error('boom');
  });

  const observer = {
    getRecent: () => [
      { serial: 'A', prev_state: 'unauthorized', new_state: null, ts: new Date() },
    ],
  };

  installCallRecording(server, undefined, observer, async (c) => recorded.push(c));

  await runWithTraceContext(ctxFromHeader, () =>
    dispatchHandler(server)(callRequest('failing'), {})
  );

  assert.equal(recorded[0].trace_id, ctxFromHeader.trace_id);
  assert.equal(recorded[0].error.attribution.classification, 'rsa_revoked');
});
