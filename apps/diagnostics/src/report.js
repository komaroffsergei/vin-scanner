const status = value => ['pass', 'fail', 'blocked', 'untested', 'manual'].includes(value) ? value : 'untested';
const reason = value => value === 'pass' ? 'ok' : value === 'manual' ? 'manual_required' : value === 'blocked' ? 'api_missing' : value === 'fail' ? 'engine_failed' : 'not_run';
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;

export function checkRecord(id, value, values = {}) {
  const facts = {};
  for (const key of ['width', 'height', 'bytes', 'elapsedMs', 'fps', 'count']) if (finite(values?.[key]) !== null) facts[key] = values[key];
  if (typeof values?.supported === 'boolean') facts.supported = values.supported;
  return { id, status: status(value), reasonCode: reason(value), facts };
}

// Export only known scalar fields. Never serialize runtime records, error messages,
// native event detail, OCR items, camera labels, user inputs, or frozen frames.
export function buildSafeReport({ info, snapshot, settings, network, runs, engineChecks, suiteRows, redact, events }) {
  const mock = snapshot.lastAttempt;
  const sourceRuns = [...runs];
  if (mock?.runId) sourceRuns.push({
    runId: mock.runId, mode: 'mock', engineId: null, source: mock.source === 'camera' ? 'camera-live' : 'synthetic', frozenFrameId: null,
    captureIntervalMs: mock.settings.captureIntervalMs, sessionTimeoutSeconds: mock.settings.sessionTimeoutSeconds,
    confidence: { value: null, scale: 'unknown' }, profile: 'virtual', engineVersion: null, modelHashes: [], backend: 'memory',
    outcome: mock.status || 'Pending', formatValid: null, expectedMatch: null, positionMismatchCount: null, native: null,
    metrics: { initializationMs: null, framePreparationMs: null, firstInferenceMs: null, lastInferenceMs: null, totalMs: mock.elapsedMs,
      frames: mock.frames, sourceImageCount: mock.source === 'camera' ? mock.frames : 1, maxInFlight: mock.maxInFlight, queueLength: 0 },
    resultApplied: mock.applied, cleanupVerified: null,
  });
  const runRecords = sourceRuns.map(run => ({
    runId: run.runId, mode: run.mode, engineId: run.engineId, source: run.source, frozenFrameId: run.frozenFrameId,
    captureIntervalMs: run.captureIntervalMs, sessionTimeoutSeconds: run.sessionTimeoutSeconds,
    confidence: { value: finite(run.confidence?.value), scale: run.confidence?.scale || 'unknown' },
    profile: run.profile, engineVersion: run.engineVersion, modelHashes: [...run.modelHashes], backend: run.backend,
    outcome: run.outcome, formatValid: run.formatValid, expectedMatch: run.expectedMatch,
    positionMismatchCount: run.positionMismatchCount,
    native: run.native ? { accepted: run.native.accepted === true, tier: ['A', 'B', 'C'].includes(run.native.tier) ? run.native.tier : null,
      checkDigitOk: typeof run.native.checkDigitOk === 'boolean' ? run.native.checkDigitOk : null,
      source: ['auto', 'manual'].includes(run.native.source) ? run.native.source : null,
      decoder: ['beam', 'greedy'].includes(run.native.decoder) ? run.native.decoder : 'unknown' } : null,
    metrics: { initializationMs: finite(run.metrics.initializationMs), framePreparationMs: finite(run.metrics.framePreparationMs),
      firstInferenceMs: finite(run.metrics.firstInferenceMs), lastInferenceMs: finite(run.metrics.lastInferenceMs),
      totalMs: run.metrics.totalMs, frames: run.metrics.frames, sourceImageCount: run.metrics.sourceImageCount,
      maxInFlight: run.metrics.maxInFlight, queueLength: 0 },
    resultApplied: run.resultApplied, cleanupVerified: run.cleanupVerified,
  }));
  return {
    schemaVersion: 2, generatedAt: new Date().toISOString(), buildId: info.buildId,
    environment: { protocol: ['https:', 'http:', 'file:', 'content:'].includes(location.protocol) ? location.protocol : 'other', secureContext: isSecureContext,
      userAgent: redact(navigator.userAgent).slice(0, 2000), viewportWidth: innerWidth, viewportHeight: innerHeight,
      hardwareConcurrency: navigator.hardwareConcurrency || null }, settings,
    network: { policy: 'same-origin-static-assets', virtualOperations: snapshot.virtualOperations,
      blobResourceReads: 0, observedHttpAttempts: network.staticResourceRequests + network.blockedAttempts,
      staticResourceRequests: network.staticResourceRequests, blockedAttempts: network.blockedAttempts,
      externalVerification: 'not_performed', evidenceSource: 'application_only' },
    deviceChecks: snapshot.checks.map(check => checkRecord(check.id.toLowerCase(), check.status, check.values)),
    logicChecks: snapshot.selfTests.map((test, index) => checkRecord('mock.case-' + (index + 1), test.pass === null ? 'untested' : test.pass ? 'pass' : 'fail', { elapsedMs: test.elapsedMs })),
    engineChecks: [...engineChecks.values()].map(check => ({ ...checkRecord(check.id, check.status, check.facts), reasonCode: check.reasonCode })),
    manualChecks: snapshot.manual.map(([id, value]) => checkRecord(id, value)),
    runs: runRecords,
    events: [...snapshot.events.map(event => ({ atMs: Math.max(0, Date.parse(event.time) - performance.timeOrigin), code: 'baseline.' + event.category.replace(/[^a-z0-9._-]/g, ''), runId: null, engineId: null, reasonCode: null, count: null })), ...events.map(event => ({ atMs: event.atMs, code: event.code, runId: event.runId, engineId: event.engineId, reasonCode: event.reasonCode, count: event.count }))],
    limitations: ['physical_phone_acceptance_pending', 'camera_not_proven_by_synthetic_suite', 'no_backend_or_authorization_test', 'confidence_scales_not_comparable', 'network_counts_are_application_observations'],
    testSuite: { suiteId: 'vin-synthetic-v1', cases: suiteRows.map(row => ({ caseId: row.caseId, engineId: row.engineId,
      status: row.status, reasonCode: row.reasonCode, expectedMatch: row.expectedMatch, actualLength: row.actualLength,
      positionMismatchCount: row.positionMismatchCount, elapsedMs: row.elapsedMs, noiseSigma: row.noiseSigma,
      stretchX: row.stretchX, nativeAccepted: row.nativeAccepted })) },
  };
}
