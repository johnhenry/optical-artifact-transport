# @johnhenry/oat-protocol

The wire and trust layer under every other OAT package: the artifact
envelope, canonical CBOR encoding, SHA-256 digests, Ed25519 signatures, the
capability model, the UI proposal grammar, M6 sandbox eligibility, and the
`ui.decision` acknowledgment type. If two OAT endpoints agree on anything,
it's defined here.

```sh
npm install @johnhenry/oat-protocol
```

## Quick start

```js
import {
  buildArtifact,
  verifyArtifact,
  extractPayload,
  generateSigningKey
} from '@johnhenry/oat-protocol';

const { publicKey, secretKey } = generateSigningKey();

const artifact = await buildArtifact({
  mediaType: 'text/plain',
  payload: new TextEncoder().encode('signed state, ready to travel'),
  sign: { secretKey, keyId: 'my-key' }
});

// On the other end:
const verification = verifyArtifact(artifact, { requireSignature: true });
if (verification.valid) {
  const bytes = await extractPayload(artifact); // decompresses if needed
}
```

`verifyArtifact` never throws — a malformed or tampered artifact fails with
machine-readable `reasons` (`'digest-mismatch'`, `'signature-invalid'`,
`'signature-required'`, `'expired'`).

## The traps

- **A valid signature is not identity.** The signature carries the signer's
  public key inline, so there's no separate key-exchange step — but that
  also means *anyone* can produce a validly-signed artifact. `signatureValid:
  true` proves the bytes weren't tampered with, not that you should trust
  the sender. Trust lists live in `@johnhenry/oat-receiver`
  (`trustedPublicKeys`), not here.
- **`valid: true` does not imply a signature exists.** An unsigned artifact
  with a good digest is "valid" unless you pass `requireSignature: true` —
  `signatureValid` is `'absent'` in that case, not `false`. Anything
  security-sensitive should check `signatureValid === true` explicitly.
- **The signature covers the digest too.** It's computed over the canonical
  CBOR encoding of every field except `signature` itself, so payload and
  digest can't be swapped together without invalidating it.
- **`extractUiDecision` refuses unsigned artifacts.** A `ui.decision` claims
  capabilities were granted — an unsigned one is worthless as an audit
  record, so extraction requires an affirmatively verified signature.

## API surface

| Area | Exports |
| --- | --- |
| Envelope | `buildArtifact`, `verifyArtifact`, `extractPayload`, `isOatArtifact`, `OatArtifact`, `VerificationResult` |
| Encoding | `encodeCanonical`, `decodeCanonical` (canonical CBOR — deterministic bytes for signing) |
| Crypto | `generateSigningKey`, `signPayload`, `verifySignature`, `computeDigest`, `verifyDigest`, `constantTimeEqual` |
| Ids | `randomId` — a v4 UUID via `crypto.randomUUID()` where it exists, via `crypto.getRandomValues()` where it does not |
| Compression | `compress`, `decompress` (`'none'` \| `'gzip'`) |
| Capabilities | `WELL_KNOWN_CAPABILITIES`, `intersectCapabilities`, `createCapabilityPolicy`, `CapabilityPolicy`, `CapabilityGrant` |
| UI proposals | `UiProposalEnvelope`, `UiViewDescriptor` (`text`/`form`/`media`/`safe-html`/`sandboxed-html`), `SanitizationProfile` |
| Decisions | `buildUiDecisionArtifact`, `extractUiDecision`, `UiDecision`, `UI_DECISION_MEDIA_TYPE` |
| M6 gate | `checkSandboxEligibility` — requires a verified signature AND an explicitly trusted sender AND a receiver `allowUnsafeHtml` opt-in, or it reports ineligible |

Capability arithmetic is always the same intersection:

```
effective = sender requested ∩ receiver policy ∩ user-approved grants
```

Rendering is never authority — declarative actions carry typed,
receiver-mediated requests, never remote code or DOM handles.

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — the
[protocol page](https://opensource.johnhenry.me/oat/protocol/) covers this
package; the repo's `docs/design.md` is the full design doc.

## License

MIT
