/**
 * Unit tests for the modern-Android network parsers (#80).
 *
 * The old network-check shelled out to curl/nslookup/getent and read a
 * hardcoded `wlan0` + `getprop net.dns*` — all dead on modern Android. These
 * cover the replacement parsers that read `dumpsys connectivity` LinkProperties
 * and `ip route get`, plus the rewritten methods against a fake AdbClient.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NetworkCheck,
  parseInterfaceName,
  parseIpv4LinkAddress,
  parseDnsAddresses,
  parseGateway,
  parseRouteGet,
} from '../../dist/network/network-check.js';

// Real Pixel 8 active-WIFI NetworkAgentInfo line (trimmed), incl. the lp{} block.
const AGENT_LINE =
  'NetworkAgentInfo{network{113}  ni{WIFI CONNECTED extra: }  nc{[ Transports: WIFI Capabilities: NOT_METERED&INTERNET&NOT_VPN&VALIDATED ]}  lp{{InterfaceName: wlan1 LinkAddresses: [ fe80::4484:80ff:fe8d:80c9/64,192.168.6.133/24 ] DnsAddresses: [ /192.168.6.1 ] Domains: localdomain MTU: 0 ServerAddress: /192.168.6.1 Routes: [ 0.0.0.0/0 -> 192.168.6.1 wlan1 mtu 0 ]}} }';

const VALIDATED_DUMP = `\nActive default network: 113\n${AGENT_LINE}\n`;

const ROUTE_GET =
  '8.8.8.8 via 192.168.6.1 dev wlan1 table 1048 src 192.168.6.133 uid 2000 \n    cache ';

function ok(stdout) {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail() {
  return { success: false, stdout: '', stderr: 'err', exitCode: 1 };
}

// --- pure parsers ---

test('parseInterfaceName: reads InterfaceName (wlan1, not the hardcoded wlan0)', () => {
  assert.equal(parseInterfaceName(AGENT_LINE), 'wlan1');
  assert.equal(parseInterfaceName('no lp here'), undefined);
});

test('parseIpv4LinkAddress: picks the IPv4 address, skips IPv6', () => {
  assert.equal(parseIpv4LinkAddress(AGENT_LINE), '192.168.6.133');
  assert.equal(parseIpv4LinkAddress('LinkAddresses: [ fe80::1/64 ]'), undefined);
});

test('parseDnsAddresses: strips leading slash, IPv4 only', () => {
  assert.deepEqual(parseDnsAddresses(AGENT_LINE), ['192.168.6.1']);
  assert.deepEqual(
    parseDnsAddresses('DnsAddresses: [ /1.1.1.1, /2606:4700::1111, /8.8.8.8 ]'),
    ['1.1.1.1', '8.8.8.8']
  );
  assert.deepEqual(parseDnsAddresses('no dns'), []);
});

test('parseGateway: reads ServerAddress', () => {
  assert.equal(parseGateway(AGENT_LINE), '192.168.6.1');
  assert.equal(parseGateway('no server'), undefined);
});

test('parseRouteGet: extracts dev/src/via', () => {
  assert.deepEqual(parseRouteGet(ROUTE_GET), {
    interface: 'wlan1',
    ipAddress: '192.168.6.133',
    gateway: '192.168.6.1',
  });
  assert.deepEqual(parseRouteGet('unreachable'), {});
});

// --- methods against a fake AdbClient ---

class FakeAdb {
  constructor(handlers) {
    this.handlers = handlers;
    this.calls = [];
  }
  async shell(command) {
    this.calls.push(command);
    for (const [needle, resp] of this.handlers) {
      if (command.includes(needle)) return resp;
    }
    return ok('');
  }
}

test('getInterfaceInfo: reads iface/ip/gw/dns from dumpsys LinkProperties', async () => {
  const nc = new NetworkCheck(new FakeAdb([['dumpsys connectivity', ok(VALIDATED_DUMP)]]));
  const info = await nc.getInterfaceInfo();
  assert.equal(info.interface, 'wlan1');
  assert.equal(info.ipAddress, '192.168.6.133');
  assert.equal(info.gateway, '192.168.6.1');
  assert.deepEqual(info.dns, ['192.168.6.1']);
});

test('getInterfaceInfo: falls back to ip route get when no Wi-Fi agent', async () => {
  const nc = new NetworkCheck(
    new FakeAdb([
      ['dumpsys connectivity', ok('Active default network: 50\n(no wifi)\n')],
      ['ip route get', ok(ROUTE_GET)],
    ])
  );
  const info = await nc.getInterfaceInfo();
  assert.equal(info.interface, 'wlan1');
  assert.equal(info.ipAddress, '192.168.6.133');
  assert.equal(info.gateway, '192.168.6.1');
});

test('checkInternet: VALIDATED network -> hasInternet true, no curl', async () => {
  const adb = new FakeAdb([['dumpsys connectivity', ok(VALIDATED_DUMP)]]);
  const nc = new NetworkCheck(adb);
  const r = await nc.checkInternet();
  assert.equal(r.hasInternet, true);
  assert.match(r.endpoint, /VALIDATED/);
  assert.ok(!adb.calls.some(c => c.includes('curl')), 'must not shell out to curl');
});

test('dnsLookup: resolves via ping output, quotes the hostname', async () => {
  const adb = new FakeAdb([['ping', ok('PING ex.com (93.184.216.34) 56(84) bytes')]]);
  const nc = new NetworkCheck(adb);
  const r = await nc.dnsLookup('ex.com');
  assert.deepEqual(r.addresses, ['93.184.216.34']);
  assert.ok(adb.calls.some(c => c.includes("'ex.com'")), 'hostname should be single-quoted');
  assert.ok(!adb.calls.some(c => c.includes('nslookup')), 'must not use nslookup');
});

test('dnsLookup: shell-metachar hostname stays quoted (no injection)', async () => {
  const adb = new FakeAdb([['ping', ok('')]]);
  const nc = new NetworkCheck(adb);
  await nc.dnsLookup('a.com; reboot');
  const call = adb.calls.find(c => c.includes('ping'));
  assert.ok(call.includes("'a.com; reboot'"), 'metachars must be inside single quotes');
});
