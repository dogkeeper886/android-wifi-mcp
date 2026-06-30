/**
 * Unit tests for enterprise server-validation guard (#69 / #71).
 *
 * Android 11+ rejects an enterprise config with neither server validation nor
 * trust-on-first-use. serverValidationError surfaces a clear, actionable error
 * before we forward such a config — and allows the valid lab combinations.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverValidationError } from '../../dist/adb/enterprise-wifi.js';

const cfg = (over) => ({ ssid: 'Lab', eapMethod: 'peap', identity: 'u', ...over });

test('trustOnFirstUse → no error (lab AP, no CA/domain)', () => {
  assert.equal(serverValidationError(cfg({ trustOnFirstUse: true })), null);
});

test('pinned CA, no domain → no error (#71)', () => {
  assert.equal(serverValidationError(cfg({ caCertificate: 'PEM' })), null);
});

test('domain only, no CA → no error', () => {
  assert.equal(serverValidationError(cfg({ domainSuffixMatch: 'radius.corp.com' })), null);
});

test('neither CA, domain, nor TOFU → actionable error', () => {
  const err = serverValidationError(cfg({}));
  assert.match(err, /trustOnFirstUse/);
  assert.match(err, /caCertificate/);
});

test('empty/whitespace domain with no CA/TOFU → still an error', () => {
  assert.ok(serverValidationError(cfg({ domainSuffixMatch: '   ' })));
});
