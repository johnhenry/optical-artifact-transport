import { describe, expect, it } from 'vitest';
import { buildArtifact, generateSigningKey } from '@oat/protocol';
import { verifyReceivedArtifact, toHex } from '../src/verifier.js';

describe('verifyReceivedArtifact', () => {
  it('trusts any valid signature when no trust list is configured (permissive default)', async () => {
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact);
    expect(result.senderTrusted).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('trusts any valid signature with an empty trust list when requireExplicitTrust is not set', async () => {
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact, { trustedPublicKeysHex: [] });
    expect(result.senderTrusted).toBe(true);
  });

  it('rejects an unlisted signer when a non-empty trust list is configured', async () => {
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact, { trustedPublicKeysHex: ['00'.repeat(32)] });
    expect(result.senderTrusted).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('sender-untrusted');
  });

  it('accepts a listed signer', async () => {
    const { secretKey, publicKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact, { trustedPublicKeysHex: [toHex(publicKey)] });
    expect(result.senderTrusted).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('requireExplicitTrust: an EMPTY list means "nothing trusted yet", not "trust everyone" (TOFU semantics)', async () => {
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact, { trustedPublicKeysHex: [], requireExplicitTrust: true });
    expect(result.senderTrusted).toBe(false);
    expect(result.reasons).toContain('sender-untrusted');
  });

  it('requireExplicitTrust still accepts a listed signer', async () => {
    const { secretKey, publicKey } = generateSigningKey();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x'), sign: { secretKey } });
    const result = verifyReceivedArtifact(artifact, {
      trustedPublicKeysHex: [toHex(publicKey)],
      requireExplicitTrust: true
    });
    expect(result.senderTrusted).toBe(true);
    expect(result.valid).toBe(true);
  });

  it('an unsigned artifact is never "trusted" under requireExplicitTrust', async () => {
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('x') });
    const result = verifyReceivedArtifact(artifact, { requireExplicitTrust: true });
    expect(result.senderTrusted).toBe(false);
  });
});
