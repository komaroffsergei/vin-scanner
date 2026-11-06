export const ENGINE_IDS = ['paddle', 'tesseract', 'vin-scanner'];
export const ENGINE_LABELS = { paddle: 'PaddleOCR', tesseract: 'Tesseract.js', 'vin-scanner': 'vin-scanner · полный форк' };
export const ENGINE_VERSIONS = { paddle: '0.4.2 / ORT 1.24.3', tesseract: '7.0.0 / core 7.0.0 / eng 1.0.0', 'vin-scanner': '0.1.1 / ORT 1.24.2' };

export function fault(code) { return Object.assign(new Error(code), { code }); }

export function engineFault(message) {
  const text = String(message || '');
  if (/OffscreenCanvas/i.test(text)) return fault('canvas_worker_unavailable');
  if (/HTTP (403|404)|Failed to fetch|Failed to download|NetworkError|fetch.*failed/i.test(text)) return fault('asset_missing');
  if (/tar archive|model_name|protobuf|invalid|incorrect header|inflate|parse|empty resource|config/i.test(text)) return fault('asset_invalid');
  if (/WebAssembly|SIMD|wasm.*(unsupported|failed)/i.test(text)) return fault('wasm_unsupported');
  return fault('engine_failed');
}

export function strictCandidate(items) {
  const lines = items.flatMap(item => String(item.text || '').split(/\r?\n/)).map(text => text.trim().toUpperCase()).filter(Boolean);
  // Every non-empty read must be the same single, complete VIN. Never join, substitute, or extract substrings.
  if (!lines.length || lines.some(text => !/^[A-HJ-NPR-Z0-9]{17}$/.test(text))) return null;
  return new Set(lines).size === 1 ? lines[0] : null;
}

export function freshConsensus(state, candidate, sourceTime) {
  if (!Number.isFinite(sourceTime) || sourceTime <= state.sourceTime) return false;
  state.sourceTime = sourceTime;
  state.matches = candidate && candidate === state.candidate ? state.matches + 1 : candidate ? 1 : 0;
  state.candidate = candidate;
  return state.matches >= 2;
}

export function compareText(actual, expected) {
  if (!expected) return { expectedMatch: null, mismatchedPositions: null };
  return { expectedMatch: actual === expected, mismatchedPositions: actual.length === expected.length
    ? [...actual].flatMap((character, index) => character === expected[index] ? [] : [index + 1]) : null };
}

export function bounded(promise, signal, milliseconds, code, onLate) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    const abort = () => finish(reject, fault('cancelled'));
    function finish(callback, value) {
      if (settled) { if (callback === resolve) onLate?.(value); return; }
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); callback(value);
    }
    if (signal.aborted) { reject(fault('cancelled')); return; }
    signal.addEventListener('abort', abort, { once: true });
    if (milliseconds !== null) timer = setTimeout(() => finish(reject, fault(code)), Math.max(1, milliseconds));
    Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
  });
}

export function pause(milliseconds, signal) {
  let timer;
  const delay = new Promise(resolve => { timer = setTimeout(resolve, milliseconds); });
  return bounded(delay, signal, null, 'cancelled').finally(() => clearTimeout(timer));
}

export function resource(path) { return new URL(import.meta.env.BASE_URL + 'assets/' + path, document.baseURI).href; }

export async function staticFetch(path, signal) {
  const url = resource(path);
  const response = await fetch(url, { signal, credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw fault('asset_missing');
  return response;
}
