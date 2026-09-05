# Changelog

All notable changes to the OAT monorepo (all seven `@johnhenry/oat-*`
packages plus the unpublished `examples/file-transfer` demo) are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
packages are versioned together.

## [Unreleased]

### Added

- Coverage for `gatherIceCandidates`'s event-driven paths. The existing
  `MockRTCPeerConnection` defines `addEventListener()` as an empty method
  and reports `iceGatheringState === 'complete'`, so both of its tests took
  a path that never registers a listener — candidate accumulation, the null
  end-of-candidates signal, the `icegatheringstatechange` transition, and
  the listener cleanup all had no coverage at all.
- `max-scan-width` on `<optical-receive>` (default 1280) plus the
  `scanFrameSize()` / `DEFAULT_MAX_SCAN_WIDTH` exports behind it.
- `randomId()` in `@johnhenry/oat-protocol` — a v4 UUID from
  `crypto.randomUUID()` where that exists and from `crypto.getRandomValues()`
  where it does not.
- `@johnhenry/oat-qr-fountain` now publishes three subpath entrypoints —
  `/fountain` (codec only), `/encode` (`qrcode`) and `/decode` (`jsqr`) —
  so a sender never ships the QR decoder and a receiver never ships the QR
  encoder. `<optical-send>`, `<optical-receive>` and `@johnhenry/oat-sim`
  import through them. The package root still exports everything.

### Fixed

- **`@johnhenry/oat-bootstrap` validated one of the three fields it hands to
  WebRTC.** `deserializePayload` checked `role` and returned the rest as-is,
  so a verified artifact carrying `{"role":"answer","sdp":"v=0"}` reached
  `applyAnswerArtifact`, applied the remote description, and *then* threw
  `TypeError: answer.candidates is not iterable` with the connection already
  mutated; `"candidates":"nope"` iterated the string's characters into
  `addIceCandidate()`; a non-string `sdp` reached `setRemoteDescription()`;
  and a `null` payload threw `TypeError: Cannot read properties of null`
  instead of the module's own error. Every field is now checked before
  anything touches the connection. The trusted-sender gate in front of this
  means it was defence in depth rather than an authentication hole.
- **`<optical-receive>` scanned every frame at the camera's native
  resolution.** `#scanFrame()` sized its scan canvas to `video.videoWidth` /
  `videoHeight` and handed all of those pixels to jsQR — on the main thread,
  since `decode-worker.ts` is still inline — at 8 fps. Measured on Apple
  silicon with a QR filling 70 % of frame height, one 1080p frame costs
  34.5 ms of decode against a 125 ms budget, and a mid-range Android WebView
  is several times slower again. Frames are now downscaled to at most
  `max-scan-width` pixels wide (default 1280, `0` to scan natively), which
  takes that 1080p frame to 15.4 ms.
- **`crypto.randomUUID()` was called unconditionally, so the send path threw
  on iOS 15.0-15.3 and on every non-secure origin.** `crypto.randomUUID`
  landed in WebKit 15.4 and is a secure-context-only API, so it is `undefined`
  both on those iOS versions and on any plain-`http:` origin — a LAN address
  or a custom WebView scheme included — and `buildArtifact()`,
  `buildUiProposal()` and `<optical-receive>`'s capability-token minting all
  called it with no guard, taking down the whole path with
  `TypeError: crypto.randomUUID is not a function`. All three now go through
  the new `randomId()` in `@johnhenry/oat-protocol`, which falls back to
  `crypto.getRandomValues()` — the same CSPRNG, with neither restriction.
- **`@johnhenry/oat-qr-fountain` shipped both QR libraries to every
  consumer.** `renderPacketToCanvas` and `decodePacketFromImageData` lived
  in one module (`scheduler.ts`) that imported `qrcode` *and* `jsqr` at top
  level. Neither of those packages declares `sideEffects`, so a bundler
  could not prove the unused half unreachable and this package's own
  `sideEffects: false` bought nothing: an encode-only import and a
  decode-only import produced bundles of 55,128 and 55,195 bytes gzipped —
  effectively identical. Split into `qr-encode.ts` / `qr-decode.ts`, an
  encode-only import is now 9,798 bytes gzipped (−45,330, −82 %) and a
  decode-only import 47,447 bytes (−7,748, −14 %). A whole-element bundle
  of `<optical-send>` drops from 83,151 to 37,527 bytes gzipped, and
  `<optical-receive>` from 85,337 to 77,748.

### Added

- Per-package READMEs for all seven packages (`@johnhenry/oat-protocol`,
  `-qr-fountain`, `-sim`, `-sender`, `-receiver`, `-ui`, `-bootstrap`):
  install, quick start, the traps worth knowing, API surface, and pointers
  to the full docs at <https://opensource.johnhenry.me/oat/>.
- Numbered headless examples (`examples/01`–`04`) covering the encode/decode
  round trip, loss/corruption injection and recovery, the signed-artifact
  verify/reject flow, and the release-manifest bootstrap flow — all via
  `@johnhenry/oat-sim`, no camera or display needed. Wired up as
  `npm run examples` / `npm run example:NN` and as a CI smoke step in the
  release gate.
- Root README architecture section promoted from `docs/design.md`
  (which remains the full PRD), plus a package table linking the
  per-package READMEs.

## [0.1.0] — 2026-08-14

First release under the `@johnhenry` scope, published to npm on 2026-08-14
during the 2026-08 consolidation of personal open source under the
`johnhenry` umbrella (packages were previously developed in-repo under the
`@oat/*` working scope and never published under it). Published from commit
`1a98d61` via the release workflow; no git tag was cut for this release.

### Added

- **M0 protocol** (`@johnhenry/oat-protocol`) — the `OatArtifact` envelope:
  canonical CBOR, SHA-256 digests, Ed25519 signatures (public key carried
  inline), optional gzip compression and expiry; the capability model
  (`effective = requested ∩ policy ∩ user-approved`); the UI proposal
  grammar (`text`/`form`/`media`/`safe-html`/`sandboxed-html` views); M6
  sandbox eligibility (`checkSandboxEligibility`); the signed `ui.decision`
  acknowledgment wire type.
- **M1 transport simulator** (`@johnhenry/oat-sim`) — the full
  sender→channel→receiver pipeline in software with seeded
  loss/duplication/reorder/corruption injection.
- **Wire format** (`@johnhenry/oat-qr-fountain`) — LT fountain
  encoder/decoder with robust-soliton degree distribution, compact binary
  packet framing, QR frame render/decode, frame scheduler.
- **M2 sender** (`@johnhenry/oat-sender`) — the `<optical-send>` custom
  element: source adapters (Blob/File/string/stream/async-iterable),
  artifact building/signing, `<template slot>` UI-proposal authoring,
  animated fountain-coded QR output.
- **M3 receiver** (`@johnhenry/oat-receiver`) — the `<optical-receive>`
  custom element: camera capture, fountain decode, digest/signature/expiry
  verification, the policy engine (four outcomes: reject / downgrade /
  accept-safe / accept-unsafe), per-profile `requireSignatureFor` and
  `approval` modes, trust-on-first-use (`oat-unknown-sender` +
  `trustSenderAndContinue()`/`rejectUnknownSender()`), the signed
  `ui.decision` builder.
- **M4 safe UI** (`@johnhenry/oat-ui`) — pinned-allowlist sanitizer with
  per-profile resource limits (`maxNodes`/`maxDepth`/`maxTextBytes`) and
  native `Element.setHTML()` layering; safe-view renderers (plain DOM,
  never `innerHTML`); capability and trust prompts.
- **M5 bootstrap** (`@johnhenry/oat-bootstrap`) — verified release-manifest
  fetch (digest-checked, mirror fallback, `https:`-only allowlist) and real
  WebRTC offer/answer exchange; every extract/apply function enforces its
  own verified-signature gate.
- **M6 break-glass** — `sandbox="allow-scripts"` iframe host with typed,
  rate-limited postMessage bridge, self-navigation teardown, Trusted Types
  policy (`oat-sandbox-srcdoc`), high-visibility opt-in prompt, and kill
  switch; triple-gated on verified signature + explicitly trusted sender +
  receiver `allowUnsafeHtml` opt-in.
- **Demo** (`examples/file-transfer`, unpublished) — arbitrary file
  transfer, declarative form proposal, live policy presets, a capability
  with a real downloadable effect (`.ics`), and the optical `ui.decision`
  round trip.

### Fixed (pre-publish hardening pass)

- `trustSenderAndContinue()` now rebuilds the policy engine via the
  `trustedPublicKeys` setter — a direct mutation previously left the M6
  trust-list check stale, so a newly-trusted sender's first unsafe-HTML
  proposal could downgrade despite `allowUnsafeHtml`.
- The `ui-policy` attribute is observed after construction (it was
  previously only read at startup, so runtime policy switches were
  silently ignored).
- Added the missing settable `autoApprove` property on
  `<optical-receive>`, matching the policy engine's existing support.

[Unreleased]: https://github.com/johnhenry/optical-artifact-transport/compare/1a98d61...HEAD
[0.1.0]: https://github.com/johnhenry/optical-artifact-transport/commit/1a98d61
