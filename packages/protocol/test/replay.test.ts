import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildArtifact,
  createReplayGuard,
  DEFAULT_ARTIFACT_TTL_MS,
  generateSigningKey,
  verifyArtifact
} from '../src/index.js';

/**
 * `docs/design.md` names "Expiry, nonce, and session binding" as the controls
 * against the "Payload replay" threat. These tests pin all three.
 */
const PAYLOAD = new TextEncoder().encode('replay me');

afterEach(() => {
  vi.useRealTimers();
});

describe('mandatory expiry', () => {
  it('buildArtifact applies a default expiry of DEFAULT_ARTIFACT_TTL_MS after createdAt', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, createdAt: '2026-01-01T00:00:00.000Z' });
    expect(DEFAULT_ARTIFACT_TTL_MS).toBe(60 * 60 * 1000);
    expect(a.expiresAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('an explicit expiresAt wins over the default; ttlMs overrides the default window', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt: '2030-01-01T00:00:00.000Z' });
    expect(a.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    const b = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, createdAt: '2026-01-01T00:00:00.000Z', ttlMs: 1000 });
    expect(b.expiresAt).toBe('2026-01-01T00:00:01.000Z');
  });

  it('an expired payload is rejected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    expect(verifyArtifact(a).valid).toBe(true);
    vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));
    const r = verifyArtifact(a);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('expired');
  });

  it('an artifact with no expiresAt is rejected by default', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt: null });
    expect(a.expiresAt).toBeUndefined();
    const r = verifyArtifact(a);
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('expires-at-missing');
  });

  it('requireExpiry: false is the explicit opt-out for non-expiring artifacts', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt: null });
    expect(verifyArtifact(a, { requireExpiry: false }).valid).toBe(true);
  });

  it('stripping expiresAt from a signed artifact invalidates the signature', async () => {
    const { secretKey } = generateSigningKey();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sign: { secretKey } });
    const stripped = { ...a, expiresAt: undefined };
    expect(verifyArtifact(stripped, { requireExpiry: false }).signatureValid).toBe(false);
  });
});

describe('nonce', () => {
  it('buildArtifact stamps a fresh nonce per artifact, covered by the signature', async () => {
    const { secretKey } = generateSigningKey();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sign: { secretKey } });
    const b = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sign: { secretKey } });
    expect(typeof a.nonce).toBe('string');
    expect(a.nonce).not.toBe(b.nonce);
    expect(verifyArtifact({ ...a, nonce: 'swapped' }).signatureValid).toBe(false);
  });
});

describe('session binding', () => {
  it('accepts an artifact bound to the expected session', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sessionId: 'session-A' });
    expect(verifyArtifact(a, { expectedSessionId: 'session-A' }).valid).toBe(true);
  });

  it('rejects a cross-session replay (artifact bound to a different session)', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sessionId: 'session-A' });
    const r = verifyArtifact(a, { expectedSessionId: 'session-B' });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('session-mismatch');
  });

  it('rejects an artifact with no session binding when the receiver expects one', async () => {
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const r = verifyArtifact(a, { expectedSessionId: 'session-A' });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('session-mismatch');
  });

  it('a signed artifact cannot be re-bound to another session without breaking the signature', async () => {
    const { secretKey } = generateSigningKey();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, sessionId: 'session-A', sign: { secretKey } });
    const r = verifyArtifact({ ...a, sessionId: 'session-B' }, { expectedSessionId: 'session-B' });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain('signature-invalid');
  });
});

describe('createReplayGuard', () => {
  it('accepts a nonce once and flags the second sighting as a replay', async () => {
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    expect(guard.has(a)).toBe(false);
    guard.add(a);
    expect(guard.has(a)).toBe(true);
  });

  it('treats an artifact without a nonce as unusable (has() reports true: fail closed)', async () => {
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const { nonce: _n, ...noNonce } = a;
    expect(guard.has(noNonce as typeof a)).toBe(true);
  });

  it('is bounded: oldest nonces are evicted past maxEntries', async () => {
    const guard = createReplayGuard({ maxEntries: 3 });
    const arts = [];
    for (let i = 0; i < 5; i++) {
      const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
      arts.push(a);
      guard.add(a);
    }
    expect(guard.size).toBe(3);
    expect(guard.has(arts[0]!)).toBe(false);
    expect(guard.has(arts[4]!)).toBe(true);
  });

  it('drops entries once their artifact has expired (they can no longer be replayed anyway)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const guard = createReplayGuard();
    const a = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, ttlMs: 1000 });
    guard.add(a);
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
    const b = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    guard.add(b);
    expect(guard.size).toBe(1);
  });

  it('rejects a non-positive or non-integer maxEntries', () => {
    expect(() => createReplayGuard({ maxEntries: 0 })).toThrow();
  });
});
