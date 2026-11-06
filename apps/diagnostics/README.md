# VIN diagnostics stand

An isolated, Russian-language diagnostic application. It extends the current camera/mock HTML with actual local PaddleOCR, Tesseract.js and the full native vin-scanner. It does not contain a BFF client, cloud OCR, image upload or application authentication.

## Build

From the repository root, use Node >=20 and Python 3:

```sh
npm ci --ignore-scripts
cd apps/diagnostics
npm run assets
npm run build
npm run dev
```

The local preview listens on `http://127.0.0.1:4317/vin-scanner/`. It serves the production build and enforces the same CSP classes as hosting. It does not use port 4200. `BUILD_ID` optionally fixes the release ID. Build output references `/vin-scanner/releases/<buildId>/assets/`; host the complete versioned directory before switching the public entry document.

`public/assets` and `dist` are generated and ignored. Runtime weights are downloaded during preparation with explicit checksums. Package files are locked by npm integrity. Native model/runtime versions and fixture hashes are checked before build. The emitted asset manifest covers JS, worker, WASM, weights, dictionaries, licenses, canonical images and ZIP. No CDN is required at runtime.

Canonical input PNGs are committed under `fixtures/images`. They must not be regenerated to improve a measured score. To deliberately create a new fixture revision, run `npm run fixtures` with Playwright 1.62.1's Chromium installed, inspect the manifest/image diff, then run `npm run assets`. The fixed DejaVu font, seed, dimensions, distortions and hashes are recorded. Synthetic VIN labels are intentionally public test data; they are not sent to OCR workers or included in diagnostic JSON.

## Runtime contracts

- Two tabs: browser-memory mock and on-device OCR. Only a button starts an engine or camera.
- Paddle uses the official 0.4.2 worker transport with its normalized pipeline config and bundled ORT 1.24.3. OpenCV never runs in the host. Only the Paddle worker response permits `unsafe-eval`.
- Tesseract uses the official 7.0.0 worker protocol, core 7.0.0, eng 1.0.0 / `4.0.0_best_int`, LSTM, single-line segmentation and VIN whitelist. The host owns the worker even during pending initialization so Stop can terminate it immediately.
- The native live component retains all existing camera controls, burst, guide fallback, n-gram/beam, corrections and Tier A/B/C. Frozen runs use its original worker; every separate image starts with RESET. Core algorithms and weights are unchanged.
- Paddle/Tesseract require a complete unambiguous 17-character read and two fresh matching video frames for live acceptance. No replacement, line concatenation or VIN substring extraction occurs. Frozen/synthetic input cannot establish live confirmation.
- Every run has a generation and input revision. At most one OCR runtime/camera owner/frame in flight is permitted. Model init is bounded by 60 seconds, including resource loading; recognition starts after the camera is ready. Permission can remain pending until Stop. Stop/terminal/tab/engine/camera changes/hidden/pagehide destroy owned runtime and tracks; there is no automatic resume.
- The suite runs 16 images × three real engines sequentially, one initialized runtime per engine, no camera. Each input has a 30-second operation budget. Fatal engine failure leaves later cases untested and continues the next engine. A mismatch is measured, not hidden or retried against the reference label.
- Safe JSON uses the amended schemaVersion 2 schema. It excludes images, binary data, entered/expected/recognized VINs, raw reads, camera identifiers and exception text. Resource observations include host and worker resource timing counts; they are not packet capture. Independent verification defaults to `not_performed`.
- Native optional event `scan-resource-observed` contains only `{count}`; it has no effect on inference. Native lifecycle guards cover worker init, pending permission, autofocus, play, retry, bitmap and torch awaits. Other native public events retain their shapes.

## Validation

```sh
# Existing core tests plus diagnostics logic tests
npm test
# From this directory, after starting the production preview
node test/browser.mjs
```

The Windows WebKit test environment exposes OffscreenCanvas but cannot create its worker 2D context. Paddle/native report `canvas_worker_unavailable`; this is an explicitly unverified engine combination, not proof about iPhone Safari. Tesseract can use a local `data:` read for its bundled WASM; that local-only scheme is permitted by connect policies and is not HTTP. No external HTTP origin is permitted.

Browser plugin is not available in the implementation environment; checks use regular Playwright. Browser output and screenshots go to the OS temporary directory, not this repository. The browser suite performs real WASM inference, checks all 48 inputs, verifies the JSON schema/privacy, camera/mock regressions and cancellation. Browser-generated streams are synthetic evidence, never physical-phone acceptance.

The SDD in `specs/001-dual-mode-diagnostics` is amended by `approved-changes.md`. The original embedded-offline and zero-HTTP assumptions are superseded by same-origin static assets; original TC31/TC32 are now a resource-origin/method audit and cold HTTPS startup test, not an offline promise.

## Physical phone acceptance — pending

On a real Android in Chrome and a real iPhone in Safari:

1. Open the HTTPS stand directly in the browser, record phone/OS/browser versions. Initial camera and OCR must be off.
2. Run the 16-image suite. Save JSON; all three engines must initialize and actually read clean controls. A lower distorted-image score is a measurement, not a device failure.
3. Open the camera, test denial/pending permission and retry. Aim at a legible VIN, verify the crop, camera selector and optional focus/zoom/torch where available.
4. Run each live OCR, edit the VIN during initialization and confirm it is not overwritten. Check Stop and restart. For the native fork also try shutter/manual burst, hints and retry.
5. Freeze one crop and compare all three engines. Rotate portrait/landscape and verify the crop still contains the same intended VIN area.
6. While scanning/loading, switch tabs/engines, background the browser and lock the screen. All work must stop; returning must not resume. Confirm the system camera indicator turns off.
7. Mark the actual manual checks, download/copy JSON and return it with OS/browser versions. Do not send photos or VINs.

Until these physical checks are performed, neither Android Chrome nor iPhone Safari is claimed as verified. Desktop Chrome, Firefox, WebKit and fake-camera tests do not substitute for them. BFF/auth/cloud quality and recognition accuracy on real automotive datasets remain outside this stand.

## Hosting

Deploy with cw's personal SSH profile. Upload a complete immutable release directory, test its preview URL, and atomically replace the stable `/vin-scanner/` index. Keep the previous entry document for rollback and retain existing assets for open pages. Apply response CSP to worker files too. Only the Paddle worker may have JS `unsafe-eval`; every document/worker may connect only to the stand's versioned static asset path. Keep `Permissions-Policy: camera=(self), microphone=()`, `nosniff`, no-referrer and no-store for the entry document. Static serving rejects methods other than GET/HEAD. Do not alter the main test-shop application or unrelated nginx configuration.

Retain root LICENSE, NOTICE, third-party licenses and the source link to the exact published commit. The native package is AGPL-3.0-only, the bundled OCR dependencies retain their own licenses. No private cw configuration, credentials or TISS application source belongs in a release or source archive.
