import { engineFault, fault, resource } from './common.js';

// The published SDK worker contains the complete official pipeline. This thin transport
// follows 0.4.2's WorkerTransportClient protocol and avoids importing OpenCV on the host.
export function createPaddle(onResources = () => {}) {
  const worker = new Worker(resource('paddle/worker.js'), { type: 'module' });
  const pending = new Map();
  let sequence = 0;
  let disposed = false;
  worker.onmessage = ({ data }) => {
    if (data.type === 'diagnostics-resources') { onResources(data.count); return; }
    if (data.kind !== 'worker-transport-response') return;
    const request = pending.get(data.requestId);
    if (!request) return;
    pending.delete(data.requestId);
    if (data.status === 'success') request.resolve(data.payload);
    else request.reject(engineFault(data.error?.message));
  };
  worker.onerror = () => { for (const request of pending.values()) request.reject(fault('worker_failed')); pending.clear(); };
  function request(type, payload, transfer = []) {
    if (disposed) return Promise.reject(fault('cancelled'));
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try { worker.postMessage({ kind: 'worker-transport-request', type, payload, requestId }, transfer); }
      catch { pending.delete(requestId); reject(fault('worker_failed')); }
    });
  }
  return {
    async initialize(progress) {
      progress('Загрузка PaddleOCR, OpenCV и моделей…');
      await request('init', { options: {
        // NormalizedPipelineConfig is the published 0.4.2 worker input, not the
        // host create() convenience options. These are its general OCR defaults.
        pipelineConfig: { pipelineName: 'OCR', raw: {}, warnings: [], unsupportedFeatures: [],
          modelSelection: { textDetectionModelName: 'PP-OCRv6_tiny_det', textRecognitionModelName: 'PP-OCRv6_tiny_rec' },
          assets: { det: { url: resource('paddle/PP-OCRv6_tiny_det_onnx_infer.tar') }, rec: { url: resource('paddle/PP-OCRv6_tiny_rec_onnx_infer.tar') } },
          runtimeDefaults: { text_det_limit_side_len: 960, text_det_limit_type: 'max', text_det_max_side_limit: 4000,
            text_det_thresh: 0.3, text_det_box_thresh: 0.6, text_det_unclip_ratio: 2, text_rec_score_thresh: 0 },
          pipelineBatchSize: 1, textDetectionBatchSize: 1, textRecognitionBatchSize: 1 },
        ortOptions: { backend: 'wasm', wasmPaths: resource('paddle/'), numThreads: 1, proxy: false, disableWasmProxy: true },
      } });
    },
    async recognizeFrozen(frame) {
      const bitmap = await createImageBitmap(frame.blob);
      if (disposed) { bitmap.close(); throw fault('cancelled'); }
      const results = await request('predict', { sources: [{ kind: 'imageBitmap', imageBitmap: bitmap }], params: {} }, [bitmap]);
      return { items: (results[0]?.items || []).map(item => ({ text: item.text, confidence: item.score ?? null })), confidenceScale: '0–1', nativeVerdict: null };
    },
    dispose() {
      disposed = true;
      worker.terminate();
      for (const request of pending.values()) request.reject(fault('cancelled'));
      pending.clear();
    },
  };
}
