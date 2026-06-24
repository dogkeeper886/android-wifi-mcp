/**
 * Unit tests for DeviceManager.refreshDevices() selection handling (#83).
 *
 * refreshDevices() selects each newly-seen device to query its info. It used
 * to leave the *last enumerated* device selected, silently switching the
 * active device out from under the caller (e.g. device_list on a multi-device
 * host). It must now restore the caller's original selection.
 *
 * DeviceManager builds its own AdbClient, but the field is a plain runtime
 * property, so we inject a fake after construction.
 *
 * Run with: npm run test:unit  (after npm run build)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceManager } from '../../dist/adb/device-manager.js';

function info(serial) {
  return {
    serial,
    model: 'M',
    brand: 'B',
    manufacturer: 'Mfr',
    androidVersion: '14',
    sdkVersion: 34,
    buildId: 'X',
  };
}

class FakeAdb {
  constructor(devices) {
    this.devices = devices;
    this.selected = null;
    this.selectCalls = [];
  }
  async listDevices() {
    return this.devices;
  }
  selectDevice(s) {
    this.selected = s;
    this.selectCalls.push(s);
  }
  getSelectedDevice() {
    return this.selected;
  }
  async getDeviceInfo() {
    return info(this.selected);
  }
}

function managerWith(fake) {
  const dm = new DeviceManager();
  dm.adb = fake; // private at the TS level; a plain property at runtime
  return dm;
}

test('restores the caller selection after enumerating new devices', async () => {
  const fake = new FakeAdb([
    { serial: 'A', state: 'device' },
    { serial: 'B', state: 'device' },
  ]);
  const dm = managerWith(fake);
  fake.selectDevice('A'); // caller had A selected
  await dm.refreshDevices();
  assert.equal(fake.getSelectedDevice(), 'A', 'must restore A, not leak the last-enumerated B');
});

test('leaves selection null when nothing was selected before', async () => {
  const fake = new FakeAdb([
    { serial: 'A', state: 'device' },
    { serial: 'B', state: 'device' },
  ]);
  const dm = managerWith(fake);
  await dm.refreshDevices();
  assert.equal(fake.getSelectedDevice(), null, 'must not leave the last-enumerated device selected');
});

test('clears selection when the selected device has disconnected', async () => {
  const fake = new FakeAdb([{ serial: 'B', state: 'device' }]);
  const dm = managerWith(fake);
  fake.selected = 'A'; // A is no longer present
  await dm.refreshDevices();
  assert.equal(fake.getSelectedDevice(), null);
});
