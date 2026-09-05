# Changelog

All notable changes to the OAT monorepo (all seven `@johnhenry/oat-*`
packages plus the unpublished `examples/file-transfer` demo) are documented
here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
packages are versioned together.

## [Unreleased]

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

### Fixed

- **`@johnhenry/oat-protocol`: artifact expiry failed open on any value
  `Date.parse` could not read.** `verifyArtifact` evaluated it as
  `Boolean(artifact.expiresAt && Date.now() > Date.parse(artifact.expiresAt))`,
  and `NaN > x` is `false`, so `'not-a-date'`, `''` and `'2026-13-45'` all
  produced `expired: false`, `valid: true`, `reasons: []` — an artifact that
  silently never expires, with nothing anywhere saying the field was
  unreadable. `isOatArtifact` does not inspect `expiresAt` at all, so
  non-strings survive assembly off the camera too, and `Date.parse` coerces
  them with `String()`: measured on V8, `Date.parse(42)` is
  `2042-01-01T08:00:00Z`, a sixteen-year lifetime from one byte on the wire.

  `expiresAt` now fails closed. It must be a string beginning with an
  ISO-8601 calendar date (which is what `buildArtifact` emits, and the one
  form `Date.parse` is specified to read consistently); anything else, or
  anything that still parses to `NaN`, is reported as
  `expires-at-unreadable` and the artifact does not verify. Absent is
  unchanged: an artifact with no `expiresAt` still does not expire.

  This matters because expiry is the *only* one of the design doc's three
  named controls against its listed "Payload replay" threat ("Expiry, nonce,
  and session binding") that exists in the code — `grep -rn nonce
  packages/*/src` finds nothing.

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
