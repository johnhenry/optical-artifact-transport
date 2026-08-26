# @johnhenry/oat-sender

`<optical-send>` — a custom element that builds a signed `OatArtifact` from
whatever you hand it and renders it as an endless, independently-decodable
sequence of fountain-coded QR frames for a camera on another device to pick
up.

```sh
npm install @johnhenry/oat-sender
```

## Quick start

```js
import { defineOpticalSend } from '@johnhenry/oat-sender';
defineOpticalSend(); // registers <optical-send>
```

```html
<optical-send id="sender" controls></optical-send>
```

```js
const sender = document.querySelector('#sender');
sender.source = 'hello from across the room'; // string, Blob, File, Uint8Array, ...
```

A `Blob`/`File` carries its own `type` into the artifact's `mediaType`
automatically. To sign (required for anything the receiver treats as
security-sensitive — bootstrap payloads, the M6 unsafe-HTML tier):

```js
import { generateSigningKey } from '@johnhenry/oat-protocol';

const { secretKey } = generateSigningKey();
sender.signingKey = { secretKey, keyId: 'demo-key' };
sender.source = file;
```

## The traps

- **Setting `.source` starts immediately.** There is no separate
  `.start()` call for a new payload — assigning `source` triggers
  `prepare()`, which encodes and begins transmitting. Set `signingKey` and
  `metadata` *before* `source`, or you'll transmit an unsigned artifact.
- **Transmission never ends on its own.** Fountain coding is rateless —
  frames cycle until you `pause()`/`stop()`. `framesSent` climbing past
  100% of the theoretical minimum is normal and is what makes lossy capture
  work.
- **Throughput is slower than you think.** Roughly 700 KB/min at 12fps over
  200-byte QR frames, after ~30% fountain redundancy. Design the UI around
  that number; nothing in this package caps payload size for you.
- **UI proposals are authored in light DOM but don't cross the wire as
  DOM.** `buildUiProposal` reads `<template slot="proposal">` /
  `<template slot="fallback">` children of the element and converts them
  into a portable, signable `UiProposalEnvelope` — the receiver re-renders
  (and sanitizes) on its own terms; your markup is a proposal, never an
  instruction.

## API surface

**Element** — states: `idle → preparing → manifest-ready → transmitting ⇄
paused → complete | error`.

| Member | Notes |
| --- | --- |
| `source` (set/get) | `Blob`, `File`, `Uint8Array`, `ArrayBuffer`, string, `ReadableStream`, or async iterable — setting it starts preparation |
| `signingKey` | `{ secretKey, keyId? }` (Ed25519, from `@johnhenry/oat-protocol`'s `generateSigningKey`) |
| `metadata` | Arbitrary record embedded in the artifact envelope |
| `frameRate`, `blockSize` | Read from attributes; frame pacing and fountain block size |
| `prepare()`, `sendArtifact(artifact)` | Build from `source`, or transmit an already-built artifact (how a `ui.decision` travels back) |
| `start()` / `pause()` / `stop()` / `toggle()` | Frame loop control |
| `state`, `artifact`, `framesSent` | Read-only introspection |

**Events**: `oat-state-change`, `oat-manifest-ready` (artifact built),
`oat-error` (check `e.detail.error`).

**Also exported**: `buildSenderArtifact`, `resolveSource` (the source
adapters), `buildUiProposal`, `defineOpticalSend(tagName?)`.

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — see the
[elements page](https://opensource.johnhenry.me/oat/elements/). The repo's
`examples/file-transfer` app wires this element against
`@johnhenry/oat-receiver` end to end.

## License

MIT
