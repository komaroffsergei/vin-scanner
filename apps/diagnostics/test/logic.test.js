import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bounded, compareText, freshConsensus, pause, strictCandidate } from '../src/ocr/common.js';
import { openCameraStream } from '../../../packages/vin-scanner/src/element/camera.js';

const vin = '1M8GDM9AXKP042788';
test('generic OCR rejects repairs, substring extraction, multiline fragments and ambiguity', () => {
  assert.equal(strictCandidate([{ text: '  ' + vin.toLowerCase() + '\n' }]), vin);
  for (const text of ['VIN: ' + vin, vin + '9', vin.slice(1), vin.replace('1', 'I'), vin.slice(0, 8) + '\n' + vin.slice(8)]) assert.equal(strictCandidate([{ text }]), null);
  assert.equal(strictCandidate([{ text: vin }, { text: 'XTA00000000000001' }]), null);
});
test('only a fresh matching frame confirms; misses and conflicts reset consensus', () => {
  const state = { sourceTime: -1, candidate: null, matches: 0 };
  assert.equal(freshConsensus(state, vin, 1), false);
  assert.equal(freshConsensus(state, vin, 1), false);
  assert.equal(freshConsensus(state, null, 2), false);
  assert.equal(freshConsensus(state, vin, 3), false);
  assert.equal(freshConsensus(state, 'XTA00000000000001', 4), false);
  assert.equal(freshConsensus(state, vin, 5), false);
  assert.equal(freshConsensus(state, vin, 6), true);
});
test('ground truth compares exact text and reports one-based positions only at equal length', () => {
  assert.deepEqual(compareText(vin, vin), { expectedMatch: true, mismatchedPositions: [] });
  assert.deepEqual(compareText('9' + vin.slice(1), vin).mismatchedPositions, [1]);
  assert.equal(compareText(vin.slice(1), vin).mismatchedPositions, null);
  assert.equal(compareText(vin, '').expectedMatch, null);
});
test('cancellation rejects pending work and closes a late bitmap exactly once', async () => {
  const controller = new AbortController(); let resolve; let closed = 0;
  const pending = new Promise(callback => { resolve = callback; });
  const result = bounded(pending, controller.signal, 1000, 'deadline', bitmap => bitmap.close());
  controller.abort(); await assert.rejects(result, { code: 'cancelled' });
  resolve({ close() { closed++; } }); await Promise.resolve(); assert.equal(closed, 1);
});
test('deadline rejects work without extending for late results', async () => {
  const controller = new AbortController();
  await assert.rejects(bounded(new Promise(() => {}), controller.signal, 10, 'deadline'), { code: 'deadline' });
});
test('stopping an interval wait clears the underlying timer immediately', async () => {
  const controller = new AbortController(); const original = globalThis.clearTimeout; let clears = 0;
  globalThis.clearTimeout = timer => { if (timer) clears++; original(timer); };
  try {
    const pending = pause(10000, controller.signal); controller.abort();
    await assert.rejects(pending, { code: 'cancelled' }); assert.equal(clears, 1);
  } finally { globalThis.clearTimeout = original; }
});
test('native late permission is stopped before optional autofocus', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let resolve; let stopped = false; let focused = false; let active = true;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(callback => { resolve = callback; }) } });
  try {
    const pending = openCameraStream({ isCurrent: () => active }); active = false;
    resolve({ getTracks: () => [{ stop() { stopped = true; } }], getVideoTracks: () => [{ getCapabilities() { focused = true; return {}; } }] });
    await assert.rejects(pending, { name: 'AbortError' }); assert.equal(stopped, true); assert.equal(focused, false);
  } finally { if (original) Object.defineProperty(navigator, 'mediaDevices', original); else delete navigator.mediaDevices; }
});
test('native focus await has an owner that can stop the acquired stream', async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  let finishFocus; let acquired; let stopped = false;
  const track = { stop() { stopped = true; }, getCapabilities: () => ({ focusMode: ['continuous'] }), applyConstraints: () => new Promise(resolve => { finishFocus = resolve; }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => stream } });
  try {
    const pending = openCameraStream({ onAcquired(value) { acquired = value; } });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    acquired.getTracks().forEach(track => track.stop()); finishFocus(); await pending; assert.equal(stopped, true);
  } finally { if (original) Object.defineProperty(navigator, 'mediaDevices', original); else delete navigator.mediaDevices; }
});
