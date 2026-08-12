# Optical Artifact Transport (OAT)

A browser-native, capability-safe physical transport for moving signed state,
structured artifacts, and optionally negotiated UI across devices using only
a display and a camera.

`<optical-send>` renders a signed, verified artifact as an animated,
fountain-coded sequence of QR frames. `<optical-receive>` points a camera at
the screen, reconstructs the artifact even under dropped/duplicated/reordered
frames, verifies its digest and signature, and — if the sender proposed one —
renders a receiver-sanitized UI for the user to accept, downgrade, or reject.

This is not a replacement for AirDrop, Nearby Share, or HTTPS. It targets
payloads too large for a single QR code where zero-setup handoff, physical
locality, air-gap compatibility, or trust bootstrapping matter more than raw
throughput.

## Status

First implementation pass, scoped to milestones M0–M4 from the design doc
(`docs/design.md`):

- **M0** — protocol spec: artifact envelope, capability registry, UI proposal
  grammar.
- **M1** — transport simulator: encode/decode without camera hardware, with
  loss/duplication/reorder/corruption injection.
- **M2** — `<optical-send>` MVP.
- **M3** — `<optical-receive>` MVP.
- **M4** — safe UI: sanitization profiles, declarative forms/actions,
  capability-gated rendering.

M5 (bootstrap workflows: WebRTC/BitTorrent/release-manifest examples) and M6
(unsafe-HTML sandboxed iframe profile) are **out of scope** for this pass.

## Packages

```
packages/
  protocol/            artifact envelope, canonical CBOR, digest, ed25519 signatures, capabilities, UI proposal types
  codecs/qr-fountain/  LT fountain encoder/decoder + QR frame render/decode
  sim/                 transport simulator (loss/dup/reorder/corruption)
  sender/              <optical-send> custom element
  receiver/            <optical-receive> custom element
  ui/                  safe-view/safe-html rendering, sanitizer, capability policy engine
examples/
  file-transfer/       live demo wiring sender + receiver together
```

## Development

```bash
npm install
npm run build
npm test
npm run dev:demo   # examples/file-transfer on localhost
```

## Security model (summary)

- Every artifact carries a digest and an optional Ed25519 signature; the
  receiver never delivers unverified bytes to the host app.
- A sender may *propose* a UI (`UiProposalEnvelope`), but the receiver always
  owns rendering. Outcomes are: reject, downgrade to fallback, accept-safe
  (sanitized, receiver-rendered), or accept-unsafe (out of scope here — see
  M6 in the design doc).
- Effective capabilities are always
  `sender requested ∩ receiver policy ∩ user-approved grants`. Rendering is
  never authority — declarative actions only carry typed, receiver-mediated
  requests, never remote code or DOM handles.

See `docs/design.md` for the full PRD this implementation follows.
