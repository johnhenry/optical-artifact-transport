import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '@johnhenry/oat-protocol';
import { simulateTransport } from '../src/simulate.js';

const payload = new TextEncoder().encode(
  'Signed task state and continuation metadata for an agent handoff. '.repeat(30)
);

describe('transport simulator', () => {
  it('delivers and verifies an unsigned artifact over a clean channel', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 1
    });

    expect(result.delivered).toBe(true);
    expect(result.verification?.valid).toBe(true);
    expect(result.reconstructedArtifact).not.toBeNull();
  });

  it('recovers under realistic loss, duplication, and reordering (deterministic vector)', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 42,
      impairments: { lossRate: 0.3, duplicateRate: 0.1, reorderWindow: 8 }
    });

    expect(result.delivered).toBe(true);
    expect(result.verification?.digestValid).toBe(true);
    // Same seed + same impairment config must always produce the same outcome.
    const rerun = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 42,
      impairments: { lossRate: 0.3, duplicateRate: 0.1, reorderWindow: 8 }
    });
    expect(rerun.packetsConsumedByReceiver).toBe(result.packetsConsumedByReceiver);
  });

  it('recovers a receiver that joins mid-stream and misses the first packets', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 7,
      lateJoinOffset: 50
    });

    expect(result.delivered).toBe(true);
  });

  it('fails delivery under extreme loss rather than hanging (respects frameBudget)', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 3,
      frameBudget: 40,
      impairments: { lossRate: 0.97 }
    });

    expect(result.delivered).toBe(false);
    expect(result.decoderProgress).toBeLessThan(1);
  });

  it('digest verification catches payload corruption instead of silently delivering bad data', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 99,
      frameBudget: 800,
      impairments: { corruptionRate: 0.5 }
    });

    // Either the corruption prevents the fountain code from ever completing,
    // or it completes with bad data and verification must catch it — never
    // both "delivered: true" and a digest mismatch.
    if (result.verification) {
      expect(result.verification.valid).toBe(result.verification.digestValid && result.delivered);
      if (!result.verification.digestValid) {
        expect(result.delivered).toBe(false);
      }
    }
  });

  it('requires and verifies a signature end to end through the simulated channel', async () => {
    const { secretKey } = generateSigningKey();
    const result = await simulateTransport({
      artifact: {
        mediaType: 'application/octet-stream',
        payload,
        sign: { secretKey, keyId: 'sim-key' }
      },
      seed: 5,
      requireSignature: true
    });

    expect(result.delivered).toBe(true);
    expect(result.verification?.signatureValid).toBe(true);
  });

  it('rejects an unsigned artifact when the receiver requires a signature', async () => {
    const result = await simulateTransport({
      artifact: { mediaType: 'application/octet-stream', payload },
      seed: 11,
      requireSignature: true
    });

    expect(result.delivered).toBe(false);
    expect(result.verification?.reasons).toContain('signature-required');
  });
});
