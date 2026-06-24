/**
 * Unit tests for captive-portal detection (#76).
 *
 * The old curl-based probe always failed on modern Android (no HTTP client),
 * returning a false `isCaptive:false`. checkCaptivePortal now reads Android's
 * own verdict from `dumpsys connectivity`. These tests cover the pure parsers
 * and the tri-state result against a fake AdbClient — no device needed.
 *
 * Run with: npm run test:unit
 * Requires: npm run build (imports from dist/)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NetworkCheck,
  findActiveWifiAgentLine,
  parseCapabilities,
  extractPortalUrl,
} from '../../dist/network/network-check.js';

// A trimmed but faithful NetworkAgentInfo line as emitted by a real Pixel 8.
const VALIDATED_DUMP = `
Active default network: 113
NetworkAgentInfo{network{113}  handle{488737001485}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: NOT_METERED&INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN&VALIDATED&NOT_ROAMING&FOREGROUND&NOT_CONGESTED ]} }
`;

const CAPTIVE_DUMP = `
Active default network: 120
NetworkAgentInfo{network{120}  handle{1}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN&CAPTIVE_PORTAL&NOT_ROAMING ]}  lp{ CaptivePortalData{ userPortalUrl=https://portal.example.com/login?x=1 isCaptive=true } } }
`;

const UNVALIDATED_DUMP = `
Active default network: 121
NetworkAgentInfo{network{121}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN ]} }
`;

const NO_WIFI_DUMP = `
Active default network: 50
NetworkAgentInfo{network{50}  ni{MOBILE CONNECTED extra: }  nc{[ Transports: CELLULAR Capabilities: INTERNET&VALIDATED ]} }
`;

// Two WIFI agents connected at once (handover / guest+primary). The FIRST line
// is a restricted captive agent; the DEFAULT network (113) is the validated
// one. A first-match parser would wrongly report captive (#76 review, Bug 4).
const TWO_WIFI_DUMP = `
Active default network: 113
NetworkAgentInfo{network{120}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: INTERNET&CAPTIVE_PORTAL ]} }
NetworkAgentInfo{network{113}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: INTERNET&VALIDATED ]} }
`;

function ok(stdout) {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

class FakeAdbClient {
  constructor(dumpStdout, dumpSucceeds = true) {
    this.dumpStdout = dumpStdout;
    this.dumpSucceeds = dumpSucceeds;
  }
  async shell(command) {
    if (command.includes('dumpsys connectivity')) {
      return this.dumpSucceeds
        ? ok(this.dumpStdout)
        : { success: false, stdout: '', stderr: 'failed', exitCode: 1 };
    }
    return ok('');
  }
}

test('findActiveWifiAgentLine: returns the connected WIFI agent line', () => {
  const line = findActiveWifiAgentLine(VALIDATED_DUMP);
  assert.ok(line.includes('network{113}'));
});

test('findActiveWifiAgentLine: prefers the default network over the first WIFI agent', () => {
  const line = findActiveWifiAgentLine(TWO_WIFI_DUMP);
  assert.ok(line.includes('network{113}'), 'should pick default net 113, not first agent 120');
  assert.ok(!line.includes('network{120}'));
});

test('findActiveWifiAgentLine: null when no connected WIFI network', () => {
  assert.equal(findActiveWifiAgentLine(NO_WIFI_DUMP), null);
  assert.equal(findActiveWifiAgentLine(''), null);
});

test('parseCapabilities: splits tokens, exact membership (no substring traps)', () => {
  const caps = parseCapabilities(findActiveWifiAgentLine(VALIDATED_DUMP));
  assert.ok(caps.includes('VALIDATED'));
  assert.ok(!caps.includes('CAPTIVE_PORTAL'));
  assert.deepEqual(parseCapabilities('no caps here'), []);
});

test('extractPortalUrl: reads CaptivePortalData URL, undefined otherwise', () => {
  assert.equal(
    extractPortalUrl(findActiveWifiAgentLine(CAPTIVE_DUMP)),
    'https://portal.example.com/login?x=1'
  );
  assert.equal(extractPortalUrl(findActiveWifiAgentLine(VALIDATED_DUMP)), undefined);
});

test('checkCaptivePortal: validated network -> open', async () => {
  const nc = new NetworkCheck(new FakeAdbClient(VALIDATED_DUMP));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'open');
  assert.equal(r.isCaptive, false);
});

test('checkCaptivePortal: captive network -> captive + portalUrl', async () => {
  const nc = new NetworkCheck(new FakeAdbClient(CAPTIVE_DUMP));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'captive');
  assert.equal(r.isCaptive, true);
  assert.equal(r.portalUrl, 'https://portal.example.com/login?x=1');
});

test('checkCaptivePortal: two WIFI agents -> reads the default (validated) one', async () => {
  const nc = new NetworkCheck(new FakeAdbClient(TWO_WIFI_DUMP));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'open');
  assert.equal(r.isCaptive, false);
});

test('checkCaptivePortal: connected-but-unvalidated -> unknown (not a clean negative)', async () => {
  const nc = new NetworkCheck(new FakeAdbClient(UNVALIDATED_DUMP));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'unknown');
  assert.equal(r.isCaptive, false);
});

test('checkCaptivePortal: no wifi network -> unknown with error', async () => {
  const nc = new NetworkCheck(new FakeAdbClient(NO_WIFI_DUMP));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'unknown');
  assert.match(r.error, /No connected Wi-Fi/);
});

test('checkCaptivePortal: dumpsys failure -> unknown, never a false open', async () => {
  const nc = new NetworkCheck(new FakeAdbClient('', false));
  const r = await nc.checkCaptivePortal();
  assert.equal(r.status, 'unknown');
  assert.equal(r.isCaptive, false);
});
