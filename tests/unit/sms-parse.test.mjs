/**
 * Unit tests for SMS content-query parsing (#82).
 *
 * The old parser used the FIRST `, date=` as the column delimiter, so a body
 * containing `, date=` truncated the message and dropped the row (NaN date).
 * parseContentQuery now anchors on the trailing numeric `date=<epoch>`.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContentQuery } from '../../dist/adb/sms-commands.js';

test('parses a normal row', () => {
  const out = 'Row: 0 address=AlertBank, body=Your code is 123456, date=1633000000000';
  const [m] = parseContentQuery(out);
  assert.equal(m.sender, 'AlertBank');
  assert.equal(m.body, 'Your code is 123456');
  assert.equal(m.timestamp, 1633000000000);
});

test('body containing ", date=" is preserved (the #82 bug)', () => {
  const out =
    'Row: 0 address=Bank, body=Confirm transfer of $50, date=tomorrow, date=1633000000000';
  const msgs = parseContentQuery(out);
  assert.equal(msgs.length, 1, 'row must not be dropped');
  assert.equal(msgs[0].body, 'Confirm transfer of $50, date=tomorrow');
  assert.equal(msgs[0].timestamp, 1633000000000);
});

test('body containing commas is preserved', () => {
  const out = 'Row: 1 address=+123, body=Hi, there, your code: 9988, date=1700000000000';
  const [m] = parseContentQuery(out);
  assert.equal(m.body, 'Hi, there, your code: 9988');
  assert.equal(m.timestamp, 1700000000000);
});

test('body ending in a date-like number still parses', () => {
  const out = 'Row: 2 address=Svc, body=Meeting at 1900, date=1755555555000';
  const [m] = parseContentQuery(out);
  assert.equal(m.body, 'Meeting at 1900');
  assert.equal(m.timestamp, 1755555555000);
});

test('multiple rows', () => {
  const out = [
    'Row: 0 address=A, body=one, date=1000',
    'Row: 1 address=B, body=two, date=2000',
  ].join('\n');
  const msgs = parseContentQuery(out);
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map(m => m.body), ['one', 'two']);
});

test('skips malformed / non-Row / non-numeric-date lines', () => {
  const out = [
    'Some header line',
    'Row: 0 address=A, body=no date column here',
    'Row: 1 address=B, body=bad, date=notanumber',
    'Row: 2 address=C, body=good, date=42',
  ].join('\n');
  const msgs = parseContentQuery(out);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].body, 'good');
  assert.equal(msgs[0].timestamp, 42);
});
