# @johnhenry/oat-receiver

`<optical-receive>` — a custom element that points a camera at an
`<optical-send>` screen, fountain-decodes the frames into an artifact,
verifies its digest/signature/expiry, and runs any sender-proposed UI
through a policy engine you configure. It never delivers unverified bytes
to your app, and it never renders sender HTML itself (that's
`@johnhenry/oat-ui`'s job, downstream of this element's decisions).

```sh
npm install @johnhenry/oat-receiver
```

## Quick start

```js
import { defineOpticalReceive } from '@johnhenry/oat-receiver';
defineOpticalReceive(); // registers <optical-receive>
```

```html
<optical-receive id="receiver" controls ui-policy="safe"></optical-receive>
```

```js
const receiver = document.querySelector('#receiver');
receiver.addEventListener('oat-artifact', (e) => {
  // Only fires for a verified artifact: e.detail.artifact, e.detail.verification
});
receiver.addEventListener('oat-rejected', (e) => console.warn(e.detail.reasons));
await receiver.start(); // requests the camera
```

## Policy: the part you actually need to read

Every proposal lands in exactly one of four outcomes: **reject**,
**downgrade** (fall back to the plain view), **accept-safe** (sanitized,
receiver-rendered), or **accept-unsafe** (M6 break-glass). The knobs:

| Property | Effect |
| --- | --- |
| `ui-policy` (attribute) | `'safe'` (default) or `'none'` — `'none'` downgrades *every* proposal without evaluating it |
| `capabilityPolicy` | `CapabilityPolicy` allow/deny sets; effective grants are always `requested ∩ policy ∩ user-approved` |
| `autoApprove` | Capabilities granted with no user gesture — keep this list short; anything on it skips the prompt entirely |
| `requireSignatureFor` | Per-profile signature requirement (`'safe-view'`/`'safe-html'`/`'sandboxed-html'`), independent of the artifact-wide requirement |
| `approvalPolicy` | Per-profile consent UX: `'automatic'`, `'prompt'`, `'prompt-with-warning'` — non-automatic gates behind the `awaiting-consent` state until `confirmProposal()`/`dismissProposal()` |
| `trustedPublicKeys` | Hex Ed25519 keys — the *identity* list; a valid signature alone proves nothing about who signed |
| `requireExplicitTrust` | Kills the "empty trust list trusts any valid signature" default — unknown signers surface as `oat-unknown-sender` for `trustSenderAndContinue()`/`rejectUnknownSender()` |
| `allowUnsafeHtml` | The M6 opt-in. Defaults closed; inert unless the sender is *also* signed and on `trustedPublicKeys` |

## The traps

- **Set properties, not attributes.** Every policy input is a property
  setter that rebuilds the policy engine on write (`ui-policy` is the one
  observed attribute). Driving config through `setAttribute` for anything
  else is silently ignored.
- **`allowUnsafeHtml` alone does nothing.** M6 eligibility requires all
  three of: verified signature, signer on `trustedPublicKeys`, and this
  flag. Any one missing downgrades — it does not reject, because the
  artifact itself may be fine; only the requested *rendering* is refused.
- **`trustSenderAndContinue()` goes through the `trustedPublicKeys`
  setter** so the engine rebuild happens. If you extend the trust flow
  yourself, mutate via the setter, never the list directly — a stale engine
  once caused a newly-trusted sender's first M6 proposal to downgrade.
- **`checkCapability()` is meant to be re-checked at the point of use**
  (e.g. right before acting on a submitted form), not trusted from the
  original grant payload.

## API surface

**States**: `idle`, `permission-requested`, `camera-ready`, `receiving`,
`verifying`, `unknown-sender`, `accepted`, `ui-proposed`,
`unsafe-proposed`, `awaiting-consent`, `downgraded`, `rejected`, `error`.

**Events**: `oat-state-change`, `oat-artifact`, `oat-ui-proposal`,
`oat-consent-required`, `oat-unknown-sender`, `oat-rejected`, `oat-error`.

**Methods**: `start()`, `stop()`, `reset()`, `processFrame(imageData)`
(public precisely so the whole pipeline is testable with synthetic frames —
no camera), `approveCapabilities()`, `checkCapability()`,
`confirmProposal()`, `dismissProposal()`, `trustSenderAndContinue()`,
`rejectUnknownSender()`, `buildDecisionArtifact(sign?)` (the signed
`ui.decision` acknowledgment to send back).

**Also exported**: `PolicyEngine`, `verifyReceivedArtifact`, the camera
controller / decode worker / packet store / assembler internals, and
`defineOpticalReceive(tagName?)`.

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — the
[elements](https://opensource.johnhenry.me/oat/elements/) and
[security model](https://opensource.johnhenry.me/oat/security/) pages cover
this element in depth.

## License

MIT
