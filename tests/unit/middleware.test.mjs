/**
 * Unit tests for src/log/middleware.ts and src/log/redact.ts.
 *
 * Run with: npm run test:unit
 * Requires: npm run build (these tests import from dist/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordingHandler } from '../../dist/log/middleware.js';
import { redactArgs } from '../../dist/log/redact.js';

// ============ redactArgs ============

test('redactArgs: passes primitives through unchanged', () => {
  assert.equal(redactArgs(null), null);
  assert.equal(redactArgs(undefined), undefined);
  assert.equal(redactArgs(42), 42);
  assert.equal(redactArgs('hello'), 'hello');
  assert.equal(redactArgs(true), true);
});

test('redactArgs: redacts password', () => {
  const out = redactArgs({ ssid: 'foo', password: 'hunter2' });
  assert.deepEqual(out, { ssid: 'foo', password: '***' });
});

test('redactArgs: redacts EAP secrets and cert blobs', () => {
  const out = redactArgs({
    ssid: 'corp',
    identity: 'alice@corp',
    password: 'p',
    privateKey: 'PEM',
    privateKeyPassword: 'pp',
    caCertificate: 'CA',
    clientCertificate: 'CC',
  });
  assert.equal(out.ssid, 'corp');
  assert.equal(out.identity, 'alice@corp');
  assert.equal(out.password, '***');
  assert.equal(out.privateKey, '***');
  assert.equal(out.privateKeyPassword, '***');
  assert.equal(out.caCertificate, '***');
  assert.equal(out.clientCertificate, '***');
});

test('redactArgs: redacts wifi_install_certificate.certificate', () => {
  const out = redactArgs({ certificate: 'PEM', alias: 'corp-ca', type: 'ca' });
  assert.equal(out.certificate, '***');
  assert.equal(out.alias, 'corp-ca');
  assert.equal(out.type, 'ca');
});

test('redactArgs: case-insensitive key matching', () => {
  const out = redactArgs({ Password: 'x', PRIVATEKEY: 'y' });
  assert.equal(out.Password, '***');
  assert.equal(out.PRIVATEKEY, '***');
});

test('redactArgs: does not match similar but distinct keys', () => {
  const out = redactArgs({ keyId: 'abc', passwordHint: 'foo', certAlias: 'bar' });
  assert.equal(out.keyId, 'abc');
  assert.equal(out.passwordHint, 'foo');
  assert.equal(out.certAlias, 'bar');
});

test('redactArgs: recurses into nested objects', () => {
  const out = redactArgs({ outer: { password: 's' }, leaf: 1 });
  assert.deepEqual(out, { outer: { password: '***' }, leaf: 1 });
});

test('redactArgs: walks arrays', () => {
  const out = redactArgs({ list: [{ password: 'a' }, { password: 'b' }] });
  assert.deepEqual(out, { list: [{ password: '***' }, { password: '***' }] });
});

// ============ buildRecordingHandler ============

const mkRequest = (name, args) => ({ params: { name, arguments: args } });

test('middleware: records a successful call with surface=native', async () => {
  const recorded = [];
  const original = async () => ({ content: [{ type: 'text', text: 'ok' }] });
  const handler = buildRecordingHandler(original, undefined, async (c) => {
    recorded.push(c);
  });

  await handler(mkRequest('device_list', {}), {});
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].tool_name, 'device_list');
  assert.equal(recorded[0].surface, 'native');
  assert.equal(recorded[0].error, undefined);
  assert.deepEqual(recorded[0].result, { content: [{ type: 'text', text: 'ok' }] });
});

test('middleware: records a thrown error with source=thrown', async () => {
  const recorded = [];
  const original = async () => {
    throw new Error('boom');
  };
  const handler = buildRecordingHandler(original, undefined, async (c) => {
    recorded.push(c);
  });

  await assert.rejects(() => handler(mkRequest('wifi_status', {}), {}), /boom/);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].error.source, 'thrown');
  assert.equal(recorded[0].error.message, 'boom');
  assert.equal(recorded[0].result, undefined);
});

test('middleware: records an isError result with source=tool_result', async () => {
  // The bug the review caught: isError results MUST populate the error column.
  const recorded = [];
  const original = async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Password required' }],
  });
  const handler = buildRecordingHandler(original, undefined, async (c) => {
    recorded.push(c);
  });

  const result = await handler(mkRequest('wifi_connect', { ssid: 'x', security: 'wpa2' }), {});
  assert.equal(result.isError, true); // result still flows back to caller
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].error.source, 'tool_result');
  assert.deepEqual(recorded[0].error.content, [{ type: 'text', text: 'Password required' }]);
  assert.equal(recorded[0].result, undefined);
});

test('middleware: redacts sensitive args before recording', async () => {
  const recorded = [];
  const original = async () => ({ content: [] });
  const handler = buildRecordingHandler(original, undefined, async (c) => {
    recorded.push(c);
  });

  await handler(
    mkRequest('wifi_connect', { ssid: 'home', security: 'wpa2', password: 'supersecret' }),
    {}
  );
  assert.equal(recorded[0].args.ssid, 'home');
  assert.equal(recorded[0].args.password, '***');
});

test('middleware: surface comes from proxy.getSurfaceForTool when matched', async () => {
  const recorded = [];
  const proxy = {
    getSurfaceForTool: (n) => (n === 'browser_navigate' ? 'proxy:playwright' : null),
  };
  const original = async () => ({ content: [] });
  const handler = buildRecordingHandler(original, proxy, async (c) => {
    recorded.push(c);
  });

  await handler(mkRequest('browser_navigate', { url: 'https://example.com' }), {});
  await handler(mkRequest('device_list', {}), {});
  assert.equal(recorded[0].surface, 'proxy:playwright');
  assert.equal(recorded[1].surface, 'native');
});

test('middleware: recorder failure does not propagate', async () => {
  const original = async () => ({ content: [] });
  const handler = buildRecordingHandler(original, undefined, async () => {
    throw new Error('db is down');
  });

  // Should resolve normally despite the recorder throwing.
  const result = await handler(mkRequest('device_list', {}), {});
  assert.deepEqual(result, { content: [] });
});

test('middleware: handles null/undefined args without throwing', async () => {
  const recorded = [];
  const original = async () => ({ content: [] });
  const handler = buildRecordingHandler(original, undefined, async (c) => {
    recorded.push(c);
  });

  await handler({ params: { name: 'device_list' } }, {});
  assert.equal(recorded[0].args, null);
});
