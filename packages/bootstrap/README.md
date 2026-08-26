# @johnhenry/oat-bootstrap

M5 bootstrap workflows: a small, signed optical artifact unlocks a faster
follow-on transport that wouldn't otherwise have a trust anchor. Two
workflows ship — a verified release-manifest fetch (digest-checked,
mirror-fallback HTTPS download) and a real WebRTC offer/answer exchange
(genuine `RTCPeerConnection`, live data channel, signaled entirely by
optical artifacts instead of a signaling server).

```sh
npm install @johnhenry/oat-bootstrap
```

## Quick start: release manifest

```js
import { verifyArtifact } from '@johnhenry/oat-protocol';
import {
  buildReleaseManifestArtifact,
  extractReleaseManifest,
  fetchAndVerifyManifest
} from '@johnhenry/oat-bootstrap';

// Sender: a signed manifest of digests + mirror URLs (small — travels optically)
const artifact = await buildReleaseManifestArtifact(manifest, { sign: { secretKey } });

// Receiver: verify first, then extract, then fetch the real bytes over HTTPS
const verification = verifyArtifact(artifact, { requireSignature: true });
const received = await extractReleaseManifest(artifact, verification); // throws if unsigned/unverified
const results = await fetchAndVerifyManifest(received); // tries mirrors in order; digest + size checked
```

## Quick start: WebRTC

```js
import { createOfferArtifact, createAnswerArtifact, applyAnswerArtifact } from '@johnhenry/oat-bootstrap';

const offerArtifact = await createOfferArtifact(pc, { sign: { secretKey } });
// ...offer travels optically; on the answering side:
const answerArtifact = await createAnswerArtifact(remotePc, offerArtifact, offerVerification, { sign: ... });
// ...answer travels back optically:
await applyAnswerArtifact(pc, answerArtifact, answerVerification);
// pc's data channel is now live — the fast channel the optical hop bootstrapped
```

## The traps

- **Every extract/apply function enforces its own signature gate.** These
  payloads trigger real side effects the instant they're trusted — an HTTP
  fetch to a sender-chosen URL, applying sender-chosen WebRTC session data.
  So `extractReleaseManifest`, `extractWebrtcBootstrapPayload`,
  `createAnswerArtifact`, and `applyAnswerArtifact` all *throw* unless the
  verification you pass has `valid: true` **and** `signatureValid: true`.
  `valid` alone is not enough — an unsigned artifact can still be "valid".
- **URL schemes are allowlisted.** Manifest `urls` travel over a
  sender-controlled channel, so fetches are restricted to `https:` by
  default (`allowedUrlSchemes`) as an SSRF guard — widen deliberately, or
  inject `fetchImpl` for tests. Downloads are also capped at 100 MiB
  (`maxBytes`) by default.
- **Mirrors are tried in order and each one must match size AND digest** —
  a mirror serving the wrong bytes is skipped with a recorded reason, not
  trusted. Only when *all* mirrors fail do you get a throw (with every
  failure listed).
- **ICE is gathered up front, not trickled.** Animated-QR transport moves
  one bounded artifact at a time — a poor fit for trickle ICE — so
  `gatherIceCandidates` waits for gathering to finish (or a timeout) and
  packs a self-contained, single-shot payload.
- **BitTorrent/content-addressed bootstrap is not implemented.** The
  pattern generalizes to it; the code doesn't exist.

## API surface

| Area | Exports |
| --- | --- |
| Release manifests | `buildReleaseManifestArtifact`, `extractReleaseManifest`, `fetchAndVerifyReleaseArtifact`, `fetchAndVerifyManifest`, `serializeManifest`/`deserializeManifest`, `ReleaseManifest`, `RELEASE_MANIFEST_MEDIA_TYPE` |
| WebRTC | `createOfferArtifact`, `createAnswerArtifact`, `applyAnswerArtifact`, `extractWebrtcBootstrapPayload`, `gatherIceCandidates`, `WEBRTC_BOOTSTRAP_MEDIA_TYPE` |
| Gate | `assertVerified`, `BootstrapVerification` — the shared "affirmatively verified signature or refuse" check |

A fully headless, runnable version of the manifest flow lives in the repo at
`examples/04-bootstrap-manifest.mjs`.

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — see the
[advanced](https://opensource.johnhenry.me/oat/advanced/) and
[security model](https://opensource.johnhenry.me/oat/security/) pages.

## License

MIT
