# @johnhenry/oat-qr-fountain

LT (Luby Transform) fountain coding plus QR frame render/decode — the wire
format underneath `<optical-send>` and `<optical-receive>`. An artifact
becomes an endless stream of independently-decodable packets: the receiver
doesn't need every frame, or frames in order, just *enough* of them. That's
what makes the optical link tolerant of a shaky camera, glare, and missed
frames.

```sh
npm install @johnhenry/oat-qr-fountain
```

## Quick start (pure fountain round trip, no QR involved)

```js
import {
  prepareSource,
  generatePackets,
  counterSeeds,
  FountainDecoder
} from '@johnhenry/oat-qr-fountain';

const bytes = new TextEncoder().encode('some artifact bytes'.repeat(50));
const artifactId = new Uint8Array(16); // 16 bytes identifying this session

const source = prepareSource(bytes, 128, artifactId); // 128-byte blocks
const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);

for (const packet of generatePackets(source, counterSeeds())) {
  if (decoder.addPacket(packet)) break; // true once the transfer completes
}

const reconstructed = decoder.reconstruct();
```

`generatePackets` is an **infinite** generator — it never runs out. Loop
until the decoder reports complete (or your own frame budget runs out), not
until the generator does, because it won't.

## The traps

- **This layer verifies nothing.** Reconstruction gives you bytes, not
  trust. A corrupted packet that slips through XOR reassembly produces a
  corrupted reconstruction — it's `@johnhenry/oat-protocol`'s digest and
  signature verification that catches it. Never treat `reconstruct()`
  output as verified.
- **`artifactId` must be exactly 16 bytes** — `encodePacket` throws
  otherwise.
- **Duplicates and foreign packets are cheap, mismatched sessions are not.**
  The decoder silently ignores duplicate seeds, but `addPacket` *throws* on
  a packet whose `sourceBlockCount`/`blockSize` don't match the session —
  catch it if you're feeding frames from a channel that can interleave
  transfers.
- **Smaller blocks tolerate more loss but need more frames.** `blockSize`
  is the loss-resilience/throughput dial; the reference elements use
  ~200-byte QR frames and land around 700 KB/min at 12fps after the ~30%
  redundancy the fountain code adds.
- **Randomness must agree.** Encoder and decoder derive each packet's
  neighbor set from the packet's `seed` via the same PRNG (`mulberry32`) —
  pass `counterSeeds()` (or any deterministic seed source) to
  `generatePackets` for reproducible fixtures.

## API surface

| Area | Exports |
| --- | --- |
| Fountain coding | `prepareSource`, `generatePackets`, `counterSeeds`, `FountainDecoder` (`addPacket`, `isComplete`, `progress`, `packetsSeen`, `reconstruct`) |
| Packet framing | `OatPacket`, `encodePacket`, `decodePacket` (compact fixed-header binary — `decodePacket` returns `null` for malformed/foreign frames rather than throwing) |
| QR rendering | `renderPacketToCanvas`, `renderPacketToDataUrl`, `PacketCycle` (frame scheduler), `decodePacketFromImageData` |
| LT internals | `mulberry32`, `robustSolitonTable`, `sampleDegree`, `chooseNeighbors`, `neighborsForSeed`, `xorInPlace` |

Most applications never touch this package directly — `<optical-send>` /
`<optical-receive>` (and `@johnhenry/oat-sim` for headless testing) wrap
it. Reach for it directly when building a custom transport or codec on the
same FEC layer.

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — see the
[protocol & codecs page](https://opensource.johnhenry.me/oat/protocol/).

## License

MIT
