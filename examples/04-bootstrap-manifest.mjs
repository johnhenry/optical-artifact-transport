// 04 — Bootstrap: a small signed optical artifact unlocks a bigger transfer.
//
// The M5 release-manifest flow, fully headless: a signed manifest (names,
// sizes, digests, mirror URLs) travels over the simulated optical channel;
// the receiver verifies it, extracts it, and "downloads" the real bytes over
// a stubbed HTTPS fetch — digest-checked, with a lying mirror skipped.
// Along the way: the gate that makes this safe — extraction REFUSES anything
// without an affirmatively verified signature, because manifest URLs drive
// real outbound requests.
//
// Run: npm run build && node examples/04-bootstrap-manifest.mjs

import { generateSigningKey, verifyArtifact, computeDigest } from '@johnhenry/oat-protocol';
import {
  buildReleaseManifestArtifact,
  extractReleaseManifest,
  fetchAndVerifyReleaseArtifact,
  serializeManifest
} from '@johnhenry/oat-bootstrap';
import { simulateTransport } from '@johnhenry/oat-sim';
import assert from 'node:assert/strict';

// --- The release being distributed -----------------------------------------

const releaseBytes = new TextEncoder().encode('pretend this is a 100 MB installer '.repeat(100));
const { secretKey } = generateSigningKey();

const manifest = {
  version: 1,
  name: 'example-app',
  releaseId: '1.2.3',
  artifacts: [
    {
      name: 'example-app.tar.gz',
      mediaType: 'application/gzip',
      size: releaseBytes.length,
      digest: computeDigest(releaseBytes),
      // Tried in order — first mirror that responds AND verifies wins.
      urls: ['https://mirror-a.example/release.tar.gz', 'https://mirror-b.example/release.tar.gz']
    }
  ]
};

// --- Sender: sign it, send it over the (simulated) optical channel ---------

// The manifest is small — ideal optical payload. The installer is not; it
// goes over HTTPS afterward. That split is the whole bootstrap idea.
const artifactOptions = { mediaType: 'application/vnd.oat.release-manifest+json', payload: serializeManifest(manifest) };
const run = await simulateTransport({
  artifact: { ...artifactOptions, sign: { secretKey, keyId: 'release-key' } },
  seed: 21,
  requireSignature: true,
  impairments: { lossRate: 0.25, reorderWindow: 6 }
});
assert.equal(run.delivered, true, 'signed manifest survives a lossy optical link');
console.log(`manifest artifact delivered optically (${run.packetsConsumedByReceiver} packets consumed)`);

// --- Receiver: the signature gate ------------------------------------------

// Unsigned "manifest"? Extraction throws — it will not even parse the URLs.
const unsignedRun = await simulateTransport({ artifact: artifactOptions, seed: 22 });
await assert.rejects(
  () => extractReleaseManifest(unsignedRun.reconstructedArtifact, unsignedRun.verification),
  /refusing to process an unsigned or unverified artifact/
);
console.log('unsigned manifest: extractReleaseManifest refused (side effects need a verified signature)');

// Signed and verified? Extraction proceeds.
const received = await extractReleaseManifest(run.reconstructedArtifact, run.verification);
assert.equal(received.releaseId, '1.2.3');
console.log(`extracted manifest for ${received.name}@${received.releaseId} (${received.artifacts.length} artifact)`);

// --- The follow-on HTTPS fetch, digest-verified, mirror fallback -----------

// Stub fetch: mirror-a serves TAMPERED bytes, mirror-b serves the real ones.
// (allowedUrlSchemes defaults to https: only — an SSRF guard, since these
// URLs arrived over a sender-controlled channel.)
const tampered = releaseBytes.slice();
tampered[0] ^= 0xff;
const fetchImpl = async (url) => {
  const body = url.includes('mirror-a') ? tampered : releaseBytes;
  return new Response(body.slice().buffer, { status: 200 });
};

const result = await fetchAndVerifyReleaseArtifact(received.artifacts[0], { fetchImpl });
assert.equal(result.urlUsed, 'https://mirror-b.example/release.tar.gz', 'lying mirror skipped, not trusted');
assert.deepEqual(result.bytes, releaseBytes, 'delivered bytes match the manifest digest');
console.log(`fetched ${result.bytes.length} bytes from ${result.urlUsed} — mirror-a's digest mismatch was skipped`);

// And a scheme outside the allowlist never gets fetched at all:
await assert.rejects(
  () =>
    fetchAndVerifyReleaseArtifact(
      { ...received.artifacts[0], urls: ['http://mirror-a.example/release.tar.gz'] },
      { fetchImpl }
    ),
  /not in allowedUrlSchemes/
);
console.log('http: mirror rejected by the https:-only allowlist');

console.log('bootstrap manifest flow OK');
