# @johnhenry/oat-sim

The transport simulator: runs a full sender → channel → receiver OAT
transfer purely in software — no camera, no display, no canvas. That's the
whole point: it exercises the exact same `@johnhenry/oat-protocol` +
`@johnhenry/oat-qr-fountain` pipeline the custom elements use, with
deliberate loss, duplication, reordering, and corruption injection, so you
can test how your app behaves over a bad optical link in CI without ever
pointing a camera at a screen.

```sh
npm install @johnhenry/oat-sim
```

## Quick start

```js
import { simulateTransport } from '@johnhenry/oat-sim';

const result = await simulateTransport({
  artifact: {
    mediaType: 'application/octet-stream',
    payload: new TextEncoder().encode('state worth moving'.repeat(40))
  },
  seed: 42, // same seed => same outcome, always
  impairments: { lossRate: 0.3, duplicateRate: 0.1, reorderWindow: 8 }
});

result.delivered;             // true — recovered despite 30% loss
result.packetsSent;           // sender frames emitted (up to frameBudget)
result.verification?.valid;   // digest (and signature, if any) checked
result.reconstructedArtifact; // the full OatArtifact, or null
```

## The knobs

| Option | What it injects |
| --- | --- |
| `impairments.lossRate` | Probability in [0,1] each packet is dropped entirely |
| `impairments.duplicateRate` | Probability each surviving packet is delivered twice |
| `impairments.corruptionRate` | Probability a packet's payload gets bit-flipped |
| `impairments.reorderWindow` | Packets are shuffled within windows of this size |
| `lateJoinOffset` | Receiver misses the first N packets (joined mid-stream) |
| `frameBudget` | Max packets the sender emits before giving up (default 500) |
| `blockSize` | Fountain block size — smaller tolerates more loss, needs more frames (default 128) |
| `seed` | Seeds *all* randomness — artifact encoding, channel, everything |
| `requireSignature` | Receiver-side: unsigned artifacts fail verification |

## The traps

- **`delivered: false` is a result, not an error.** Under extreme loss the
  decoder simply never completes within `frameBudget` — assert on
  `delivered` and `decoderProgress`, don't wrap in try/catch.
- **Corruption is where verification earns its keep.** A bit-flipped packet
  can survive FEC reassembly and produce a complete-but-wrong artifact.
  `simulateTransport` runs digest/signature verification on the result and
  only reports `delivered: true` when it passes — the invariant to test is
  "never both delivered and digest-mismatch", not "corruption always fails".
- **Same seed, same outcome.** Every random decision (packet seeds, channel
  impairments) derives from `seed`, so a failing configuration is a
  reproducible test vector, not a flake. Two runs with identical options
  are byte-identical in behavior.
- **`artifact` takes `BuildArtifactOptions`, not a built artifact** —
  `mediaType`, `payload`, optional `sign`/`uiProposal`/`compression` — the
  simulator builds it for you so the encode path is covered too.

## API surface

- `simulateTransport(options): Promise<SimulateTransportResult>` — the main
  entry point; result fields: `delivered`, `packetsSent`,
  `packetsSurvivedChannel`, `packetsConsumedByReceiver`, `decoderProgress`,
  `verification`, `reconstructedArtifact`.
- `applyImpairments(packets, config, rand)` — the channel model on its own,
  if you're driving the fountain encoder/decoder yourself.
- `ImpairmentConfig`, `SimulateTransportOptions`, `SimulateTransportResult`.

Runnable versions of all of this live in the repo's `examples/` directory
(`02-lossy-channel.mjs`, `03-signed-verify-reject.mjs`).

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — see the
[advanced page](https://opensource.johnhenry.me/oat/advanced/).

## License

MIT
