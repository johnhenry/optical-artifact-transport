// 03 — Signed artifacts: verify end to end, reject tampering and the unsigned.
//
// Three things a receiver must be able to rely on, shown headless via
// @johnhenry/oat-sim and @johnhenry/oat-protocol:
//   1. a signed artifact survives the channel with its signature verifiable;
//   2. tampering with a delivered artifact is caught (and the signature binds
//      payload AND digest together, so they can't be swapped as a pair);
//   3. requireSignature rejects unsigned artifacts with a machine-readable
//      reason — "valid" alone never implies "signed".
//
// Run: npm run build && node examples/03-signed-verify-reject.mjs

import { generateSigningKey, verifyArtifact, computeDigest } from '@johnhenry/oat-protocol';
import { simulateTransport } from '@johnhenry/oat-sim';
import assert from 'node:assert/strict';

const payload = new TextEncoder().encode('capability grant: calendar.event.create '.repeat(20));
const { publicKey, secretKey } = generateSigningKey();

// --- 1. Signed, transported, verified --------------------------------------

const signedRun = await simulateTransport({
  artifact: {
    mediaType: 'application/octet-stream',
    payload,
    sign: { secretKey, keyId: 'example-key' }
  },
  seed: 5,
  requireSignature: true,
  impairments: { lossRate: 0.2 } // signature survives a lossy link too
});
assert.equal(signedRun.delivered, true);
assert.equal(signedRun.verification?.signatureValid, true);
console.log('signed artifact: delivered with signatureValid=true through a 20%-loss channel');

// The signature carries the signer's public key inline — no key-exchange
// step. But that means it only proves integrity, NOT identity: whether this
// key is one to trust is a separate decision (the receiver element's
// trustedPublicKeys list / TOFU flow).
const carried = signedRun.reconstructedArtifact.signature.publicKey;
assert.deepEqual(carried, publicKey, 'signer public key travels inside the artifact');

// --- 2. Tampering is caught ------------------------------------------------

const artifact = signedRun.reconstructedArtifact;

// Flip one payload byte: digest check fails.
const flipped = artifact.payload.slice();
flipped[0] ^= 0xff;
const tamperedPayload = verifyArtifact({ ...artifact, payload: flipped });
assert.equal(tamperedPayload.valid, false);
assert.ok(tamperedPayload.reasons.includes('digest-mismatch'));
console.log(`tampered payload: rejected (${tamperedPayload.reasons})`);

// Swap payload AND its matching digest together: digest now "matches", but
// the signature covers both fields, so it fails instead. There is no
// tampering order that wins.
const swapped = { ...artifact, payload: flipped, digest: computeDigest(flipped) };
const tamperedBoth = verifyArtifact(swapped);
assert.equal(tamperedBoth.digestValid, true, 'the recomputed digest matches the swapped payload...');
assert.equal(tamperedBoth.signatureValid, false, '...but the signature binds payload+digest');
assert.equal(tamperedBoth.valid, false);
console.log(`swapped payload+digest pair: rejected (${tamperedBoth.reasons})`);

// --- 3. Unsigned + requireSignature => rejected, with a reason -------------

const unsignedRun = await simulateTransport({
  artifact: { mediaType: 'application/octet-stream', payload },
  seed: 11,
  requireSignature: true
});
assert.equal(unsignedRun.delivered, false);
assert.ok(unsignedRun.verification.reasons.includes('signature-required'));
console.log(`unsigned artifact under requireSignature: rejected (${unsignedRun.verification.reasons})`);

// Note the asymmetry: WITHOUT requireSignature the same unsigned artifact is
// "valid" (signatureValid: 'absent', not false). Security-sensitive code
// must check signatureValid === true explicitly, not just valid.
// (The sim still hands back the reconstruction — rejection happened at
// verification, not decode.)
const lenient = verifyArtifact(unsignedRun.reconstructedArtifact);
assert.equal(lenient.valid, true);
assert.equal(lenient.signatureValid, 'absent');
console.log("same artifact without requireSignature: valid=true, signatureValid='absent' — the trap to remember");

console.log('signature verify/reject scenarios OK');
