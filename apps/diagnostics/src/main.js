import { createBaseline } from './baseline.js';
import { ENGINE_IDS, ENGINE_LABELS, ENGINE_VERSIONS, bounded, compareText, engineFault, fault, freshConsensus, resource, staticFetch, strictCandidate } from './ocr/common.js';
import { buildSafeReport } from './report.js';
import info from './build-info.json';
import assetManifest from '../assets-manifest.json';

const $ = id => document.getElementById(id);
const network = { staticResourceRequests: 0, blockedAttempts: 0 };
const events = [];
const runs = [];
const engineChecks = new Map();
let suiteRows = [];
let owner = null;
let generation = 0;
let activeTab = 'mock';
let frozen = null;
let frozenUrl = null;
let manifest;

function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }

// Reuse the existing camera/mock controls and move their shared settings/input once.
const cameraPanel = $('cameraTitle').closest('section');
const mockPanel = $('sessionTitle').closest('section');
const selfTestPanel = $('selfTestButton').closest('section');
const tabs = node('div', undefined, 'tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Режим диагностики');
for (const [id, label] of [['mock', 'Браузерный мок'], ['client', 'На устройстве']]) {
  const button = node('button', label); button.id = 'tab-' + id; button.type = 'button'; button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', String(id === activeTab)); button.setAttribute('aria-controls', id + '-panel'); button.tabIndex = id === activeTab ? 0 : -1;
  button.addEventListener('click', () => selectTab(id)); tabs.append(button);
}
tabs.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const id = event.key === 'Home' ? 'mock' : event.key === 'End' ? 'client' : activeTab === 'mock' ? 'client' : 'mock'; selectTab(id); $('tab-' + id).focus(); });
document.querySelector('.layout').before(tabs);
mockPanel.id = 'mock-panel'; mockPanel.setAttribute('role', 'tabpanel'); mockPanel.setAttribute('aria-labelledby', 'tab-mock');
const sharedSettings = $('intervalInput').closest('details'); sharedSettings.querySelector('summary').textContent = 'Параметры кадра и попытки'; cameraPanel.append(sharedSettings);
const vinLabel = $('vinInput').closest('label'); cameraPanel.append(vinLabel, $('vinNote'));
$('vinNote').textContent = 'Ручная правка защищена от поздних результатов. Мок подставляет только синтетический VIN.';
const clientPanel = node('section', undefined, 'panel'); clientPanel.id = 'client-panel'; clientPanel.hidden = true;
clientPanel.setAttribute('role', 'tabpanel'); clientPanel.setAttribute('aria-labelledby', 'tab-client');
clientPanel.innerHTML = `
  <div class="panel-head"><div><div class="step">02 / ЛОКАЛЬНЫЙ OCR</div><h2>Распознавание на телефоне</h2></div></div>
  <p class="small muted">Модели загружаются со своего стенда. Кадры и распознанный текст остаются в памяти браузера. Одновременно работает один движок.</p>
  <div class="engine-controls">
    <label class="field"><span>Движок</span><select id="engineSelect"><option value="paddle">PaddleOCR</option><option value="tesseract">Tesseract.js</option><option value="vin-scanner">vin-scanner · полный форк</option></select></label>
    <div class="row"><button id="liveButton" class="primary" type="button">Распознавать с камеры</button><button id="clientStopButton" class="danger" type="button" disabled>Остановить OCR</button></div>
    <p class="small muted">Paddle/Tesseract: рамка VIN и два свежих совпадения. Полный форк: штатная камера, интервал 200 мс и собственный консенсус, включая Tier C.</p>
    <div id="clientState" class="engine-state" role="status" aria-live="polite">OCR ещё не запускался.</div>
    <pre id="clientResult" class="engine-result"></pre>
    <label class="field"><span>Ожидаемый VIN — необязательно, только для сравнения</span><input id="expectedInput" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="80" placeholder="Остаётся в памяти; в JSON его не будет"></label>
    <div class="row"><button id="freezeButton" type="button">Заморозить кадр камеры</button><button id="compareButton" type="button" disabled>Проверить снимок</button><button id="compareAllButton" type="button" disabled>Сравнить три OCR</button></div>
    <p class="small muted">Сначала откройте общую камеру и наведите рамку. После заморозки камера выключится. Один снимок не подтверждает живой консенсус.</p>
    <img id="frozenPreview" class="frozen-preview" alt="Замороженная рамка VIN; не отправляется на сервер" hidden>
  </div>
  <div class="divider"></div><h3>16 тестовых изображений</h3>
  <p class="small muted">Четыре синтетических VIN: чистый, шум, растяжение и сочетание. Набор фиксирован для сравнения телефонов. Камера в этом тесте не используется; эталон в OCR-worker не передаётся.</p>
  <div class="row"><button id="suiteButton" class="primary" type="button">Прогнать 16 тестовых изображений</button><button id="galleryButton" type="button">Посмотреть изображения</button><a id="fixturesDownload" class="small" download>Скачать PNG и manifest · ZIP</a></div>
  <p id="suiteSummary" class="small muted" aria-live="polite">48 проверок: 16 изображений × 3 настоящих движка. Сложные случаи могут читаться ошибочно.</p>
  <div class="table-wrap" tabindex="0" aria-label="Результаты OCR, таблицу можно прокручивать" hidden id="resultsWrap"><table class="results-table"><thead><tr><th>Пример / источник</th><th>Движок</th><th>Ожидаемый</th><th>Прочитано</th><th>Совпадение / позиции</th><th>Время</th><th>Confidence</th><th>Native verdict</th></tr></thead><tbody id="ocrResults"></tbody></table></div>
  <div id="fixtureGallery" class="fixture-gallery" hidden></div>
  <div class="divider"></div><p class="ocr-legal">Powered by <a href="https://scanvin.app" rel="noreferrer" target="_blank">ScanVin</a> · AGPL-3.0-only. <a id="sourceLink" rel="noreferrer" target="_blank">Исходники сборки</a> · <a id="licenseLink" target="_blank" rel="noreferrer">Лицензия</a> · <a id="noticeLink" target="_blank" rel="noreferrer">NOTICE</a> · <a id="assetLink" target="_blank" rel="noreferrer">Ресурсы и SHA-256</a></p>
  <p id="buildInfo" class="small muted build-info"></p>`;
mockPanel.before(clientPanel);
$('fixturesDownload').href = resource('vin-synthetic-v1.zip');
$('sourceLink').href = 'https://github.com/komaroffsergei/vin-scanner/tree/' + info.commit;
$('licenseLink').href = resource('licenses/vin-scanner-LICENSE'); $('noticeLink').href = resource('licenses/vin-scanner-NOTICE.md'); $('assetLink').href = resource('assets-manifest.json');
$('buildInfo').textContent = 'Сборка ' + info.buildId + ' · ' + info.commit.slice(0, 12);

const baseline = createBaseline(makeReport);
baseline.init();

function makeReport() {
  let settings;
  try { settings = baseline.readSettings().settings; } catch { settings = { captureIntervalMs: 750, sessionTimeoutSeconds: 30, image: { maxDimension: 1280, jpegQuality: 0.8, maxBytes: 1500000 } }; }
  return buildSafeReport({ info, snapshot: baseline.snapshot(), settings, network, runs, engineChecks, suiteRows, redact: baseline.redact, events });
}

function observeResources(count) { if (Number.isSafeInteger(count) && count > 0) network.staticResourceRequests += count; }

try {
  new PerformanceObserver(list => { network.staticResourceRequests += list.getEntries().filter(entry => entry.name.startsWith(resource(''))).length; }).observe({ type: 'resource', buffered: true });
} catch { /* Resource timing is optional; independent network verification remains unperformed. */ }
document.addEventListener('securitypolicyviolation', () => { network.blockedAttempts++; });

function record(code, context = owner, reasonCode = 'ok', count = null) {
  events.push({ atMs: performance.now(), code, runId: context?.run?.runId || null, engineId: context?.engineId || null, reasonCode, count });
  if (events.length > 300) events.shift();
}
function current(context) { return owner === context && context.generation === generation && !context.controller.signal.aborted && !document.hidden; }
function requireCurrent(context) { if (!current(context)) throw fault('cancelled'); }
function state(text, context = owner) { if (!context || current(context)) $('clientState').textContent = text; }
function codeOf(error) { return error?.code && ['cancelled', 'asset_missing', 'asset_invalid', 'canvas_worker_unavailable', 'wasm_unsupported', 'worker_failed', 'engine_failed', 'initialization_timeout', 'deadline', 'api_missing', 'frame_invalid', 'image_too_large'].includes(error.code) ? error.code : 'engine_failed'; }
const explanations = { cancelled: 'Остановлено. Поздний результат будет проигнорирован.', asset_missing: 'Не удалось загрузить ресурс движка со стенда.', asset_invalid: 'Ресурс повреждён или имеет неподдерживаемый формат.', canvas_worker_unavailable: 'В этой среде Worker не может создать OffscreenCanvas 2D. Это ограничение браузера, а не отсутствие камеры.', wasm_unsupported: 'Браузер не смог скомпилировать или запустить WASM этого движка.', worker_failed: 'Worker не смог запуститься или завершился.', engine_failed: 'Движок завершил операцию с ошибкой.', initialization_timeout: 'Подготовка движка превысила 60 секунд.', deadline: 'Истёк бюджет распознавания.', api_missing: 'Браузер не предоставляет нужные API.', frame_invalid: 'Не удалось подготовить кадр.', image_too_large: 'Изображение превышает установленный бюджет JPEG.' };

function controls() {
  const busy = !!owner;
  baseline.setExternalBusy(busy);
  for (const id of ['liveButton', 'suiteButton', 'freezeButton']) $(id).disabled = busy;
  $('clientStopButton').disabled = !busy;
  $('compareButton').disabled = busy || !frozen; $('compareAllButton').disabled = busy || !frozen;
  $('expectedInput').disabled = busy;
}

function stop(reason = 'cancelled', clearFrame = true, stopCamera = true) {
  const previous = owner;
  owner = null; generation++;
  if (previous) {
    previous.controller.abort();
    clearTimeout(previous.deadlineTimer);
    previous.runtime?.dispose(); previous.runtime = null;
    previous.element?.close(); previous.element?.remove();
    for (const run of previous.runs) { if (run.outcome === 'Pending') run.outcome = 'Cancelled'; run.cleanupVerified = true; }
    record('run.stopped', previous, reason);
  }
  if (stopCamera) baseline.stop('Завершение локального OCR');
  if (clearFrame) {
    frozen = null;
    if (frozenUrl) URL.revokeObjectURL(frozenUrl); frozenUrl = null;
    $('frozenPreview').removeAttribute('src'); $('frozenPreview').hidden = true;
  }
  controls();
}

function begin(mode, keepCamera = false) {
  stop('superseded', mode !== 'compare', !keepCamera);
  const context = { generation, mode, controller: new AbortController(), revision: baseline.revision(), settings: baseline.readSettings().settings,
    expected: $('expectedInput').value.trim().toUpperCase(), runs: [], runtime: null, element: null, engineId: null, run: null };
  owner = context; controls(); $('clientResult').textContent = ''; record('run.started', context); return context;
}

function selectTab(id) {
  stop('superseded'); activeTab = id;
  mockPanel.hidden = id !== 'mock'; selfTestPanel.hidden = id !== 'mock'; clientPanel.hidden = id !== 'client';
  for (const name of ['mock', 'client']) { $('tab-' + name).setAttribute('aria-selected', String(name === id)); $('tab-' + name).tabIndex = name === id ? 0 : -1; }
}

function newRun(context, engineId, source, frame = null) {
  const run = { runId: crypto.randomUUID(), mode: 'client', engineId, source, frozenFrameId: frame?.frameId || null,
    captureIntervalMs: engineId === 'vin-scanner' && source === 'camera-live' ? 200 : context.settings.captureIntervalMs,
    sessionTimeoutSeconds: context.settings.sessionTimeoutSeconds, confidence: { value: null, scale: 'unknown' },
    profile: engineId === 'vin-scanner' ? 'native-full' : 'generic-strict', engineVersion: { paddle: '0.4.2+ort1.24.3', tesseract: '7.0.0+core7.0.0+eng1.0.0', 'vin-scanner': '0.1.1+ort1.24.2' }[engineId],
    modelHashes: assetManifest.resources.filter(item => item.path.startsWith(engineId === 'vin-scanner' ? 'native/' : engineId + '/') && /\.(onnx|tar|gz|json)$/.test(item.path)).map(item => item.sha256),
    backend: 'wasm', outcome: 'Pending', formatValid: null, expectedMatch: null, positionMismatchCount: null, native: null,
    metrics: { initializationMs: null, framePreparationMs: null, firstInferenceMs: null, lastInferenceMs: null, totalMs: 0, frames: 0, sourceImageCount: 0, maxInFlight: 0, queueLength: 0 }, resultApplied: false, cleanupVerified: null };
  context.run = run; context.runs.push(run); runs.push(run); if (runs.length > 300) runs.shift(); return run;
}

async function initialize(context, engineId) {
  const started = performance.now();
  context.engineId = engineId; requireCurrent(context);
  if (!globalThis.Worker || !globalThis.WebAssembly || !globalThis.createImageBitmap) throw fault('api_missing');
  state('Подготовка ' + ENGINE_LABELS[engineId] + ' · ' + ENGINE_VERSIONS[engineId], context);
  const loaders = { paddle: () => import('./ocr/paddle.js'), tesseract: () => import('./ocr/tesseract.js'), 'vin-scanner': () => import('./ocr/vin-scanner.js') };
  const module = await bounded(loaders[engineId](), context.controller.signal, 60000, 'initialization_timeout');
  requireCurrent(context);
  const runtime = engineId === 'paddle' ? module.createPaddle(observeResources) : engineId === 'tesseract' ? module.createTesseract(observeResources) : module.createNativeFrozen(observeResources);
  context.runtime = runtime;
  await bounded(runtime.initialize(message => state(message, context)), context.controller.signal, Math.max(1, 60000 - (performance.now() - started)), 'initialization_timeout');
  requireCurrent(context);
  engineChecks.set(engineId + '.initialization', { id: engineId + '.initialization', status: 'pass', reasonCode: 'ok', facts: { elapsedMs: performance.now() - started } });
  return performance.now() - started;
}

function resultText(result, engineId) {
  return engineId === 'vin-scanner' ? result.nativeVerdict?.vin || result.items[0]?.text || '' : strictCandidate(result.items) || result.items.map(item => item.text).join('\n').trim();
}

function summarize(run, result, text, expected) {
  const comparison = compareText(text, expected);
  run.formatValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(text);
  run.expectedMatch = comparison.expectedMatch; run.positionMismatchCount = comparison.mismatchedPositions?.length ?? null;
  run.confidence = { value: result.nativeVerdict?.confidence ?? result.items[0]?.confidence ?? null, scale: result.confidenceScale === '0–100' ? '0-100' : '0-1' };
  if (result.nativeVerdict) run.native = { ...result.nativeVerdict, decoder: result.decoder || 'unknown' };
  return comparison;
}

async function recognize(context, frame, run, milliseconds = 30000) {
  requireCurrent(context);
  const started = performance.now();
  const result = await bounded(context.runtime.recognizeFrozen(frame), context.controller.signal, milliseconds, 'deadline');
  requireCurrent(context);
  if (performance.now() - started >= milliseconds) throw fault('deadline');
  const elapsed = performance.now() - started;
  run.metrics.firstInferenceMs ??= elapsed; run.metrics.lastInferenceMs = elapsed; run.metrics.frames++;
  run.metrics.sourceImageCount++; run.metrics.maxInFlight = 1; run.metrics.framePreparationMs = frame.metrics?.preparationMs ?? null;
  engineChecks.set(context.engineId + '.inference', { id: context.engineId + '.inference', status: 'pass', reasonCode: 'ok', facts: { elapsedMs: elapsed } });
  return { result, elapsed };
}

function showResultRow({ caseId, engineId, expected = '', text = '', result, elapsed, comparison, message = '' }) {
  const row = node('tr');
  const native = result?.nativeVerdict;
  const verdict = native ? (native.accepted ? 'Accepted · Tier ' + native.tier : 'Нет native acceptance') + ' · ' + result.decoder : 'Строгий профиль · снимок';
  const confidence = native?.confidence ?? result?.items[0]?.confidence;
  for (const cellText of [caseId, ENGINE_LABELS[engineId], expected || 'не задан', text || message || 'пустой read',
    comparison?.expectedMatch === null || !comparison ? '—' : comparison.expectedMatch ? 'Точно' : 'Нет · позиции ' + (comparison.mismatchedPositions?.join(', ') || 'другая длина'),
    elapsed === undefined ? '—' : Math.round(elapsed) + ' мс', confidence === undefined || confidence === null ? '—' : Number(confidence).toFixed(3) + ' / ' + result.confidenceScale, result ? verdict : message]) row.append(node('td', cellText));
  row.children[4].dataset.match = String(comparison?.expectedMatch);
  $('ocrResults').append(row); $('resultsWrap').hidden = false;
}

async function frameFromBlob(blob, settings, signal) {
  const started = performance.now();
  const bitmap = await bounded(createImageBitmap(blob), signal, 30000, 'frame_invalid', bitmap => bitmap.close());
  try {
    const canvas = document.createElement('canvas'); const factor = Math.min(1, settings.image.maxDimension / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * factor)); canvas.height = Math.max(1, Math.round(bitmap.height * factor));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const jpeg = await bounded(new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(fault('frame_invalid')), 'image/jpeg', settings.image.jpegQuality)), signal, 30000, 'frame_invalid');
    if (jpeg.size > settings.image.maxBytes) throw fault('image_too_large');
    return { frameId: crypto.randomUUID(), blob: jpeg, metrics: { width: canvas.width, height: canvas.height, bytes: jpeg.size, preparationMs: performance.now() - started } };
  } finally { bitmap.close(); }
}

async function loadManifest(signal) { if (!manifest) manifest = await (await staticFetch('fixtures/manifest.json', signal)).json(); return manifest; }

async function runSuite() {
  let context;
  try {
    context = begin('suite'); suiteRows = []; $('ocrResults').replaceChildren();
    const dataset = await bounded(loadManifest(context.controller.signal), context.controller.signal, 30000, 'asset_missing'); requireCurrent(context);
    const frames = new Map();
    for (const engineId of ENGINE_IDS) {
      requireCurrent(context);
      let initializationMs = null; let fatal = null;
      try { initializationMs = await initialize(context, engineId); } catch (error) { requireCurrent(context); fatal = codeOf(error); markEngineError(engineId, fatal); }
      for (const fixture of dataset.cases) {
        requireCurrent(context);
        const row = { caseId: fixture.caseId, engineId, noiseSigma: fixture.noiseSigma, stretchX: fixture.stretchX,
          status: 'untested', reasonCode: 'not_run', expectedMatch: null, actualLength: null, positionMismatchCount: null, elapsedMs: null, nativeAccepted: null };
        suiteRows.push(row);
        if (fatal) { row.reasonCode = fatal; showResultRow({ ...fixture, engineId, message: explanations[fatal] }); continue; }
        const run = newRun(context, engineId, 'synthetic'); run.metrics.initializationMs = initializationMs;
        const started = performance.now();
        const caseDeadline = started + 30000;
        state('Проверка ' + suiteRows.length + '/48 · ' + ENGINE_LABELS[engineId] + ' · ' + fixture.caseId, context);
        try {
          let frame = frames.get(fixture.caseId);
          if (!frame) {
            const blob = await bounded(staticFetch(fixture.file, context.controller.signal).then(response => response.blob()), context.controller.signal, caseDeadline - performance.now(), 'deadline');
            frame = await bounded(frameFromBlob(blob, context.settings, context.controller.signal), context.controller.signal, caseDeadline - performance.now(), 'deadline');
            requireCurrent(context); frames.set(fixture.caseId, frame);
          }
          run.frozenFrameId = frame.frameId;
          const { result, elapsed } = await recognize(context, frame, run, Math.max(1, caseDeadline - performance.now()));
          if (performance.now() >= caseDeadline) throw fault('deadline');
          const text = resultText(result, engineId); const comparison = summarize(run, result, text, fixture.expected);
          run.outcome = 'ImageResult';
          Object.assign(row, { status: comparison.expectedMatch ? 'pass' : 'fail', reasonCode: comparison.expectedMatch ? 'ok' : 'recognition_mismatch', expectedMatch: comparison.expectedMatch,
            actualLength: text.length, positionMismatchCount: run.positionMismatchCount, elapsedMs: elapsed, nativeAccepted: result.nativeVerdict?.accepted ?? null });
          showResultRow({ ...fixture, engineId, text, result, elapsed, comparison });
        } catch (error) {
          requireCurrent(context); fatal = codeOf(error); row.status = 'blocked'; row.reasonCode = fatal; run.outcome = fatal === 'deadline' ? 'TimedOut' : 'EngineError';
          markEngineError(engineId, fatal); context.runtime?.dispose(); context.runtime = null;
          showResultRow({ ...fixture, engineId, message: explanations[fatal] });
        } finally { run.metrics.totalMs = performance.now() - started; }
        updateSuiteSummary();
      }
      context.runtime?.dispose(); context.runtime = null;
      for (const run of context.runs.filter(run => run.engineId === engineId)) run.cleanupVerified = true;
    }
    frames.clear(); updateSuiteSummary(); state('Прогон завершён. Камера и живой консенсус этим набором не проверены.', context); record('suite.completed', context, 'ok', suiteRows.length);
  } catch (error) { if (!context || current(context)) state(explanations[codeOf(error)]); }
  finally { if (owner === context) stop('ok'); }
}

function updateSuiteSummary() {
  $('suiteSummary').textContent = ENGINE_IDS.map(id => { const rows = suiteRows.filter(row => row.engineId === id); return ENGINE_LABELS[id] + ': точно ' + rows.filter(row => row.expectedMatch).length + '/16; выполнено ' + rows.filter(row => row.expectedMatch !== null).length; }).join(' · ') + ' · всего ' + suiteRows.length + '/48. Confidence между движками не сравнивается.';
}
function markEngineError(id, code) { engineChecks.set(id + '.operation', { id: id + '.operation', status: 'blocked', reasonCode: code, facts: {} }); record('engine.failed', owner, code); }

async function freeze() {
  if (!baseline.isLive()) { state('Сначала нажмите «Открыть камеру», наведите рамку и повторите заморозку.'); return; }
  let context;
  try {
    context = begin('freeze', true);
    const frame = await bounded(baseline.prepareFrame('camera', context.settings, () => current(context)), context.controller.signal, 30000, 'frame_invalid');
    requireCurrent(context); frozen = frame; frozenUrl = URL.createObjectURL(frame.blob); $('frozenPreview').src = frozenUrl; $('frozenPreview').hidden = false;
    baseline.stop('Кадр заморожен'); state('Снимок сохранён в памяти. Камера выключена; выберите проверку одного или трёх OCR.', context);
  } catch (error) { if (!context || current(context)) state(explanations[codeOf(error)]); }
  finally { if (owner === context) stop('ok', false); }
}

async function compareFrozen(all) {
  if (!frozen) return;
  const frame = frozen;
  let context;
  try {
    context = begin('compare'); $('ocrResults').replaceChildren();
    for (const engineId of all ? ENGINE_IDS : [$('engineSelect').value]) {
      requireCurrent(context);
      const run = newRun(context, engineId, 'camera-frozen', frame); const started = performance.now();
      try {
        run.metrics.initializationMs = await initialize(context, engineId);
        const { result, elapsed } = await recognize(context, frame, run, context.settings.sessionTimeoutSeconds * 1000);
        const text = resultText(result, engineId); const comparison = summarize(run, result, text, context.expected); run.outcome = 'ImageResult';
        showResultRow({ caseId: 'Снимок камеры', engineId, expected: context.expected, text, result, elapsed, comparison });
      } catch (error) { requireCurrent(context); const code = codeOf(error); markEngineError(engineId, code); run.outcome = code === 'initialization_timeout' ? 'InitializationTimeout' : code === 'deadline' ? 'TimedOut' : 'EngineError'; showResultRow({ caseId: 'Снимок камеры', engineId, message: explanations[code] }); }
      finally { run.metrics.totalMs = performance.now() - started; context.runtime?.dispose(); context.runtime = null; run.cleanupVerified = true; }
    }
    state('Сравнение снимка завершено. Это один исходный кадр, не проверка живого консенсуса.', context);
  } catch (error) { if (!context || current(context)) state(explanations[codeOf(error)]); }
  finally { if (owner === context) stop('ok', false); }
}

async function runLive() {
  let context;
  try {
    context = begin('live'); const engineId = $('engineSelect').value; context.engineId = engineId;
    const run = newRun(context, engineId, 'camera-live');
    if (engineId === 'vin-scanner') { await nativeLive(context, run); return; }
    run.metrics.initializationMs = await initialize(context, engineId);
    state('Движок готов. Ожидается разрешение камеры; это ожидание не входит в попытку.', context);
    await bounded(baseline.openCamera(), context.controller.signal, null, 'deadline'); requireCurrent(context);
    if (!baseline.isLive()) throw fault('api_missing');
    const started = performance.now(); const deadline = started + context.settings.sessionTimeoutSeconds * 1000;
    const consensus = { sourceTime: -1, candidate: null, matches: 0 }; let lastStart = -Infinity;
    while (true) {
      requireCurrent(context);
      const remaining = deadline - performance.now(); if (remaining <= 0) throw fault('deadline');
      const pause = Math.max(0, lastStart + context.settings.captureIntervalMs - performance.now());
      if (pause) await bounded(new Promise(resolve => setTimeout(resolve, pause)), context.controller.signal, remaining, 'deadline');
      requireCurrent(context);
      const sourceTime = $('video').currentTime;
      if (sourceTime <= consensus.sourceTime) { await bounded(new Promise(resolve => setTimeout(resolve, 30)), context.controller.signal, deadline - performance.now(), 'deadline'); continue; }
      lastStart = performance.now();
      const frame = await bounded(baseline.prepareFrame('camera', context.settings, () => current(context)), context.controller.signal, deadline - performance.now(), 'deadline');
      const { result } = await recognize(context, frame, run, Math.max(1, deadline - performance.now()));
      if (performance.now() >= deadline) throw fault('deadline');
      const candidate = strictCandidate(result.items); const text = resultText(result, engineId); summarize(run, result, text, context.expected);
      run.metrics.totalMs = performance.now() - started;
      $('clientResult').textContent = text || 'VIN пока не прочитан';
      if (freshConsensus(consensus, candidate, sourceTime)) {
        run.outcome = 'Recognized'; run.resultApplied = baseline.applyVin(candidate, context.revision);
        state(run.resultApplied ? 'VIN подтверждён двумя свежими кадрами и подставлен в поле.' : 'VIN подтверждён. Поле изменено вручную, подстановка отменена.', context);
        record('live.recognized', context, run.resultApplied ? 'ok' : 'manual_revision_changed'); return;
      }
      state((candidate ? 'Candidate: нужно совпадение на следующем свежем кадре.' : 'NeedBetterFrame: наведите рамку на VIN.') + ' Осталось ' + Math.max(0, (deadline - performance.now()) / 1000).toFixed(1) + ' с.', context);
    }
  } catch (error) {
    if (!context || current(context)) {
      const code = codeOf(error); if (context?.run) context.run.outcome = code === 'cancelled' ? 'Cancelled' : code === 'deadline' ? 'TimedOut' : code === 'initialization_timeout' ? 'InitializationTimeout' : 'EngineError';
      if (context?.engineId && code !== 'cancelled') markEngineError(context.engineId, code); state(explanations[code], context);
    }
  } finally { if (owner === context) stop('ok'); }
}

async function nativeLive(context, run) {
  const initializedAt = performance.now();
  const module = await bounded(import('./ocr/vin-scanner.js'), context.controller.signal, 60000, 'initialization_timeout'); requireCurrent(context);
  const element = await bounded(module.createNativeLive(), context.controller.signal, Math.max(1, 60000 - (performance.now() - initializedAt)), 'initialization_timeout', element => { element.close(); element.remove(); });
  if (!current(context)) { element.close(); element.remove(); throw fault('cancelled'); }
  context.element = element;
  element.addEventListener('scan-resource-observed', event => observeResources(event.detail.count));
  await new Promise((resolve, reject) => {
    let initTimer = setTimeout(() => done(reject, fault('initialization_timeout')), Math.max(1, 60000 - (performance.now() - initializedAt)));
    let started = null;
    const abort = () => done(reject, fault('cancelled'));
    context.controller.signal.addEventListener('abort', abort, { once: true });
    function done(callback, value) { clearTimeout(initTimer); clearTimeout(context.deadlineTimer); context.controller.signal.removeEventListener('abort', abort); callback(value); }
    element.addEventListener('scan-state-changed', event => {
      if (!current(context)) return;
      if (event.detail.state === 'requesting_camera') {
        clearTimeout(initTimer); initTimer = null; run.metrics.initializationMs = performance.now() - initializedAt;
        engineChecks.set('vin-scanner.initialization', { id: 'vin-scanner.initialization', status: 'pass', reasonCode: 'ok', facts: { elapsedMs: run.metrics.initializationMs } });
        state('Модели готовы. Ожидается камера; можно отменить штатной кнопкой закрытия.', context);
      }
      if (event.detail.state === 'scanning' && started === null) {
        started = performance.now(); state('Полный native vin-scanner · decoder ' + element.decoder + ' · 200 мс · собственный консенсус.', context);
        context.deadlineTimer = setTimeout(() => done(reject, fault('deadline')), context.settings.sessionTimeoutSeconds * 1000);
      }
    });
    element.addEventListener('scan-vin-found', event => {
      if (!current(context) || started === null || performance.now() >= started + context.settings.sessionTimeoutSeconds * 1000) return;
      const detail = event.detail; run.outcome = 'Recognized'; run.metrics.totalMs = performance.now() - started;
      const result = { items: [], nativeVerdict: { ...detail, accepted: true }, confidenceScale: '0–1', decoder: element.decoder };
      summarize(run, result, detail.vin, context.expected); run.resultApplied = baseline.applyVin(detail.vin, context.revision);
      engineChecks.set('vin-scanner.live-session', { id: 'vin-scanner.live-session', status: 'pass', reasonCode: 'ok', facts: { elapsedMs: run.metrics.totalMs } });
      $('clientResult').textContent = detail.vin + '\nTier ' + detail.tier + ' · ' + element.decoder + ' · ' + detail.source;
      state(run.resultApplied ? 'Штатный native результат подставлен в поле VIN.' : 'Native VIN найден. Ручная правка защищена от подстановки.', context); done(resolve);
    });
    element.addEventListener('scan-closed', () => { if (current(context) && run.outcome === 'Pending') done(reject, fault('cancelled')); });
    for (const event of ['scan-model-error', 'scan-ocr-error']) element.addEventListener(event, event => { if (current(context)) done(reject, engineFault(event.detail?.message)); });
    element.open().then(support => { if (!support.supported) done(reject, fault('api_missing')); }).catch(() => done(reject, fault('engine_failed')));
  });
}

$('liveButton').addEventListener('click', runLive); $('suiteButton').addEventListener('click', runSuite);
$('freezeButton').addEventListener('click', freeze); $('compareButton').addEventListener('click', () => compareFrozen(false)); $('compareAllButton').addEventListener('click', () => compareFrozen(true));
for (const id of ['clientStopButton', 'stopButton', 'manualButton']) $(id).addEventListener('click', () => { stop('cancelled'); state(explanations.cancelled); }, { capture: true });
$('engineSelect').addEventListener('change', () => { stop('superseded', false); state('Выбран ' + ENGINE_LABELS[$('engineSelect').value] + '. Для запуска нажмите кнопку.'); });
$('cameraSelect').addEventListener('change', () => stop('superseded'), { capture: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('cancelled'); }); window.addEventListener('pagehide', () => stop('cancelled'));
$('galleryButton').addEventListener('click', async () => {
  if ($('fixtureGallery').children.length) { $('fixtureGallery').hidden = !$('fixtureGallery').hidden; return; }
  try {
    const dataset = await loadManifest();
    for (const fixture of dataset.cases) { const figure = node('figure'); const image = node('img'); image.loading = 'lazy'; image.src = resource(fixture.file); image.alt = fixture.caseId + ': синтетический VIN'; figure.append(image, node('figcaption', fixture.caseId + ' · σ ' + fixture.noiseSigma + ' · ×' + fixture.stretchX)); $('fixtureGallery').append(figure); }
    $('fixtureGallery').hidden = false;
  } catch { state(explanations.asset_missing); }
});
controls();
