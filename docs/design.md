> Source: extracted from a Perplexity design conversation
> (https://www.perplexity.ai/search/0ca468ee-3a1b-421e-80a2-e4bd29c847fc),
> 2026-08-09. This is the concluded PRD this repo implements against
> (scoped to M0–M4; see README.md).

## Project résumé: Optical Artifact Transport

**Working name:** Optical Artifact Transport (OAT)  
**Primary web API:** `<optical-send>` and `<optical-receive>`  
**Category:** Browser-native, screen-to-camera, local-first artifact transport and capability-negotiated interaction runtime.

The project turns a screen and camera into a low-bandwidth but universally available transport for structured payloads larger than a normal QR code. It uses animated optical symbols—initially fountain-coded QR frames—to move artifacts without requiring pairing, shared Wi‑Fi, Bluetooth, an account, cloud storage, or a preexisting network path. Fountain coding is particularly suitable because a receiver may start at any frame and recover despite dropped frames.[1]

## Problem

Static QR codes are excellent for small URLs, tokens, and compact state, but their binary capacity is limited. Existing device-transfer systems are fast but often require radios, discovery, authentication, network policy compliance, native platform integration, or user trust in a local-network relationship.

OAT targets the gap:

> **Payloads too large for one QR code, where a few seconds or minutes is acceptable, but zero-setup handoff, physical locality, air-gap compatibility, auditability, or trust bootstrapping matter more than throughput.**

The transport is not intended to replace AirDrop, Nearby Share, USB, or ordinary HTTPS. It is a **physical control plane** and a low-friction fallback transport.

## Product thesis

The valuable primitive is not “animated QR file transfer.” It is:

> **A portable, signed, optionally encrypted artifact that can cross a physical display-camera boundary and can optionally propose a constrained interaction model to the receiving application.**

This enables three distinct flows:

1. **Optical transfer:** move the actual small-to-medium artifact.
2. **Optical bootstrap:** move an artifact descriptor that unlocks a faster follow-up transport, such as WebRTC signaling, BitTorrent metainfo, IPFS/CID metadata, LAN endpoints, or verified HTTPS mirrors.
3. **Optical interaction handoff:** move state plus a sender-proposed, receiver-mediated UI for approval, continuation, configuration, or structured data entry.

## Target users

- Developer-tool builders and CLI/platform teams.
- AI-agent application developers.
- Security-sensitive and air-gapped workflows.
- Source-control, deployment, and release-management products.
- Chat, research, search, and multi-device continuity products.
- Kiosk, meeting-room, lab, industrial, and enterprise-device workflows.
- Wallet, credential, attestation, and content-addressed artifact systems.

## Core use cases

| Use case | Optical payload | Follow-on behavior |
|---|---|---|
| GitHub review handoff | Repository, PR, commit, policy, signed review state | Open exact review context on phone or second workstation |
| Agent/session continuation | Conversation state, plan, artifact references, scoped continuation token | Resume, fork, or inspect a task elsewhere |
| Release bootstrap | Signed manifest, hashes, mirrors, torrent metadata | Fetch a large build via normal network paths |
| Air-gapped approval | Commit hash, deployment manifest, attestation, approval request | Human verifies and grants or denies scope |
| Search continuity | Query, filters, result selection, citations, reading state | Reopen the research session on another device |
| Kiosk/room broadcast | Current venue, meeting, document, or local service state | Nearby devices join context without onboarding |
| Offline structured exchange | Configuration pack, encrypted note, typed JSON, signed capability | Receiver imports after verification |

Blockchain Commons’ animated QR work demonstrates the relevant use of multipart QR and fountain coding for air-gapped, interoperability-oriented structured data exchange.[1]

## Product surfaces

### `<optical-send>`

A declarative sender element that accepts finite blobs, URLs, structured artifacts, `ReadableStream`s, or async iterables and emits a sequence of optical frames.

```html
<optical-send
  src="/handoffs/repo-review.cbor"
  type="application/vnd.oat.artifact+cbor"
  codec="qr-fountain"
  verify="signature"
  frame-rate="18"
  adaptive
  controls>
</optical-send>
```

Responsibilities:
- Acquire source bytes.
- Build a canonical artifact envelope.
- Compress, encrypt, sign, and hash where requested.
- Packetize and fountain-encode the artifact.
- Render animated QR frames or another selected optical codec.
- Display controls, transfer metadata, and a static inspectable manifest.
- Report lifecycle and transport telemetry.

### `<optical-receive>`

A receiver/runtime element that captures camera input, decodes frames, reconstructs artifacts, verifies integrity, applies policy, and delivers safe results to the host app.

```html
<optical-receive
  accept="application/vnd.oat.artifact+cbor,application/json"
  codec="qr-fountain"
  camera="environment"
  verify="signature"
  ui-policy="safe"
  require-signature
  controls>
</optical-receive>
```

Responsibilities:
- Request and manage camera access.
- Decode QR or other supported visual symbols.
- Deduplicate, reorder, and recover packets.
- Reassemble the artifact.
- Verify hash, signature, expiration, and sender identity.
- Apply artifact, capability, and UI-rendering policy.
- Expose result data as `Blob`, stream, structured object, or receiver event.

## Architecture

```text
Source: Blob | URL | ReadableStream | AsyncIterable | structured artifact
                              |
                              v
                    Artifact envelope
     metadata | compression | encryption | signatures | expiry
                              |
                              v
                   Framing + FEC encoder
                              |
                              v
              Optical codec: qr-fountain initially
                              |
                              v
                    Display frame scheduler
                              |
                     screen -> camera
                              |
                              v
        Camera decode -> packet store -> FEC reassembly
                              |
                              v
            verification -> policy -> app/UI delivery
```

The artifact envelope and capability model are stable platform layers. QR is only the first physical codec. Future codecs may include `ur-fountain`, custom dense grids, low-salience display-camera modulation, or hybrid bootstrap symbols.

## Transport protocol

### Artifact envelope

The recommended base format is canonical CBOR for compactness and deterministic signing.

```ts
interface OatArtifact {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt?: string;

  mediaType: string;
  payload: Uint8Array;

  compression?: 'none' | 'gzip' | 'brotli' | 'zstd';

  digest: {
    algorithm: 'sha256' | 'blake3';
    value: Uint8Array;
  };

  signature?: {
    algorithm: 'ed25519';
    keyId?: string;
    publicKey: Uint8Array;
    value: Uint8Array;
  };

  encryption?: {
    scheme: string;
    recipientHint?: string;
    keyEnvelope: Uint8Array;
  };

  uiProposal?: UiProposalEnvelope;
  metadata?: Record<string, unknown>;
}
```

### Packet framing

Each frame should be independently decodable and include enough metadata for late joining, duplicate suppression, and loss recovery.

```ts
interface OatPacket {
  version: 1;
  artifactId: Uint8Array;
  codec: 'qr-fountain';
  fecScheme: 'lt';
  blockId: Uint8Array;
  sequenceHint?: number;
  payload: Uint8Array;
}
```

The receiver does not need every frame or every numbered chunk. It collects sufficient independent fountain packets and reconstructs the original artifact, which is why the system tolerates missed frames, glare, focus changes, and late scanning.[1]

## Sender authoring model

The sender uses standard HTML slots as a **local authoring convenience**, not as a wire-format primitive. Slots let an embedding app provide markup into component-defined named locations; the sender resolves those templates locally and serializes a portable proposal artifact.[2][3]

```html
<optical-send
  src="/handoffs/agent-state.cbor"
  codec="qr-fountain"
  ui-mode="safe-html"
  ui-sanitize="forms"
  verify="signature"
  controls>

  <template slot="manifest">
    <article>
      <h2>Agent handoff</h2>
      <p>Signed task state and continuation metadata.</p>
    </article>
  </template>

  <template slot="proposal">
    <form data-optical-form="agent-import">
      <h1>Import agent handoff</h1>

      <p>
        The handoff contains task state, a plan, artifact references,
        and a scoped continuation token.
      </p>

      <label>
        Import mode
        <select name="mode" data-optical-field>
          <option value="preview">Preview only</option>
          <option value="resume">Resume task</option>
          <option value="fork">Fork task</option>
        </select>
      </label>

      <button
        type="submit"
        data-optical-action="submit"
        data-optical-capability="agent.session.import">
        Continue
      </button>

      <button type="button" data-optical-action="reject">
        Cancel
      </button>
    </form>
  </template>

  <template slot="fallback">
    <p>Import a signed agent-session handoff?</p>
  </template>
</optical-send>
```

The `proposal` fragment is canonicalized, sanitized preflight, represented as a `ui.proposal` envelope, signed as part of the artifact, and transmitted. Sender-side slots are never shipped as Shadow DOM semantics.

## Receiver UI model

The receiver owns all rendering. A sender can propose a view, but the receiver selects one of four outcomes:

```text
Reject
  -> show local rejection state or fallback

Downgrade
  -> show sender fallback or a locally rendered safe view

Accept safe
  -> render a receiver-sanitized declarative UI

Accept unsafe
  -> load raw HTML in a visible isolated sandbox
```

This direction has direct precedent in A2A, which supports negotiation of interaction modalities and UI capabilities such as web forms, video, and iframe-style embeds.[4][5][6]

MCP provides a complementary model: servers request structured user input through elicitation, while the client retains control over user interaction, data sharing, validation, and consent. MCP also prohibits in-band form elicitation for sensitive credentials, favoring out-of-band URL flows for those cases.[7][8][9]

## Remote UI proposal

```ts
interface UiProposalEnvelope {
  type: 'ui.proposal';
  version: 1;
  proposalId: string;

  origin: {
    id: string;
    label?: string;
    publicKey?: Uint8Array;
    signature?: Uint8Array;
  };

  title: string;
  summary?: string;

  preferredView: UiViewDescriptor;
  fallbackView: UiViewDescriptor;

  requestedCapabilities: CapabilityRequest[];
  requestedProfile: 'safe-view' | 'safe-html' | 'sandboxed-html' | 'trusted-html';

  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
```

### Safe view descriptors

```ts
type UiViewDescriptor =
  | TextView
  | FormView
  | MediaView
  | SafeHtmlView
  | SandboxedHtmlView;

interface FormView {
  kind: 'form';
  title?: string;
  schema: Record<string, unknown>;
  submitAction: string;
  submitLabel?: string;
  cancelLabel?: string;
}
```

The receiver can render `FormView` in native app components, a design system, React, native mobile UI, or DOM elements. The sender describes intent and schema; it does not control the receiver’s DOM or execute code.

## Capability model

A remote UI proposal must request granular capabilities. Rendering is not authority.

```text
ui.render.text
ui.render.form.basic
ui.render.media.safe
ui.action.submit
ui.open.external
ui.embed.iframe
ui.render.html.unsafe

html.script
html.network
html.storage
html.popup
html.download
html.fullscreen

local.tool.git.review.read
local.tool.git.merge.request
local.tool.agent.session.import
local.data.session.read
artifact.manifest.import
```

Every grant has:
- Scope: action, proposal, session, sender identity, or enterprise policy.
- Lifetime: one-shot, session-bound, expiry-bound, or persisted policy.
- Audience: one sender identity or a verified trust group.
- Audit behavior: none, local event, durable receipt.
- Consent level: auto, prompt, administrator-only, or denied.

The receiver always computes:

```text
effective capabilities =
  sender requested capabilities
  intersect receiver policy
  intersect user-approved grants
```

## Sanitization profiles

The sender may request a profile; the receiver selects the effective profile.

| Profile | Typical allowed content | Must reject or remove |
|---|---|---|
| `text-only` | Text, headings, lists, code | Links, media, forms, styles |
| `strict` | Semantic HTML, safe links | Script, event handlers, styles, forms, embeds |
| `rich-text` | Tables, formatting, constrained images | Scripts, external CSS, forms, unsafe URLs |
| `forms` | Strict plus bounded typed controls | Form actions, targets, scripts, autofill abuse |
| `media` | Rich text plus selected image/video sources | Iframes, arbitrary embeds, broad network fetch |
| `custom` | Receiver-defined allowlist | Everything not explicitly permitted |

The receiver should use the platform HTML Sanitizer API where available, such as `Element.setHTML()`, which is intended as an XSS-safe parse-and-sanitize insertion mechanism; applications should use a pinned sanitizer fallback and Trusted Types/CSP enforcement where browser support requires it.[10][11][12]

Safe-mode rendering must remove:
- `<script>`, `<iframe>`, `<object>`, `<embed>`, `<base>`.
- Event attributes such as `onclick` and `onload`.
- `javascript:` URLs and non-allowlisted schemes.
- External stylesheets and unbounded inline styling.
- Form `action`, `method`, `target`, implicit submission behavior.
- Dangerous SVG/MathML constructs unless explicitly supported.

## Declarative actions

Safe HTML and structured forms cannot run sender JavaScript. They use attributes interpreted by receiver-owned code:

```html
<button
  type="button"
  data-optical-action="approve"
  data-optical-capability="local.tool.git.review.read">
  Approve read-only handoff
</button>
```

The receiver translates that into a typed action request:

```ts
interface UiActionRequest {
  proposalId: string;
  action: 'approve' | 'reject' | 'submit' | 'open-external';
  capability?: string;
  data?: Record<string, unknown>;
}
```

The receiver checks policy, asks the user if necessary, and returns a structured result. No remote DOM handle, local API handle, or executable callback crosses the trust boundary.

## Unsafe HTML profile

Raw remote HTML is allowed only as a **break-glass rendering mode**. It is never the default, never silently accepted, and never equivalent to a trusted local interface.

Eligibility requirements:
- Sender identity verified.
- Proposal and HTML content signed.
- Explicit receiver policy allows it.
- User performs a high-visibility opt-in.
- Receiver shows a persistent unsafe-mode indicator.
- A one-click “return to safe rendering” and “kill remote UI” control exists.
- Every host capability remains independently mediated.

Rendering architecture:

```text
Remote HTML
  -> receiver validates signature and policy
  -> receiver creates isolated iframe
  -> iframe receives strict CSP + sandbox
  -> iframe sends typed postMessage requests
  -> receiver policy engine validates each request
  -> user approves sensitive actions
```

Baseline iframe:

```html
<iframe
  sandbox="allow-scripts"
  referrerpolicy="no-referrer"
  allow=""
  srcdoc="<!-- signed, policy-accepted remote document -->">
</iframe>
```

The baseline must not grant `allow-same-origin`, `allow-forms`, `allow-popups`, `allow-downloads`, `allow-top-navigation`, or ambient storage. `srcdoc` can run arbitrary markup by default, so using it without a sandbox and strict injection controls is unsafe.[13]

## Typed iframe bridge

```ts
type RemoteUiRequest =
  | { type: 'ui.ready' }
  | { type: 'ui.resize'; height: number }
  | { type: 'request.capability'; capability: string; reason: string }
  | { type: 'request.action'; action: string; payload?: unknown }
  | { type: 'submit.form'; payload: Record<string, unknown> };

type ReceiverUiResponse =
  | { type: 'policy'; grantedCapabilities: string[] }
  | { type: 'capability.result'; capability: string; allowed: boolean }
  | { type: 'action.result'; requestId: string; status: 'allowed' | 'denied' }
  | { type: 'error'; code: string; message: string };
```

All messages require schema validation, proposal/session binding, rate limiting, and origin/policy checks. Unknown message types are rejected.

## Web Component extension points

### Slots

Slots are local component-composition APIs:

```html
<optical-send>
  <template slot="manifest"></template>
  <template slot="proposal"></template>
  <template slot="fallback"></template>
  <template slot="empty"></template>
</optical-send>

<optical-receive>
  <section slot="empty"></section>
  <section slot="scanning"></section>
  <section slot="verifying"></section>
  <section slot="complete"></section>
  <section slot="rejected"></section>
  <section slot="error"></section>
</optical-receive>
```

Slots are not transmitted and are not security boundaries. They are resolved at the sender/receiver host before transport or rendering.[3][2]

### Parts

Parts expose intentional styling seams:

```css
optical-send::part(frame) { border-radius: 1rem; }
optical-send::part(progress) { accent-color: mediumseagreen; }

optical-receive::part(camera-preview) { outline: 2px solid cyan; }
optical-receive::part(trust-warning) { color: goldenrod; }
```

Suggested parts:

```text
shell
frame
qr-canvas
controls
progress
camera-preview
scanner-overlay
trust-panel
trust-warning
proposal-host
```

`::part()` is for styling selected elements inside a component shadow tree; it is not an authorization mechanism and should not be encoded in the transport artifact.[14][15]

## Browser implementation plan

```text
packages/
  protocol/
    artifact.ts
    canonical-cbor.ts
    manifest.ts
    signatures.ts
    capabilities.ts
    ui-proposal.ts

  codecs/
    qr-fountain/
      encoder.ts
      decoder.ts
      packet.ts
      scheduler.ts
    ur-adapter/

  crypto/
    digest.ts
    ed25519.ts
    encryption.ts

  sender/
    source-adapters.ts
    artifact-builder.ts
    optical-send.ts

  receiver/
    camera-controller.ts
    decode-worker.ts
    packet-store.ts
    assembler.ts
    verifier.ts
    policy-engine.ts
    optical-receive.ts

  ui/
    safe-view-renderer.ts
    safe-html-renderer.ts
    sanitizer.ts
    sandbox-host.ts
    capability-prompt.ts

  examples/
    file-transfer/
    git-review/
    agent-handoff/
    webrtc-bootstrap/
    release-manifest/
```

The decode path should run in a Worker, ideally with WASM support for QR decoding, FEC recovery, CBOR parsing, and cryptographic verification. The host UI, permission prompts, and policy engine remain on the main thread.

## UX states

### Sender

```text
idle
preparing
manifest-ready
transmitting
paused
complete
error
```

### Receiver

```text
idle
permission-requested
camera-ready
discovering
receiving
recovering
verifying
artifact-ready
ui-proposed
awaiting-consent
accepted
downgraded
rejected
error
```

The receiver should distinguish:
- **decoded** — bytes reconstructed;
- **integrity verified** — digest matches;
- **identity verified** — signature/trust check succeeds;
- **capability approved** — user/policy granted an action;
- **unsafe mode active** — raw HTML sandbox running.

These must never be visually conflated.

## Security model

Primary threats:
- Opportunistic camera capture of visible payloads.
- Payload replay.
- Malicious packet injection.
- Malicious or misleading UI proposal.
- Script injection and DOM XSS.
- Capability confusion.
- Sender impersonation.
- Remote UI social engineering.
- Resource exhaustion via huge artifacts, frames, forms, or decode workloads.

Core controls:
- Payload hashes and signatures.
- Expiry, nonce, and session binding.
- Maximum artifact size, packet count, frame rate, DOM node count, form depth, and decode CPU budget.
- Receiver-owned policy and sanitization.
- Explicit capability grant intersection.
- Strict safe-mode rendering.
- Sandbox/CSP/typed bridge in unsafe mode.
- User-visible sender identity, requested powers, and verification status.
- Durable audit events for sensitive grants.

MCP’s explicit consent and control principles are a strong design reference: users should understand data access and operations, hosts should seek consent before data exposure or tool invocation, and untrusted remote systems should not receive ambient authority.[8][16]

## Milestones

### M0 — Specification freeze

- Canonical artifact envelope.
- Version negotiation.
- FEC packet format.
- Capability registry.
- UI proposal grammar.
- Sanitization-profile registry.
- Full threat model.
- Golden test vectors.

### M1 — Transport simulator

- Encode/decode without camera hardware.
- Loss, duplication, reordering, corruption, and late-join simulation.
- Deterministic test vectors.
- Artifact digest/signature verification.

### M2 — Sender MVP

- `<optical-send>` with `Blob`, URL, and text sources.
- QR-fountain codec.
- Static manifest.
- Basic controls.
- Sender slots and parts.
- Progress and telemetry events.

### M3 — Receiver MVP

- `<optical-receive>` camera pipeline.
- Worker-based decode.
- Packet recovery.
- Hash verification.
- Safe artifact delivery.
- No remote UI beyond text fallback.

### M4 — Safe UI

- `safe-view` and `safe-html`.
- Receiver-selected sanitization profiles.
- Declarative forms/actions.
- Capability prompt and audit model.
- Fallback rendering.

### M5 — Bootstrap workflows

- Signed release-manifest import.
- WebRTC signaling exchange.
- BitTorrent/metainfo or content-addressed bootstrap.
- Git/agent handoff examples.

### M6 — Advanced isolation

- Sandboxed HTML profile.
- Typed iframe bridge.
- CSP and sandbox hardening.
- Signature-gated trusted profiles.
- Adversarial security testing.

## Success criteria

Technical:
- Receiver joins a stream at arbitrary time and recovers a valid artifact after expected overhead.
- Packet loss, duplication, reordering, and temporary decode failure do not corrupt verified output.
- Identical artifact verifies independently of codec frame order.
- Safe HTML cannot execute sender JavaScript or invoke receiver capabilities without an explicit grant.
- Unsafe HTML cannot access host resources except through typed, policy-checked messages.

Product:
- An app can add basic optical send in under ten lines of HTML.
- A user understands who sent an artifact, what it contains, whether it is verified, and what actions it requests.
- Session-handoff and bootstrap flows require less setup than traditional pairing/discovery.
- Developers can customize local UI without changing protocol semantics.

## One-sentence positioning

**Optical Artifact Transport is a browser-native, capability-safe physical transport for moving signed state, structured artifacts, and optionally negotiated UI across devices using only a display and camera.**

