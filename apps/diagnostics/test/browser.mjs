import { chromium, firefox, webkit } from 'playwright';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const url = process.env.VIN_TEST_URL || 'http://127.0.0.1:4317/vin-scanner/';
const artifacts = process.env.VIN_TEST_OUTPUT || path.join(os.tmpdir(), 'vin-diagnostics-qa');
await mkdir(artifacts, { recursive: true });
const schema = JSON.parse(await readFile(new URL('../specs/001-dual-mode-diagnostics/contracts/report-v2.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true }); addFormats(ajv); const validate = ajv.compile(schema);
const browser = await ({ chromium, firefox, webkit }[process.env.VIN_TEST_BROWSER || 'chromium']).launch({ headless: true });
const checks = [];
const problems = [];
const requests = [];

async function report(page) {
  await page.locator('#showReportButton').click();
  const result = JSON.parse(await page.locator('#reportText').inputValue());
  assert(validate(result), JSON.stringify(validate.errors?.slice(0, 4)));
  const text = JSON.stringify(result);
  assert(!text.includes('PRIVATE_SENTINEL') && !text.includes('WP0ZZZ99ZTS392124'));
  assert.equal(result.network.externalVerification, 'not_performed');
  return result;
}

async function pageWithCamera(kind = 'pending') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(kind => {
    window.__workers = { active: 0, maximum: 0 };
    const Original = window.Worker;
    window.Worker = class extends Original {
      constructor(...args) { super(...args); window.__workers.active++; window.__workers.maximum = Math.max(window.__workers.maximum, window.__workers.active); }
      terminate() { if (!this.__ended) { this.__ended = true; window.__workers.active--; } return super.terminate(); }
    };
    window.__streams = [];
    window.__cameraRequested = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraRequested++;
      if (kind === 'denied') throw new DOMException('PRIVATE_SENTINEL camera denial', 'NotAllowedError');
      const acquire = async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f5f5f2'; ctx.fillRect(0, 0, 640, 480);
        const source = [...document.scripts].find(script => script.type === 'module').src;
        const asset = source.slice(0, source.lastIndexOf('/assets/') + 8);
        const response = await fetch(asset + 'fixtures/vin1-clean.png'); const bitmap = await createImageBitmap(await response.blob());
        const draw = () => ctx.drawImage(bitmap, 0, 180, 640, 120); draw();
        const stream = canvas.captureStream(12); window.__streams.push(stream);
        const timer = setInterval(draw, 70); stream.getTracks()[0].addEventListener('ended', () => { clearInterval(timer); bitmap.close(); });
        return stream;
      };
      if (kind === 'live') return acquire();
      return new Promise(resolve => { window.__releaseCamera = async () => resolve(await acquire()); });
    };
  }, kind);
  await page.goto(url);
  return page;
}

async function check(name, operation) {
  const started = Date.now();
  await operation(); checks.push({ name, pass: true, elapsedMs: Date.now() - started }); console.log('PASS', name);
}

try {
  const page = await pageWithCamera();
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Unknown CPU vendor')) problems.push(message.text()); });
  page.on('pageerror', error => problems.push(error.message));
  page.on('request', request => requests.push({ url: /^https?:/.test(request.url()) ? request.url() : new URL(request.url()).protocol, method: request.method() }));
  await check('startup, accessible tabs and responsive layout', async () => {
    assert(await page.locator('#bootWarning').isHidden()); assert.match(await page.title(), /VIN/);
    assert.equal(await page.evaluate(() => window.__workers.active), 0); assert.equal(await page.evaluate(() => window.__cameraRequested), 0);
    await page.getByRole('tab', { name: 'На устройстве' }).click();
    for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'mobile.png') });
  });
  await check('48-case suite: actual OCR or explicit capability results, canonical inputs, schema and privacy', async () => {
    await page.locator('#vinInput').fill('PRIVATE_SENTINEL'); await page.locator('#expectedInput').fill('WP0ZZZ99ZTS392124');
    await page.locator('#suiteButton').click();
    await page.waitForFunction(() => document.querySelector('#ocrResults').children.length === 48 && !document.querySelector('#suiteButton').disabled, null, { timeout: 180000 });
    const result = await report(page);
    await writeFile(path.join(artifacts, 'suite-observation.json'), JSON.stringify({report:result, problems, requests}, null, 2));
    console.log('ENGINE STATUS', result.engineChecks.filter(check => check.status !== 'pass'));
    console.log('NON-GET', requests.filter(request => !['GET','HEAD'].includes(request.method)));
    assert.equal(result.testSuite.cases.length, 48);
    for (const id of ['paddle', 'tesseract', 'vin-scanner']) {
      const rows = result.testSuite.cases.filter(row => row.engineId === id);
      if (process.env.VIN_TEST_ALLOW_WORKER_CANVAS_LIMITATION && id !== 'tesseract' && rows.every(row => row.reasonCode === 'canvas_worker_unavailable')) { console.log('PLATFORM LIMITATION', id, 'worker OffscreenCanvas 2D unavailable'); continue; }
      assert.equal(rows.filter(row => row.elapsedMs !== null).length, 16, id + ' did not run all inputs');
      assert(rows.some(row => row.caseId.endsWith('-clean') && row.expectedMatch), id + ' has no successful clean control');
    }
    const runs = result.runs.filter(run => run.source === 'synthetic');
    assert(runs.length >= 16); // Unsupported worker contexts remain explicitly untested.
    if (runs.length === 48)
    for (let index = 0; index < 16; index++) assert.equal(new Set([runs[index].frozenFrameId, runs[index + 16].frozenFrameId, runs[index + 32].frozenFrameId]).size, 1);
    assert.equal(await page.evaluate(() => window.__workers.active), 0); assert.equal(await page.evaluate(() => window.__workers.maximum), 1);
    assert.equal(await page.evaluate(() => window.__cameraRequested), 0);
    assert(result.network.staticResourceRequests > 20);
    assert.equal(await page.locator('#vinInput').inputValue(), 'PRIVATE_SENTINEL');
    assert.deepEqual(problems, []);
    const injected = requests.filter(request => /\.scr\.kaspersky-labs\.com$/.test(new URL(request.url).hostname));
    if (injected.length) console.log('ENVIRONMENT NETWORK INJECTION:', injected.length, 'Kaspersky instrumentation requests; independent origin verification remains unperformed.');
    for (const request of requests) { if (injected.includes(request)) continue; if (!/^https?:/.test(request.url)) { assert(['data:', 'blob:'].includes(request.url)); continue; } assert(['GET', 'HEAD'].includes(request.method)); assert.equal(new URL(request.url).origin, new URL(url).origin); assert.match(new URL(request.url).pathname, /\/vin-scanner\/releases\/[^/]+\/assets\//); }
    const table = await page.locator('#ocrResults tr').evaluateAll(rows => rows.map(row => [...row.children].map(cell => cell.textContent)));
    await writeFile(path.join(artifacts, 'actual-ocr.json'), JSON.stringify({ report: result, table, requests }, null, 2));
    await page.locator('#resultsWrap').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(artifacts, 'results.png') });
    console.log('SCORES', ['paddle', 'tesseract', 'vin-scanner'].map(id => [id, result.testSuite.cases.filter(row => row.engineId === id && row.expectedMatch).length]));
  });
  await check('canonical image gallery and downloadable ZIP', async () => {
    await page.locator('#galleryButton').click(); assert.equal(await page.locator('#fixtureGallery img').count(), 16);
    const download = page.waitForEvent('download'); await page.locator('#fixturesDownload').click(); const result = await download;
    assert.equal(result.suggestedFilename(), 'vin-synthetic-v1.zip'); await result.saveAs(path.join(artifacts, 'vin-synthetic-v1.zip'));
  });
  await check('existing mock self-tests and virtual session remain operational', async () => {
    await page.locator('#tab-mock').click(); await page.locator('#selfTestButton').click();
    await page.waitForFunction(() => !document.querySelector('#selfTestButton').disabled, null, { timeout: 20000 });
    const result = await report(page); assert.equal(result.logicChecks.length, 23); assert(result.logicChecks.every(check => check.status === 'pass'));
    await page.locator('#sourceSelect').selectOption('synthetic'); await page.locator('#runButton').click();
    await page.waitForFunction(() => document.querySelector('#sessionState').textContent === 'Recognized', null, { timeout: 10000 });
    const final = await report(page); assert(final.runs.some(run => run.mode === 'mock' && run.outcome === 'Recognized'));
    assert(final.network.virtualOperations > 0);
  });
  await page.close();
  if (!process.env.VIN_TEST_SUITE_ONLY) {
  for (const engine of ['paddle', 'tesseract', 'vin-scanner']) {
    await check(engine + ': pending permission, stop and late-stream cleanup', async () => {
      const pending = await pageWithCamera(); await pending.locator('#tab-client').click(); await pending.locator('#engineSelect').selectOption(engine); await pending.locator('#liveButton').click();
      await pending.waitForFunction(() => typeof window.__releaseCamera === 'function', null, { timeout: 15000 });
      if (engine === 'vin-scanner') await pending.locator('vin-scanner button.close').click(); else await pending.locator('#clientStopButton').click();
      await pending.evaluate(() => window.__releaseCamera());
      await pending.waitForFunction(() => window.__streams.length > 0 && window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')), null, { timeout: 5000 });
      assert.equal(await pending.evaluate(() => window.__workers.active), 0); assert.equal(await pending.locator('#vinInput').inputValue(), '');
      await report(pending); await pending.close();
    });
  }
  await check('real Canvas stream live OCR, frozen comparison and manual-input protection', async () => {
    const live = await pageWithCamera('live'); await live.locator('#tab-client').click(); await live.locator('#engineSelect').selectOption('tesseract');
    await live.locator('#liveButton').click(); await live.locator('#vinInput').fill('PRIVATE_SENTINEL');
    await live.waitForFunction(() => !document.querySelector('#liveButton').disabled, null, { timeout: 40000 });
    const first = await report(live); assert(first.runs.some(run => run.outcome === 'Recognized' && run.resultApplied === false));
    assert.equal(await live.locator('#vinInput').inputValue(), 'PRIVATE_SENTINEL');
    await live.locator('#cameraButton').click(); await live.waitForFunction(() => !!document.querySelector('#video').srcObject);
    await live.locator('#freezeButton').click(); await live.waitForFunction(() => !document.querySelector('#compareAllButton').disabled);
    await live.locator('#compareAllButton').click(); await live.waitForFunction(() => document.querySelector('#ocrResults').children.length === 3 && !document.querySelector('#compareAllButton').disabled, null, { timeout: 90000 });
    const frozen = await report(live); const runs = frozen.runs.filter(run => run.source === 'camera-frozen');
    assert.equal(runs.length, 3); assert.equal(new Set(runs.map(run => run.frozenFrameId)).size, 1); assert(runs.every(run => run.outcome === 'ImageResult'));
    assert.equal(await live.evaluate(() => window.__workers.active), 0); assert(await live.evaluate(() => window.__streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))));
    await live.close();
  });
  await check('denied camera is an environment result, not a silent success', async () => {
    const denied = await pageWithCamera('denied'); await denied.locator('#cameraButton').click(); await denied.waitForFunction(() => document.querySelector('[data-check="camera"] .status').textContent.includes('Заблокировано'));
    const result = await report(denied); assert.equal(result.deviceChecks.find(check => check.id === 'camera').status, 'blocked'); await denied.close();
  });
  await check('Stop during model loading, late static response and explicit restart', async () => {
    const loading = await pageWithCamera(); let release; let requested;
    const seen = new Promise(resolve => { requested = resolve; }); const barrier = new Promise(resolve => { release = resolve; });
    await loading.route('**/paddle/PP-OCRv6_tiny_det_onnx_infer.tar', async route => { requested(); await barrier; try { await route.continue(); } catch {} });
    await loading.locator('#tab-client').click(); await loading.locator('#liveButton').click(); await seen;
    await loading.locator('#clientStopButton').click(); release(); await loading.waitForTimeout(500);
    assert.equal(await loading.evaluate(() => window.__workers.active), 0); assert.equal(await loading.evaluate(() => window.__cameraRequested), 0);
    await loading.unrouteAll({ behavior: 'ignoreErrors' }); await loading.locator('#engineSelect').selectOption('tesseract'); await loading.locator('#liveButton').click();
    await loading.waitForFunction(() => window.__cameraRequested === 1, null, { timeout: 10000 }); await loading.locator('#tab-mock').click();
    assert.equal(await loading.evaluate(() => window.__workers.active), 0); await loading.close();
  });
  await check('background lifecycle stops work without resume (simulated event)', async () => {
    const hidden = await pageWithCamera(); await hidden.locator('#tab-client').click(); await hidden.locator('#liveButton').click();
    await hidden.waitForFunction(() => window.__workers.active > 0);
    await hidden.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await hidden.evaluate(() => window.__workers.active), 0);
    await hidden.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await hidden.waitForTimeout(300); assert.equal(await hidden.evaluate(() => window.__workers.active), 0); await hidden.close();
  });
  for (const [engine, pattern, body, status] of [
    ['paddle', '**/paddle/PP-OCRv6_tiny_det_onnx_infer.tar', 'missing', 404],
    ['paddle', '**/paddle/PP-OCRv6_tiny_rec_onnx_infer.tar', 'corrupt model bytes', 200],
    ['tesseract', '**/tesseract/lang/eng.traineddata.gz', 'missing', 404],
    ['vin-scanner', '**/native/vin_detector.onnx', 'corrupt model bytes', 200],
  ]) {
    await check(engine + ': missing/corrupt asset is explicit and never starts the camera', async () => {
      const broken = await pageWithCamera(); await broken.route(pattern, route => route.fulfill({ status, body, contentType: 'application/octet-stream' }));
      await broken.locator('#tab-client').click(); await broken.locator('#engineSelect').selectOption(engine); await broken.locator('#liveButton').click();
      await broken.waitForFunction(() => !document.querySelector('#liveButton').disabled, null, { timeout: 20000 });
      const result = await report(broken); assert(result.runs.some(run => ['EngineError', 'EngineUnavailable'].includes(run.outcome)));
      assert.equal(await broken.evaluate(() => window.__cameraRequested), 0); assert.equal(await broken.evaluate(() => window.__workers.active), 0); await broken.close();
    });
  }
  }
  await check('JavaScript-disabled viewer retains a static explanation', async () => {
    const disabled = await browser.newPage({ javaScriptEnabled: false }); await disabled.goto(url); assert(await disabled.locator('#bootWarning').isVisible()); await disabled.close();
  });
  await writeFile(path.join(artifacts, 'checks.json'), JSON.stringify({ url, evidence: 'desktop-browser-and-synthetic-media-only', checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifacts }));
} finally { await browser.close(); }
