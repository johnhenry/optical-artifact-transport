import { describe, expect, it } from 'vitest';
import { buildArtifact, createReplayGuard } from '@johnhenry/oat-protocol';
import { verifyReceivedArtifact } from '../src/verifier.js';

const PAYLOAD = new TextEncoder().encode('x');

describe('verifyReceivedArtifact replay controls', () => {
  it('accepts an artifact once and rejects the same captured artifact the second time (replay)', async () => {
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const first = verifyReceivedArtifact(a, { replayGuard: guard });
    expect(first.valid).toBe(true);
    const second = verifyReceivedArtifact(a, { replayGuard: guard });
    expect(second.valid).toBe(false);
    expect(second.reasons).toContain('replayed');
  });

  it('does not burn the nonce of an artifact that failed verification', async () => {
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const rejected = verifyReceivedArtifact(a, { replayGuard: guard, acceptMediaTypes: ['image/png'] });
    expect(rejected.valid).toBe(false);
    expect(verifyReceivedArtifact(a, { replayGuard: guard }).valid).toBe(true);
  });

  it('rejects an artifact whose nonce is missing when a guard is in use', async () => {
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const { nonce: _n, ...noNonce } = a;
    const r = verifyReceivedArtifact(noNonce as typeof a, { replayGuard: guard });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('nonce-missing');
  });

  it('rejects cross-session replay via expectedSessionId', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sessionId: 'S1' });
    expect(verifyReceivedArtifact(a, { expectedSessionId: 'S1' }).valid).toBe(true);
    const r = verifyReceivedArtifact(a, { expectedSessionId: 'S2' });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('session-mismatch');
  });

  it('rejects an expired payload', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt: '2000-01-01T00:00:00Z' });
    const r = verifyReceivedArtifact(a);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('expired');
  });

  it('requireExpiry: false opts out of mandatory expiry', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt: null });
    expect(verifyReceivedArtifact(a).valid).toBe(false);
    expect(verifyReceivedArtifact(a, { requireExpiry: false }).valid).toBe(true);
  });
});
