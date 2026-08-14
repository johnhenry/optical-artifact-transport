import { describe, expect, it, vi } from 'vitest';
import { computeDigest, generateSigningKey, verifyArtifact } from '@johnhenry/oat-protocol';
import {
  buildReleaseManifestArtifact,
  extractReleaseManifest,
  fetchAndVerifyManifest,
  fetchAndVerifyReleaseArtifact,
  type ReleaseManifest
} from '../src/release-manifest.js';
import type { BootstrapVerification } from '../src/require-verified.js';

const VERIFIED: BootstrapVerification = { valid: true, signatureValid: true };

function manifestFor(bytes: Uint8Array, urls: string[]): ReleaseManifest {
  return {
    version: 1,
    name: 'demo-release',
    releaseId: 'rel-1',
    artifacts: [{ name: 'app.bin', mediaType: 'application/octet-stream', size: bytes.length, digest: computeDigest(bytes), urls }]
  };
}

describe('release manifest artifact', () => {
  it('round-trips a manifest through build -> verify -> extract', async () => {
    const payloadBytes = crypto.getRandomValues(new Uint8Array(2048));
    const manifest = manifestFor(payloadBytes, ['https://cdn.example/app.bin']);

    const { secretKey } = generateSigningKey();
    const artifact = await buildReleaseManifestArtifact(manifest, { sign: { secretKey, keyId: 'release-key' } });

    const verification = verifyArtifact(artifact, { requireSignature: true });
    expect(verification.valid).toBe(true);

    const decoded = await extractReleaseManifest(artifact, verification);
    expect(decoded).toEqual(manifest);
  });

  it('rejects extracting a non-manifest artifact', async () => {
    const { buildArtifact } = await import('@johnhenry/oat-protocol');
    const other = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('nope') });
    await expect(extractReleaseManifest(other, VERIFIED)).rejects.toThrow(/not a release-manifest artifact/);
  });

  it('refuses to extract from an unsigned artifact even if verification.valid is true (requireSignature: false)', async () => {
    const payloadBytes = new TextEncoder().encode('x');
    const manifest = manifestFor(payloadBytes, ['https://cdn.example/x']);
    const artifact = await buildReleaseManifestArtifact(manifest); // unsigned

    const verification = verifyArtifact(artifact); // valid: true, signatureValid: 'absent'
    expect(verification.valid).toBe(true);
    expect(verification.signatureValid).toBe('absent');

    await expect(extractReleaseManifest(artifact, verification)).rejects.toThrow(/unsigned or unverified/);
  });

  it('refuses to extract when verification.valid is false, even if a signature happens to be present', async () => {
    const payloadBytes = new TextEncoder().encode('x');
    const manifest = manifestFor(payloadBytes, ['https://cdn.example/x']);
    const { secretKey } = generateSigningKey();
    const artifact = await buildReleaseManifestArtifact(manifest, { sign: { secretKey } });

    await expect(
      extractReleaseManifest(artifact, { valid: false, signatureValid: true })
    ).rejects.toThrow(/unsigned or unverified/);
  });
});

describe('fetchAndVerifyReleaseArtifact', () => {
  it('downloads and accepts bytes matching the declared digest and size', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(512));
    const manifest = manifestFor(bytes, ['https://mirror-a.example/app.bin']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    const result = await fetchAndVerifyReleaseArtifact(entry, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.urlUsed).toBe('https://mirror-a.example/app.bin');
    expect(result.bytes).toEqual(bytes);
  });

  it('falls through to the next mirror when the first fails verification', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(256));
    const tampered = bytes.slice();
    tampered[0] = (tampered[0]! ^ 0xff) as number;
    const manifest = manifestFor(bytes, ['https://bad-mirror.example/app.bin', 'https://good-mirror.example/app.bin']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('bad-mirror') ? new Response(tampered, { status: 200 }) : new Response(bytes, { status: 200 })
    );
    const result = await fetchAndVerifyReleaseArtifact(entry, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(result.urlUsed).toBe('https://good-mirror.example/app.bin');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws when every mirror fails (HTTP error, digest mismatch, or network error)', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(128));
    const manifest = manifestFor(bytes, ['https://down.example/app.bin', 'https://wrong.example/app.bin']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('down')) throw new Error('network unreachable');
      return new Response(new Uint8Array(999), { status: 200 }); // wrong size
    });

    await expect(
      fetchAndVerifyReleaseArtifact(entry, { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/all mirrors failed/);
  });

  it('refuses non-https URLs by default (SSRF guard) without ever calling fetch for them', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(128));
    const manifest = manifestFor(bytes, ['http://internal.example/app.bin', 'file:///etc/passwd', 'javascript:alert(1)']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    await expect(
      fetchAndVerifyReleaseArtifact(entry, { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow(/all mirrors failed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows a wider scheme set only when explicitly opted into via allowedUrlSchemes', async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    const manifest = manifestFor(bytes, ['http://internal.example/app.bin']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    const result = await fetchAndVerifyReleaseArtifact(entry, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      allowedUrlSchemes: ['http:', 'https:']
    });
    expect(result.urlUsed).toBe('http://internal.example/app.bin');
  });

  it('rejects a response exceeding maxBytes even if it would otherwise verify', async () => {
    const bytes = new Uint8Array(1000).fill(7);
    const manifest = manifestFor(bytes, ['https://big.example/app.bin']);
    const entry = manifest.artifacts[0]!;

    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));
    await expect(
      fetchAndVerifyReleaseArtifact(entry, { fetchImpl: fetchImpl as unknown as typeof fetch, maxBytes: 500 })
    ).rejects.toThrow(/all mirrors failed/);
  });

  it('fetchAndVerifyManifest verifies every artifact in a manifest', async () => {
    const a = crypto.getRandomValues(new Uint8Array(100));
    const b = crypto.getRandomValues(new Uint8Array(200));
    const manifest: ReleaseManifest = {
      version: 1,
      name: 'multi',
      releaseId: 'rel-2',
      artifacts: [
        { name: 'a.bin', mediaType: 'application/octet-stream', size: a.length, digest: computeDigest(a), urls: ['https://x/a.bin'] },
        { name: 'b.bin', mediaType: 'application/octet-stream', size: b.length, digest: computeDigest(b), urls: ['https://x/b.bin'] }
      ]
    };

    const fetchImpl = vi.fn(async (url: string) => new Response(url.endsWith('a.bin') ? a : b, { status: 200 }));
    const results = await fetchAndVerifyManifest(manifest, { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(results).toHaveLength(2);
    expect(results[0]?.bytes).toEqual(a);
    expect(results[1]?.bytes).toEqual(b);
  });
});
