import { engineFault, fault, resource } from './common.js';

export function createTesseract(onResources = () => {}) {
  // Own the official worker from construction, including pending core/language init.
  const worker = new Worker(resource('tesseract/worker.min.js'));
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  let progress = () => {};
  worker.onmessage = ({ data }) => {
    if (data.type === 'diagnostics-resources') { onResources(data.count); return; }
    if (data.status === 'progress') { progress('Tesseract: ' + data.data.status + ' · ' + Math.round((data.data.progress || 0) * 100) + '%'); return; }
    const request = pending.get(data.jobId);
    if (!request) return;
    pending.delete(data.jobId);
    if (data.status === 'resolve') request.resolve(data.data);
    else request.reject(engineFault(data.data));
  };
  worker.onerror = () => { for (const request of pending.values()) request.reject(fault('worker_failed')); pending.clear(); };
  function request(action, payload) {
    if (disposed) return Promise.reject(fault('cancelled'));
    const jobId = 'diagnostics-' + ++sequence;
    return new Promise((resolve, reject) => { pending.set(jobId, { resolve, reject }); worker.postMessage({ workerId: 'diagnostics', jobId, action, payload }); });
  }
  return {
    async initialize(callback) {
      progress = callback;
      await request('load', { options: { lstmOnly: true, corePath: resource('tesseract/core/') } });
      await request('loadLanguage', { langs: 'eng', options: { langPath: resource('tesseract/lang'), cacheMethod: 'none', gzip: true, lstmOnly: true } });
      await request('initialize', { langs: 'eng', oem: 1, config: {} });
      await request('setParameters', { params: { tessedit_pageseg_mode: '7', tessedit_char_whitelist: 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789' } });
    },
    async recognizeFrozen(frame) {
      if (disposed) throw fault('cancelled');
      const data = await request('recognize', { image: new Uint8Array(await frame.blob.arrayBuffer()), options: {}, output: { text: true } });
      return { items: [{ text: data.text, confidence: data.confidence }], confidenceScale: '0–100', nativeVerdict: null };
    },
    dispose() { disposed = true; worker.terminate(); for (const request of pending.values()) request.reject(fault('cancelled')); pending.clear(); },
  };
}
