// 01 — Encode/decode round trip, no camera or display involved.
//
// Walks the full pipeline by hand: build an artifact envelope
// (@johnhenry/oat-protocol), fountain-encode it into independently-decodable
// packets, decode from a packet stream, verify, and extract the payload
// (@johnhenry/oat-qr-fountain does the FEC; QR rendering is skipped — the
// packets here are exactly what would be drawn into QR frames).
//
// Run: npm run build && node examples/01-round-trip.mjs

import {
  buildArtifact,
  verifyArtifact,
  extractPayload,
  encodeCanonical,
  decodeCanonical,
  isOatArtifact,
  computeDigest
} from '@johnhenry/oat-protocol';
import {
  prepareSource,
  generatePackets,
  counterSeeds,
  FountainDecoder
} from '@johnhenry/oat-qr-fountain';
import assert from 'node:assert/strict';

// --- Sender side -----------------------------------------------------------

const original = new TextEncoder().encode(
  'Signed task state and continuation metadata for an agent handoff. '.repeat(30)
);

const artifact = await buildArtifact({
  mediaType: 'application/octet-stream',
  payload: original
});

// The envelope travels as canonical CBOR — deterministic bytes, so digests
// and signatures are stable.
const envelopeBytes = encodeCanonical(artifact);
console.log(`artifact ${artifact.id}: ${original.length} payload bytes, ${envelopeBytes.length} envelope bytes`);

// Split into fixed-size source blocks; 128 bytes is the simulator default.
// The 16-byte artifactId ties packets to this transfer session.
const artifactId = computeDigest(new TextEncoder().encode(artifact.id)).value.slice(0, 16);
const source = prepareSource(envelopeBytes, 128, artifactId);
console.log(`fountain source: ${source.sourceBlockCount} blocks of ${source.blockSize} bytes`);

// --- The "channel" ---------------------------------------------------------

// generatePackets is an INFINITE generator — a real sender cycles frames
// until stopped. The receiver just consumes until its decoder completes.
const packets = generatePackets(source, counterSeeds());

// --- Receiver side ---------------------------------------------------------

const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);
let consumed = 0;
for (const packet of packets) {
  consumed++;
  if (decoder.addPacket(packet)) break; // true once the transfer is complete
}
console.log(
  `decoded after ${consumed} packets ` +
    `(${((consumed / source.sourceBlockCount - 1) * 100).toFixed(0)}% fountain overhead)`
);

const reconstructedBytes = decoder.reconstruct();
const decoded = decodeCanonical(reconstructedBytes);
assert.ok(isOatArtifact(decoded), 'reconstructed bytes decode back to an OatArtifact');

// Reconstruction gives bytes, not trust — verification is a separate,
// mandatory step before anything is delivered.
const verification = verifyArtifact(decoded);
assert.equal(verification.valid, true, 'digest verifies');

const payload = await extractPayload(decoded);
assert.deepEqual(payload, original, 'payload survives the round trip byte-for-byte');

console.log('round trip OK: reconstructed, verified, payload identical');
