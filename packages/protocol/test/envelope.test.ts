import { describe, expect, it } from 'vitest';
import { buildArtifact, verifyArtifact, extractPayload } from '../src/manifest.js';
import { generateSigningKey } from '../src/signatures.js';
import { encodeCanonical, decodeCanonical } from '../src/canonical-cbor.js';

describe('artifact envelope', () => {
  it('round-trips an unsigned artifact and verifies its digest', async () => {
    const payload = new TextEncoder().encode('hello optical world');
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload });

    expect(artifact.version).toBe(1);
    expect(artifact.signature).toBeUndefined();

    const result = verifyArtifact(artifact);
    expect(result.valid).toBe(true);
    expect(result.digestValid).toBe(true);
    expect(result.signatureValid).toBe('absent');

    const restored = await extractPayload(artifact);
    expect(new TextDecoder().decode(restored)).toBe('hello optical world');
  });

  it('fails verification when payload is tampered after digesting', async () => {
    const payload = new TextEncoder().encode('original bytes');
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload });

    artifact.payload = new TextEncoder().encode('tampered bytes!');

    const result = verifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.digestValid).toBe(false);
    expect(result.reasons).toContain('digest-mismatch');
  });

  it('signs and verifies an artifact end to end', async () => {
    const { secretKey, publicKey } = generateSigningKey();
    const payload = new TextEncoder().encode('signed payload');
    const artifact = await buildArtifact({
      mediaType: 'application/octet-stream',
      payload,
      sign: { secretKey, keyId: 'test-key-1' }
    });

    expect(artifact.signature).toBeDefined();
    expect(artifact.signature?.publicKey).toEqual(publicKey);

    const result = verifyArtifact(artifact, { requireSignature: true });
    expect(result.valid).toBe(true);
    expect(result.signatureValid).toBe(true);
  });

  it('detects a tampered digest even when the payload byte-matches a forged digest', async () => {
    const { secretKey } = generateSigningKey();
    const payload = new TextEncoder().encode('signed payload');
    const artifact = await buildArtifact({
      mediaType: 'application/octet-stream',
      payload,
      sign: { secretKey }
    });

    // Attacker swaps payload+digest together but cannot re-sign.
    const forgedPayload = new TextEncoder().encode('forged payload!!');
    artifact.payload = forgedPayload;
    artifact.digest = { algorithm: 'sha256', value: artifact.digest.value };

    const result = verifyArtifact(artifact, { requireSignature: true });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('signature-invalid');
  });

  it('requires a signature when requireSignature is set and none is present', async () => {
    const payload = new TextEncoder().encode('unsigned');
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload });

    const result = verifyArtifact(artifact, { requireSignature: true });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('signature-required');
  });

  it('treats expired artifacts as invalid', async () => {
    const payload = new TextEncoder().encode('expires soon');
    const artifact = await buildArtifact({
      mediaType: 'text/plain',
      payload,
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });

    const result = verifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
  });

  it('gzip-compresses and decompresses payloads transparently', async () => {
    const payload = new TextEncoder().encode('x'.repeat(10_000));
    const artifact = await buildArtifact({
      mediaType: 'text/plain',
      payload,
      compression: 'gzip'
    });

    expect(artifact.payload.length).toBeLessThan(payload.length);
    const restored = await extractPayload(artifact);
    expect(restored).toEqual(payload);
  });

  /**
   * Regression for the "gzip bomb" finding: a small, highly-compressible
   * payload should not be able to expand to unbounded size during
   * decompression. Builds a real artifact whose tiny compressed payload
   * would inflate to 5,000,000 bytes, and asserts `extractPayload` refuses
   * to fully decompress it once a size ceiling is in play — both via the
   * caller-supplied `maxOutputBytes` and via the built-in default.
   */
  it('extractPayload aborts decompression of a payload that would exceed a size ceiling', async () => {
    const huge = new Uint8Array(500_000).fill(97); // 'a' * 500,000 — extremely compressible
    const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload: huge, compression: 'gzip' });

    // Confirms this really is bomb-shaped: a tiny artifact claiming a much larger decompressed form.
    expect(artifact.payload.length).toBeLessThan(5_000);

    await expect(extractPayload(artifact, 100_000)).rejects.toThrow(/exceeds maximum allowed size/);

    // A generous ceiling still lets a legitimate decompression through.
    const restored = await extractPayload(artifact, 1_000_000);
    expect(restored).toEqual(huge);
  });

  it('decompress() enforces its ceiling directly, independent of extractPayload', async () => {
    const { compress, decompress } = await import('../src/compression.js');
    const huge = new Uint8Array(500_000).fill(97);
    const compressed = await compress(huge, 'gzip');

    await expect(decompress(compressed, 'gzip', 100_000)).rejects.toThrow(/exceeds maximum allowed size/);
    await expect(decompress(compressed, 'gzip')).resolves.toEqual(huge); // default ceiling (100 MiB) is generous enough
  });
});

describe('canonical CBOR', () => {
  it('produces identical bytes regardless of key insertion order', () => {
    const a = encodeCanonical({ b: 1, a: 2, nested: { z: 1, y: 2 } });
    const b = encodeCanonical({ a: 2, nested: { y: 2, z: 1 }, b: 1 });
    expect(a).toEqual(b);
  });

  it('round-trips arrays, nested objects, and byte strings', () => {
    const value = {
      list: [1, 2, 3],
      bytes: new Uint8Array([1, 2, 3]),
      nested: { ok: true }
    };
    const decoded = decodeCanonical(encodeCanonical(value)) as typeof value;
    expect(decoded.list).toEqual([1, 2, 3]);
    expect(decoded.nested).toEqual({ ok: true });
    expect(Array.from(decoded.bytes as Uint8Array)).toEqual([1, 2, 3]);
  });
});
