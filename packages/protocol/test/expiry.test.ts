import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildArtifact, verifyArtifact } from '../src/manifest.js';
import type { OatArtifact } from '../src/artifact.js';

/**
 * `docs/design.md` lists "Payload replay" as a primary threat and
 * "Expiry, nonce, and session binding" as the core control against it.
 * Nonce and session binding do not exist anywhere in this repo — `grep -rn
 * nonce packages/*​/src` finds nothing — so `expiresAt` is the whole of
 * that control, and the receive path calls it out explicitly: the design
 * doc's receiver steps say "Verify hash, signature, expiration, and sender
 * identity."
 *
 * It used to be evaluated as
 *
 *   Boolean(artifact.expiresAt && Date.now() > Date.parse(artifact.expiresAt))
 *
 * which fails open on every value `Date.parse` cannot read, because
 * `NaN > x` is `false`. Two shapes reach that:
 *
 *   - Unparseable strings — `'not-a-date'`, `''`, `'2026-13-45'` — give
 *     `NaN`, so the artifact never expires and `reasons` stays empty. A
 *     sender emitting a non-ISO timestamp gets an artifact that silently
 *     outlives its intent, with nothing anywhere saying so.
 *   - Non-strings. `isOatArtifact` does not inspect `expiresAt` at all, so
 *     a CBOR integer survives assembly, and `Date.parse` coerces with
 *     `String()`: measured on V8, `Date.parse(42)` is
 *     `2042-01-01T08:00:00Z` — a sixteen-year lifetime, in local time,
 *     from one byte on the wire.
 *
 * These tests pin the fail-closed behaviour. They are deliberately written
 * against `verifyArtifact` rather than the helper, since the helper is not
 * exported and the contract that matters is the verdict a receiver sees.
 */

const PAYLOAD = new TextEncoder().encode('hello optical world');

async function artifactWithExpiry(expiresAt: unknown): Promise<OatArtifact> {
  const base = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
  // Cast because the malformed shapes are exactly the point: they are what
  // arrives off a camera, where the type system has no jurisdiction.
  return { ...base, expiresAt: expiresAt as string | undefined };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('artifact expiry', () => {
  it('an artifact with no expiresAt does not expire', async () => {
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD });
    const result = verifyArtifact(artifact);

    expect(result.expired).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('a future expiresAt verifies, and the same artifact stops verifying once that instant passes', async () => {
    const artifact = await artifactWithExpiry(new Date(Date.now() + 60_000).toISOString());

    expect(verifyArtifact(artifact).expired).toBe(false);

    // Same artifact, same bytes — only the clock moved. This is the
    // property the control exists for.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 120_000));

    const later = verifyArtifact(artifact);
    expect(later.expired).toBe(true);
    expect(later.valid).toBe(false);
    expect(later.reasons).toContain('expired');
  });

  it.each([
    ['a string that is not a date', 'not-a-date'],
    ['an empty string', ''],
    ['an impossible calendar date', '2026-13-45'],
    ['whitespace', '   '],
  ])('fails closed on %s', async (_label, value) => {
    const result = verifyArtifact(await artifactWithExpiry(value));

    expect(result.expired).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('expires-at-unreadable');
  });

  it.each([
    ['a bare number', 42],
    ['a numeric string', '42'],
    ['a year alone', '2026'],
    ['a boolean', true],
    ['an object', { at: '2099-01-01T00:00:00.000Z' }],
  ])('fails closed on %s rather than letting Date.parse coerce it', async (_label, value) => {
    const result = verifyArtifact(await artifactWithExpiry(value));

    // The specific hazard: Date.parse(42) and Date.parse('42') both read
    // as 2042-01-01 on V8, so without this the artifact would verify for
    // the next sixteen years.
    expect(result.expired).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('expires-at-unreadable');
  });

  it('an unreadable expiresAt is reported distinctly from a genuinely expired one', async () => {
    const unreadable = verifyArtifact(await artifactWithExpiry('not-a-date'));
    const expired = verifyArtifact(await artifactWithExpiry('2000-01-01T00:00:00.000Z'));

    expect(unreadable.reasons).toEqual(['expires-at-unreadable']);
    expect(expired.reasons).toEqual(['expired']);
  });

  it('expiry is independent of the digest and signature verdicts', async () => {
    // A stale artifact whose digest is still perfectly good must fail on
    // lifetime alone — collapsing the two would let a caller that only
    // looks at digestValid ship an expired payload.
    const artifact = await artifactWithExpiry('2000-01-01T00:00:00.000Z');
    const result = verifyArtifact(artifact);

    expect(result.digestValid).toBe(true);
    expect(result.signatureValid).toBe('absent');
    expect(result.expired).toBe(true);
    expect(result.valid).toBe(false);
  });

  it('what buildArtifact itself produces is accepted', async () => {
    // Guards against a shape check that is stricter than this package's own
    // output — the failure mode where a fail-closed fix breaks the happy path.
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload: PAYLOAD, expiresAt });

    expect(artifact.expiresAt).toBe(expiresAt);
    expect(verifyArtifact(artifact).reasons).toEqual([]);
  });
});
