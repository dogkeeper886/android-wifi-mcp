/**
 * Unit tests for enterprise server-validation guard (#71).
 *
 * Android 11+ rejects an enterprise config with no server validation.
 * serverValidationError surfaces a clear, actionable error before we forward
 * such a config — and allows the valid combinations (a pinned CA, a domain, or both).
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverValidationError } from '../../dist/adb/enterprise-wifi.js';

const cfg = (over) => ({ ssid: 'Lab', eapMethod: 'peap', identity: 'u', ...over });

test('pinned CA, no domain → no error (#71)', () => {
  assert.equal(serverValidationError(cfg({ caCertificate: 'PEM' })), null);
});

test('domain only, no CA → no error', () => {
  assert.equal(serverValidationError(cfg({ domainSuffixMatch: 'radius.corp.com' })), null);
});

test('neither CA nor domain → actionable error', () => {
  const err = serverValidationError(cfg({}));
  assert.match(err, /caCertificate/);
  assert.match(err, /domainSuffixMatch/);
});

test('empty/whitespace domain with no CA → still an error', () => {
  assert.ok(serverValidationError(cfg({ domainSuffixMatch: '   ' })));
});
