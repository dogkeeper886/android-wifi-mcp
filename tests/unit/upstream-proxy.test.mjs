/**
 * Unit tests for src/mcp/upstream-proxy.ts pure helpers.
 *
 * Run with: npm run test:unit
 * Requires: npm run build (these tests import from dist/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUpstreamConfig,
  applyEnvOverrides,
  resolveToolName,
} from '../../dist/mcp/upstream-proxy.js';

// ============ parseUpstreamConfig — shorthand format ============

test('parseUpstreamConfig: empty / undefined returns empty list', () => {
  assert.deepEqual(parseUpstreamConfig(undefined), []);
  assert.deepEqual(parseUpstreamConfig(''), []);
  assert.deepEqual(parseUpstreamConfig('   '), []);
});

test('parseUpstreamConfig: single shorthand entry', () => {
  const cfg = parseUpstreamConfig('playwright=npx -y @playwright/mcp@latest --headless');
  assert.equal(cfg.length, 1);
  assert.equal(cfg[0].name, 'playwright');
  assert.equal(cfg[0].command, 'npx');
  assert.deepEqual(cfg[0].args, ['-y', '@playwright/mcp@latest', '--headless']);
});

test('parseUpstreamConfig: command with no args', () => {
  const cfg = parseUpstreamConfig('mock=node');
  assert.equal(cfg.length, 1);
  assert.equal(cfg[0].name, 'mock');
  assert.equal(cfg[0].command, 'node');
  assert.deepEqual(cfg[0].args, []);
});

test('parseUpstreamConfig: multiple semicolon-separated entries', () => {
  const cfg = parseUpstreamConfig('a=foo --x; b=bar --y --z');
  assert.equal(cfg.length, 2);
  assert.equal(cfg[0].name, 'a');
  assert.deepEqual(cfg[0].args, ['--x']);
  assert.equal(cfg[1].name, 'b');
  assert.deepEqual(cfg[1].args, ['--y', '--z']);
});

test('parseUpstreamConfig: trims whitespace around entries', () => {
  const cfg = parseUpstreamConfig('  playwright=npx mcp  ;  mock=node  ');
  assert.equal(cfg.length, 2);
  assert.equal(cfg[0].name, 'playwright');
  assert.equal(cfg[1].name, 'mock');
});

test('parseUpstreamConfig: ignores empty entries between semicolons', () => {
  const cfg = parseUpstreamConfig('a=cmd1; ; b=cmd2;');
  assert.equal(cfg.length, 2);
});

test('parseUpstreamConfig: respects single and double quoted args', () => {
  const cfg = parseUpstreamConfig(`x=cmd "first arg" 'second arg' third`);
  assert.equal(cfg.length, 1);
  assert.deepEqual(cfg[0].args, ['first arg', 'second arg', 'third']);
});

test('parseUpstreamConfig: throws on entry missing =', () => {
  assert.throws(
    () => parseUpstreamConfig('badentry'),
    /missing '='/
  );
});

test('parseUpstreamConfig: throws on entry missing name', () => {
  assert.throws(
    () => parseUpstreamConfig('=cmd'),
    /malformed/
  );
});

test('parseUpstreamConfig: throws on entry missing command', () => {
  assert.throws(
    () => parseUpstreamConfig('name='),
    /malformed/
  );
});

// ============ parseUpstreamConfig — JSON format ============

test('parseUpstreamConfig: JSON array format', () => {
  const cfg = parseUpstreamConfig(
    '[{"name":"playwright","command":"npx","args":["-y","@playwright/mcp@latest"]}]'
  );
  assert.equal(cfg.length, 1);
  assert.equal(cfg[0].name, 'playwright');
  assert.equal(cfg[0].command, 'npx');
  assert.deepEqual(cfg[0].args, ['-y', '@playwright/mcp@latest']);
});

test('parseUpstreamConfig: JSON entry without args defaults to []', () => {
  const cfg = parseUpstreamConfig('[{"name":"x","command":"cmd"}]');
  assert.equal(cfg.length, 1);
  assert.deepEqual(cfg[0].args, []);
});

test('parseUpstreamConfig: JSON multiple entries', () => {
  const cfg = parseUpstreamConfig(
    '[{"name":"a","command":"foo"},{"name":"b","command":"bar","args":["--x"]}]'
  );
  assert.equal(cfg.length, 2);
  assert.equal(cfg[1].name, 'b');
  assert.deepEqual(cfg[1].args, ['--x']);
});

test('parseUpstreamConfig: JSON env passes through', () => {
  const cfg = parseUpstreamConfig(
    '[{"name":"x","command":"cmd","env":{"KEY":"val"}}]'
  );
  assert.equal(cfg[0].env?.KEY, 'val');
});

test('parseUpstreamConfig: malformed JSON throws', () => {
  assert.throws(() => parseUpstreamConfig('[not json'), /JSON parse failed/);
});

// ============ applyEnvOverrides — PLAYWRIGHT_HEADED ============

test('applyEnvOverrides: non-playwright upstream is untouched', () => {
  const original = { name: 'mock', command: 'node', args: ['--headless'] };
  const before = process.env.PLAYWRIGHT_HEADED;
  process.env.PLAYWRIGHT_HEADED = '1';
  try {
    const out = applyEnvOverrides(original);
    assert.deepEqual(out.args, ['--headless']);
  } finally {
    if (before === undefined) delete process.env.PLAYWRIGHT_HEADED;
    else process.env.PLAYWRIGHT_HEADED = before;
  }
});

test('applyEnvOverrides: playwright upstream w/ PLAYWRIGHT_HEADED=1 strips --headless', () => {
  const original = { name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless'] };
  const before = process.env.PLAYWRIGHT_HEADED;
  process.env.PLAYWRIGHT_HEADED = '1';
  try {
    const out = applyEnvOverrides(original);
    assert.deepEqual(out.args, ['-y', '@playwright/mcp@latest']);
  } finally {
    if (before === undefined) delete process.env.PLAYWRIGHT_HEADED;
    else process.env.PLAYWRIGHT_HEADED = before;
  }
});

test('applyEnvOverrides: playwright upstream w/o PLAYWRIGHT_HEADED leaves args alone', () => {
  const original = { name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless'] };
  const before = process.env.PLAYWRIGHT_HEADED;
  delete process.env.PLAYWRIGHT_HEADED;
  try {
    const out = applyEnvOverrides(original);
    assert.deepEqual(out.args, ['-y', '@playwright/mcp@latest', '--headless']);
  } finally {
    if (before !== undefined) process.env.PLAYWRIGHT_HEADED = before;
  }
});

test('applyEnvOverrides: PLAYWRIGHT_HEADED=0 / false / "" treated as falsy', () => {
  const original = { name: 'playwright', command: 'npx', args: ['--headless'] };
  const before = process.env.PLAYWRIGHT_HEADED;
  try {
    for (const falsy of ['0', 'false', 'False', '']) {
      process.env.PLAYWRIGHT_HEADED = falsy;
      const out = applyEnvOverrides(original);
      assert.deepEqual(out.args, ['--headless'], `falsy value ${JSON.stringify(falsy)} should not strip`);
    }
  } finally {
    if (before === undefined) delete process.env.PLAYWRIGHT_HEADED;
    else process.env.PLAYWRIGHT_HEADED = before;
  }
});

test('applyEnvOverrides: playwright w/ HEADED=1 but no --headless in args is no-op', () => {
  const original = { name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'] };
  const before = process.env.PLAYWRIGHT_HEADED;
  process.env.PLAYWRIGHT_HEADED = '1';
  try {
    const out = applyEnvOverrides(original);
    assert.deepEqual(out.args, ['-y', '@playwright/mcp@latest']);
  } finally {
    if (before === undefined) delete process.env.PLAYWRIGHT_HEADED;
    else process.env.PLAYWRIGHT_HEADED = before;
  }
});

test('applyEnvOverrides: returns a new object, does not mutate the input', () => {
  const original = { name: 'playwright', command: 'npx', args: ['--headless', 'other'] };
  const originalArgsRef = original.args;
  const before = process.env.PLAYWRIGHT_HEADED;
  process.env.PLAYWRIGHT_HEADED = '1';
  try {
    const out = applyEnvOverrides(original);
    assert.notEqual(out, original);
    assert.notEqual(out.args, originalArgsRef);
    assert.deepEqual(originalArgsRef, ['--headless', 'other']); // input unchanged
  } finally {
    if (before === undefined) delete process.env.PLAYWRIGHT_HEADED;
    else process.env.PLAYWRIGHT_HEADED = before;
  }
});

// ============ resolveToolName — collision handling ============

test('resolveToolName: no collision returns original name', () => {
  const out = resolveToolName('playwright', 'browser_navigate', new Set(), new Set());
  assert.equal(out, 'browser_navigate');
});

test('resolveToolName: collision with native tool prefixes', () => {
  const native = new Set(['device_list']);
  const out = resolveToolName('playwright', 'device_list', native, new Set());
  assert.equal(out, 'playwright__device_list');
});

test('resolveToolName: collision with another upstream prefixes', () => {
  const taken = new Set(['browser_navigate']);
  const out = resolveToolName('playwright', 'browser_navigate', new Set(), taken);
  assert.equal(out, 'playwright__browser_navigate');
});

test('resolveToolName: prefix uses the upstream name verbatim', () => {
  const native = new Set(['x']);
  const out = resolveToolName('my-cool_upstream', 'x', native, new Set());
  assert.equal(out, 'my-cool_upstream__x');
});

test('resolveToolName: tool name unique to this upstream is unprefixed', () => {
  const native = new Set(['device_list', 'wifi_status']);
  const taken = new Set(['mock_echo']);
  const out = resolveToolName('playwright', 'browser_click', native, taken);
  assert.equal(out, 'browser_click');
});
