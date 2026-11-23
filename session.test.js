import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decodeMeasurements, Session } from './session.js';

test('decodes all complete weight samples and respects packet length', () => {
  const buffer = new ArrayBuffer(26);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint8(1, 16);
  view.setFloat32(2, 12.5, true);
  view.setUint32(6, 123, true);
  view.setFloat32(10, -1.25, true);
  view.setUint32(14, 456, true);
  view.setFloat32(18, 99, true);
  assert.deepEqual(decodeMeasurements(view), [
    { weight: 12.5, timestamp: 123 },
    { weight: -1.25, timestamp: 456 }
  ]);
  view.setUint8(0, 0);
  assert.deepEqual(decodeMeasurements(view), []);
  assert.deepEqual(decodeMeasurements(new DataView(new ArrayBuffer(1))), []);
});

test('calculates current and maximum values and a time-weighted five-second mean', () => {
  const session = new Session();
  session.add(10, 0);
  session.add(20, 2000000);
  assert.equal(session.mean, null);
  session.add(30, 5000000);
  assert.equal(session.current, 30);
  assert.equal(session.maximum, 30);
  assert.equal(session.mean, 16);
  session.add(0, 7000000);
  assert.equal(session.mean, 24);
  assert.equal(session.maxMean, 24);
  session.add(0, 12000000);
  assert.equal(session.mean, 0);
  assert.equal(session.maxMean, 24);
});

test('handles clock rollover, repeated timestamps, and out-of-order samples', () => {
  const session = new Session();
  session.add(4, 0xfffffff0);
  session.add(6, 0xfffffff0);
  session.add(8, 4999984);
  assert.equal(session.elapsed, 5);
  assert.equal(session.mean, 6);
  session.add(100, 4000000);
  assert.equal(session.maximum, 8);
  assert.equal(session.samples.length, 3);
});
