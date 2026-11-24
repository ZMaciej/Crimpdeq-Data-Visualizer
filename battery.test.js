import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeBatteryResponse } from './battery.js';

test('decodes the native battery state of charge', () => {
  const view = new DataView(new Uint8Array([8, 2, 73, 1]).buffer);
  assert.deepEqual(decodeBatteryResponse(view, 'status'), {
    percent: 73,
    estimated: false
  });
});

test('estimates battery percentage from Progressor voltage', () => {
  const buffer = new ArrayBuffer(6);
  const view = new DataView(buffer);
  view.setUint8(0, 0);
  view.setUint8(1, 4);
  view.setUint32(2, 3750, true);
  assert.deepEqual(decodeBatteryResponse(view, 'voltage'), {
    percent: 50,
    estimated: true
  });
});

test('rejects malformed or unexpected battery responses', () => {
  assert.equal(decodeBatteryResponse(new DataView(new Uint8Array([8, 1, 50]).buffer), 'status'), null);
  assert.equal(decodeBatteryResponse(new DataView(new Uint8Array([9, 2, 50, 0]).buffer), 'status'), null);
  assert.equal(decodeBatteryResponse(new DataView(new Uint8Array([0, 3, 0, 0, 0]).buffer), 'voltage'), null);
});
