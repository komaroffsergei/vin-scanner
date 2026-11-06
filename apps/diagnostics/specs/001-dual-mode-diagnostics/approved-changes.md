# Approved implementation changes — 2026-11-06

This document supersedes the corresponding packaging assumptions in this SDD.

- Deploy an HTTPS application with same-origin static assets at the existing `/vin-scanner/` stand. A single embedded/offline HTML is no longer required. No CDN, backend OCR, frame upload, authentication or actual BFF client is allowed.
- Keep two tabs and the full native fork. Permit dynamic JavaScript only in the Paddle/OpenCV worker response CSP, never in the host document. Use the official worker without importing OpenCV on the host.
- Pin Paddle 0.4.2 with its bundled ORT 1.24.3, Tesseract/core 7.0.0 and eng 1.0.0, native fork ORT 1.24.2. Keep compatible runtime files separate.
- Add a stand button for 16 deterministic synthetic images (four VINs × clean/noise/stretch/combined). Run all three actual engines sequentially, without a camera. Ground truth is host-only. One inference operation has a 30-second limit; one engine initialization has a 60-second limit. Reset native consensus between images. An unconfirmed native read remains visible separately from acceptance.
- Export safe suite metrics, not VINs, OCR text or images. Network policy is `same-origin-static-assets`; observed static reads are distinct from virtual operations and independent network verification.
- Measure exact matches and timing without a required accuracy percentage on distorted inputs. Each engine must actually read a clean control input.
- Real Android Chrome and iPhone Safari acceptance is required. The owner performs the documented physical checks and returns JSON. Until then both platforms remain unverified.
- Work in the personal fork, branch `codex/vin-scanner-diagnostics`, open a PR, deploy through cw. Preserve the current HTML's content/permission/policy diagnostics. Do not modify B2B or Jira.

Implementation order: resource feasibility → baseline and lifecycle → real OCR → fixtures and suite → automated checks → versioned cw deployment → physical-phone acceptance.
