import { engineFault, fault, resource } from './common.js';

export function nativeResources() {
  return { detectorUrl: resource('native/vin_detector.onnx'), recUrl: resource('native/ppocr-rec.onnx'),
    dictUrl: resource('native/vin_dict.txt'), ngramUrl: resource('native/vin_ngram.json'),
    wasmUrl: resource('native/ort-wasm-simd-threaded.wasm'), config: {} };
}

export function createNativeFrozen(onResources = () => {}) {
  const worker = new Worker(new URL('../../../../packages/vin-scanner/src/worker/scanner.worker.js', import.meta.url), { type: 'module' });
  let waiting;
  let decoder = 'unknown';
  let disposed = false;
  let progress = () => {};
  worker.onmessage = ({ data }) => {
    if (data.type === 'diagnostics-resources') { onResources(data.count); return; }
    if (data.type === 'progress') { progress('vin-scanner: загружено ' + Math.round(data.loaded / 1024) + ' КБ'); return; }
    if (data.type === 'ready') decoder = data.decoder;
    if (data.type === 'init-error' || data.type === 'error') { waiting?.reject(engineFault(data.message)); waiting = null; }
    else if (data.type === 'ready' || data.type === 'result') { waiting?.resolve(data); waiting = null; }
  };
  worker.onerror = () => { waiting?.reject(fault('worker_failed')); waiting = null; };
  function request(message, transfer = []) {
    if (disposed) return Promise.reject(fault('cancelled'));
    return new Promise((resolve, reject) => { waiting = { resolve, reject }; worker.postMessage(message, transfer); });
  }
  return {
    async initialize(callback) { progress = callback; await request({ type: 'init', ...nativeResources() }); },
    async recognizeFrozen(frame) {
      const bitmap = await createImageBitmap(frame.blob);
      if (disposed) { bitmap.close(); throw fault('cancelled'); }
      worker.postMessage({ type: 'reset' });
      const data = await request({ type: 'frame', bitmap, ts: performance.now(), manual: true,
        guideRect: { x: 0, y: 0, width: bitmap.width, height: bitmap.height } }, [bitmap]);
      return { items: data.read ? [{ text: data.read.text, confidence: data.read.meanConf }] : [], confidenceScale: '0–1',
        decoder, nativeVerdict: data.accepted ? { ...data.accepted, accepted: true, source: 'manual' } : { accepted: false, tier: null, source: 'manual' } };
    },
    dispose() { disposed = true; worker.terminate(); waiting?.reject(fault('cancelled')); waiting = null; },
  };
}

export async function createNativeLive() {
  await import('../../../../packages/vin-scanner/src/index.js');
  const element = document.createElement('vin-scanner');
  const urls = nativeResources();
  for (const [attribute, key] of [['detector-src', 'detectorUrl'], ['rec-src', 'recUrl'], ['dict-src', 'dictUrl'], ['wasm-src', 'wasmUrl'], ['ngram-src', 'ngramUrl']]) element.setAttribute(attribute, urls[key]);
  element.setAttribute('locale', 'ru');
  document.body.append(element);
  return element;
}
