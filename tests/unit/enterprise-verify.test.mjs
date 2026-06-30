/**
 * Unit tests for wifi_connect_enterprise association verification (#70).
 *
 * connectEnterprise() returned success as soon as the OS ACCEPTED the
 * suggestion — not when the device associated. It now polls getStatus and
 * shapes the result via applyVerification, so `success` reflects real
 * association rather than "config accepted". This covers that shaping (the
 * pure decision); the poll loop mirrors the proven wifi_connect verify (#65).
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVerification } from '../../dist/adb/enterprise-wifi.js';

const base = { success: true, ssid: 'CorpNet', eapMethod: 'peap' };

test('associated → success stays true, associated:true, no error', () => {
  const r = applyVerification(base, true, 30000);
  assert.equal(r.success, true);
  assert.equal(r.associated, true);
  assert.equal(r.error, undefined);
  assert.equal(r.ssid, 'CorpNet');
});

test('not associated → not a false success: success:false, associated:false, clear error', () => {
  const r = applyVerification(base, false, 30000);
  assert.equal(r.success, false);
  assert.equal(r.associated, false);
  assert.match(r.error, /CorpNet/);
  assert.match(r.error, /30s/);
});

test('error reports the timeout in seconds (rounded)', () => {
  assert.match(applyVerification(base, false, 12000).error, /12s/);
});

test('does not mutate the base result', () => {
  const original = { success: true, ssid: 'CorpNet', eapMethod: 'peap' };
  applyVerification(original, false, 30000);
  assert.equal(original.success, true);
  assert.equal(original.associated, undefined);
});
