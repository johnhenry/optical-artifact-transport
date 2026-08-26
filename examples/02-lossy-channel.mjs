// 02 — Loss, duplication, reordering, corruption: injection and recovery.
//
// @johnhenry/oat-sim's whole point: the exact optical pipeline, no camera or
// display, with an impairment-injecting channel in the middle. Every random
// decision derives from `seed`, so each scenario below is a reproducible
// test vector, not a flake.
//
// Run: npm run build && node examples/02-lossy-channel.mjs

import { simulateTransport } from '@johnhenry/oat-sim';
import assert from 'node:assert/strict';

const payload = new TextEncoder().encode(
  'A payload big enough to need many QR frames. '.repeat(60)
);
const artifact = { mediaType: 'application/octet-stream', payload };

// --- 1. Realistic bad link: 30% loss, duplicates, reordering ---------------

const rough = await simulateTransport({
  artifact,
  seed: 42,
  impairments: { lossRate: 0.3, duplicateRate: 0.1, reorderWindow: 8 }
});
assert.equal(rough.delivered, true, 'recovers despite 30% loss');
console.log(
  `rough channel: delivered=${rough.delivered} — ` +
    `${rough.packetsSent} sent, ${rough.packetsSurvivedChannel} survived, ` +
    `${rough.packetsConsumedByReceiver} consumed by receiver`
);

// --- 2. Late join: receiver misses the first 50 packets entirely -----------

// Fountain packets are independently decodable — there is no "frame 1" the
// receiver must catch. Joining mid-stream just works.
const late = await simulateTransport({ artifact, seed: 7, lateJoinOffset: 50 });
assert.equal(late.delivered, true, 'late-joining receiver still completes');
console.log(`late join: delivered=${late.delivered} after skipping the first 50 packets`);

// --- 3. Extreme loss: fails gracefully, not by hanging ---------------------

// delivered:false is a result, not an error — the sender's frameBudget caps
// how long it tries.
const hopeless = await simulateTransport({
  artifact,
  seed: 3,
  frameBudget: 40,
  impairments: { lossRate: 0.97 }
});
assert.equal(hopeless.delivered, false, '97% loss within a 40-frame budget cannot complete');
assert.ok(hopeless.decoderProgress < 1);
console.log(
  `extreme loss: delivered=${hopeless.delivered}, ` +
    `decoder stalled at ${(hopeless.decoderProgress * 100).toFixed(0)}%`
);

// --- 4. Corruption: verification catches what FEC cannot -------------------

// Bit-flipped packets can survive XOR reassembly and yield a complete but
// WRONG artifact. The invariant: never both "delivered" and a bad digest —
// corrupted reconstructions are caught by verification, not silently
// delivered.
const corrupted = await simulateTransport({
  artifact,
  seed: 99,
  frameBudget: 800,
  impairments: { corruptionRate: 0.5 }
});
if (corrupted.verification) {
  assert.equal(
    corrupted.delivered,
    corrupted.verification.valid,
    'delivery is gated on verification'
  );
  if (!corrupted.verification.digestValid) {
    assert.equal(corrupted.delivered, false, 'digest mismatch is never delivered');
  }
}
console.log(
  `50% corruption: delivered=${corrupted.delivered}` +
    (corrupted.verification ? ` (verification reasons: [${corrupted.verification.reasons}])` : ' (never reconstructed)')
);

console.log('lossy channel scenarios OK');
