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

Implements the full M0–M6 milestone set from the design doc (`docs/design.md`):

- **M0** — protocol spec: artifact envelope, capability registry, UI proposal
  grammar.
- **M1** — transport simulator: encode/decode without camera hardware, with
  loss/duplication/reorder/corruption injection.
- **M2** — `<optical-send>` MVP.
- **M3** — `<optical-receive>` MVP.
- **M4** — safe UI: sanitization profiles, declarative forms/actions,
  capability-gated rendering.
- **M5** — bootstrap workflows: a small signed optical artifact unlocks a
  faster follow-on transport. Implemented: a verified release-manifest fetch
  (digest-checked, mirror-fallback HTTPS download) and a real WebRTC
  offer/answer exchange (genuine `RTCPeerConnection`, live data channel).
  BitTorrent/content-addressed bootstrap is not implemented — the pattern
  generalizes to it, but it wasn't built.
- **M6** — unsafe-HTML break-glass profile: a `sandbox="allow-scripts"`
  iframe (no `allow-same-origin`/`allow-forms`/`allow-popups`/
  `allow-downloads`/`allow-top-navigation`), a typed/rate-limited postMessage
  bridge, a high-visibility opt-in prompt, and a persistent kill switch. Only
  reachable for a signed artifact from an explicitly trusted sender, with the
  receiver deployment separately opting in — see Security model below.

Beyond the M0–M6 milestones, a second pass closed several gaps identified
against the original design conversation (`docs/design.md`):

- **Bidirectional `ui.decision`** (`@johnhenry/oat-protocol`'s `ui-decision.ts`) — the
  receiver can build a signed acknowledgment (accepted/downgraded/rejected,
  granted/denied capabilities, a correlation token) and send it back to the
  sender over any channel; the demo shows it traveling back optically via a
  second `<optical-send>`/`<optical-receive>` pair.
- **Granular per-profile `ReceiverUiPolicy`** — `requireSignatureFor` (a
  per-profile signature requirement, independent of the element-wide
  `verify` attribute) and `approval` (`'automatic'`/`'prompt'`/
  `'prompt-with-warning'` per profile), surfaced as a new `awaiting-consent`
  receiver state gated behind `confirmProposal()`/`dismissProposal()`.
- **Sanitizer resource limits** — `maxNodes`/`maxDepth`/`maxTextBytes` per
  profile, enforced on the sanitized result (not on parsing the raw input).
- **Native `Element.setHTML()` layering** — used as a pre-pass ahead of the
  pinned allowlist sanitizer when the runtime supports it, with an explicit
  per-profile config (the native API's *default* config is stricter than
  some of our profiles for specific elements — Chrome silently drops
  `<form>`/`<button>` without one).
- **Trusted Types** — a dedicated `oat-sandbox-srcdoc` policy so the M6
  iframe's `srcdoc` assignment keeps working under a host CSP with
  `require-trusted-types-for 'script'`.
- **Trust-on-first-use (TOFU) key confirmation** — a signature already
  carries the signer's public key inline, so no separate key-exchange step
  is needed for cross-device use. With `requireExplicitTrust` set, a
  digest-valid, signature-valid artifact from a key not yet on
  `trustedPublicKeys` surfaces as a new `unknown-sender` receiver state
  (`oat-unknown-sender` event) instead of silently trusting or rejecting it;
  `trustSenderAndContinue()`/`rejectUnknownSender()` resolve it, and
  `@johnhenry/oat-ui`'s `renderTrustPrompt()` renders the "confirm public key:
  ..." fingerprint prompt the demo uses.

`examples/file-transfer` was then expanded to exercise more of the
library's existing surface end to end, surfacing one correctness fix along
the way:

- **Arbitrary file transfer** — any file (image, PDF, ...) travels through
  the same pipeline as a plain message; the receiver renders an image
  preview or a download link depending on media type. No library changes
  were needed — `<optical-send>`'s `source` setter already accepts a `Blob`
  (picking up its `type` automatically) and `controls` already renders a
  live transfer progress bar.
- **Declarative `safe-view` form proposal** — a "Schedule a follow-up" demo
  exercises the `'form'` `safe-view` kind (`renderFormView`), implemented
  since M4 but never exercised by the demo before: no HTML at all, just
  typed field descriptors the receiver renders itself.
- **Live receiver policy presets** — a dropdown switches the receiver
  between Safe/Strict/Permissive/Locked-down `ReceiverUiPolicy`
  configurations at runtime, demonstrating the granular per-profile policy
  system end to end. This surfaced two small `<optical-receive>` reactivity
  gaps, both fixed: the `ui-policy` attribute wasn't observed after
  construction (every other policy input was a property setter that
  rebuilds the engine on write; this one only got picked up incidentally),
  and there was no settable `autoApprove` property at all even though the
  policy engine already supported it.
- **Capabilities with real effects** — granting `calendar.event.create` on
  the structured-form proposal now builds and downloads a real `.ics` file
  instead of just logging the grant, re-checked via `checkCapability()` at
  submit time rather than trusted from the action payload.
- **Fix: `trustSenderAndContinue()` now rebuilds the policy engine.** It
  previously mutated the trust list directly instead of going through the
  `trustedPublicKeys` setter, so `allowUnsafeHtml`'s trust-list-length check
  stayed stale at "nobody trusted yet" until some *other* setter happened to
  trigger a rebuild afterward. In practice: a newly-trusted sender's very
  first M6 proposal, sent immediately after confirming trust, could
  downgrade instead of reaching `accept-unsafe` even with `allowUnsafeHtml`
  already opted in.

## Architecture

The pipeline, sender to receiver (from `docs/design.md`, which remains the
full PRD):

```text
Source: Blob | URL | ReadableStream | AsyncIterable | structured artifact
                              |
                              v
                    Artifact envelope                @johnhenry/oat-protocol
     metadata | compression | encryption | signatures | expiry
                              |
                              v
                   Framing + FEC encoder             @johnhenry/oat-qr-fountain
                              |
                              v
              Optical codec: qr-fountain initially
                              |
                              v
                    Display frame scheduler          @johnhenry/oat-sender
                              |
                     screen -> camera
                              |
                              v
        Camera decode -> packet store -> FEC reassembly    @johnhenry/oat-receiver
                              |
                              v
            verification -> policy -> app/UI delivery      @johnhenry/oat-receiver + @johnhenry/oat-ui
```

The layering that keeps this maintainable:

- **The artifact envelope and capability model are the stable platform
  layers.** Every payload — a message, a file, a UI proposal, a signed
  `ui.decision`, a bootstrap manifest — travels as the same canonical-CBOR
  `OatArtifact` with a digest and optional Ed25519 signature. Nothing above
  the envelope knows or cares what physical codec carried it.
- **QR is only the first physical codec.** The fountain layer
  (`@johnhenry/oat-qr-fountain`) emits independently-decodable LT packets;
  the receiver never needs any particular frame, or frames in order, just
  *enough* of them — which is why the system tolerates missed frames,
  glare, focus changes, and late scanning. Future codecs (denser grids,
  low-salience modulation) slot in under the same envelope.
- **Verification sits between reassembly and delivery, always.** The
  receiver never delivers unverified bytes to the host app, and a
  sender-proposed UI passes through a receiver-owned policy engine with
  exactly four outcomes: reject, downgrade, accept-safe (sanitized,
  receiver-rendered), accept-unsafe (M6 break-glass, triple-gated).
- **Rendering is never authority.** Effective capabilities are always
  `sender requested ∩ receiver policy ∩ user-approved grants`; declarative
  actions carry typed, receiver-mediated requests — never remote code,
  never a DOM handle back to the sender.
- **The simulator is a first-class surface.** `@johnhenry/oat-sim` runs the
  identical envelope + fountain pipeline with no camera, display, or
  canvas, plus seeded loss/duplication/reorder/corruption injection — it's
  how the transport is tested in CI (see `examples/`).

## Packages

| Directory | Package | What it is |
| --- | --- | --- |
| [`packages/protocol`](packages/protocol/README.md) | `@johnhenry/oat-protocol` | Artifact envelope, canonical CBOR, digest, Ed25519 signatures, capabilities, UI proposal types, M6 sandbox eligibility, `ui.decision` wire type |
| [`packages/codecs/qr-fountain`](packages/codecs/qr-fountain/README.md) | `@johnhenry/oat-qr-fountain` | LT fountain encoder/decoder + QR frame render/decode |
| [`packages/sim`](packages/sim/README.md) | `@johnhenry/oat-sim` | Transport simulator (loss/dup/reorder/corruption), no camera needed |
| [`packages/sender`](packages/sender/README.md) | `@johnhenry/oat-sender` | `<optical-send>` custom element |
| [`packages/receiver`](packages/receiver/README.md) | `@johnhenry/oat-receiver` | `<optical-receive>` custom element, granular per-profile policy (`requireSignatureFor`/`approval`) |
| [`packages/ui`](packages/ui/README.md) | `@johnhenry/oat-ui` | Safe-view/safe-html rendering, sanitizer (native-API layering + resource limits), M6 sandbox host + iframe bridge + Trusted Types policy |
| [`packages/bootstrap`](packages/bootstrap/README.md) | `@johnhenry/oat-bootstrap` | M5 bootstrap workflows: release-manifest fetch+verify, WebRTC offer/answer |
| [`examples/file-transfer`](examples/file-transfer) | (not published) | Live demo wiring sender + receiver together: M5/M6 flows, the `ui.decision` round trip, arbitrary file transfer, a declarative form proposal, live receiver policy presets, a capability with a real (downloadable) effect |

Full documentation lives at <https://opensource.johnhenry.me/oat/>.

## Examples

Numbered, headless examples live in [`examples/`](examples/README.md) —
they run on Node with no camera or display, via `@johnhenry/oat-sim`:

```bash
npm run build       # examples import the built packages
npm run examples    # runs all numbered examples
npm run example:02  # or one at a time
```

| Example | Shows |
| --- | --- |
| `01-round-trip.mjs` | Envelope build → fountain encode → decode → verify → payload extraction |
| `02-lossy-channel.mjs` | Loss/duplication/reordering injection and recovery; graceful failure under extreme loss |
| `03-signed-verify-reject.mjs` | Signature verification end to end; tampering and unsigned artifacts rejected with reasons |
| `04-bootstrap-manifest.mjs` | Signed release-manifest bootstrap: extract refuses unsigned, mirrors fall back on digest mismatch |

`examples/file-transfer` is the full browser demo app (`npm run dev:demo`).

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
  (sanitized, receiver-rendered), or accept-unsafe (M6 break-glass — see
  below).
- Effective capabilities are always
  `sender requested ∩ receiver policy ∩ user-approved grants`. Rendering is
  never authority — declarative actions only carry typed, receiver-mediated
  requests, never remote code or DOM handles.
- **M6 unsafe-HTML eligibility** (`checkSandboxEligibility`) requires *all*
  of: a verified signature, the signer being on the receiver's explicit
  `trustedPublicKeys` list (a valid signature alone only proves *some* key
  signed it — anyone can generate one), and the receiver deployment setting
  `allowUnsafeHtml`. Any one of these missing downgrades to the fallback
  view instead. The mounted iframe's sandbox tokens don't gate
  self-navigation (a known limitation of the iframe sandbox model); the host
  detects it out-of-band (a second `load` event after the initial `srcdoc`
  render) and tears the frame down immediately rather than let it run with
  an un-enforced CSP.
- **M5 bootstrap functions** (`extractReleaseManifest`,
  `extractWebrtcBootstrapPayload`, and the `createAnswerArtifact`/
  `applyAnswerArtifact` that call it) refuse to run on anything without an
  affirmatively verified signature — these trigger real side effects (an
  HTTP fetch, applying WebRTC session data), so they enforce this
  themselves rather than trusting every caller to check first. Release-manifest
  URLs are additionally restricted to `https:` by default
  (`allowedUrlSchemes`) as an SSRF guard, mirroring `@johnhenry/oat-ui`'s sanitizer.
- **`ui.decision` artifacts** are subject to the same rule: `extractUiDecision`
  refuses anything without a verified signature, since a decision claims
  capabilities were granted.
- **Trusted Types**: hosts that enable `Content-Security-Policy:
  require-trusted-types-for 'script'` must add `trusted-types
  oat-sandbox-srcdoc` (or `trusted-types *`) to their policy for the M6
  iframe's `srcdoc` assignment to keep working — see
  `packages/ui/src/trusted-types.ts`.

See `docs/design.md` for the full PRD this implementation follows.
