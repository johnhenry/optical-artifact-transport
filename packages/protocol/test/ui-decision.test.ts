import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '../src/signatures.js';
import { verifyArtifact } from '../src/manifest.js';
import { buildArtifact } from '../src/manifest.js';
import { buildUiDecisionArtifact, extractUiDecision, UI_DECISION_MEDIA_TYPE, type UiDecision } from '../src/ui-decision.js';

function sampleDecision(overrides: Partial<UiDecision> = {}): UiDecision {
  return {
    type: 'ui.decision',
    version: 1,
    proposalId: 'p1',
    status: 'accepted',
    profile: 'safe-html',
    grantedCapabilities: ['agent.session.import'],
    deniedCapabilities: [{ capability: 'html.script', reason: 'not in receiver policy' }],
    sanitized: true,
    fallbackUsed: false,
    capabilityToken: 'tok-123',
    decidedAt: '2026-08-13T00:00:00.000Z',
    ...overrides
  };
}

describe('ui.decision artifact', () => {
  it('round-trips a signed decision through build -> verify -> extract', async () => {
    const { secretKey } = generateSigningKey();
    const decision = sampleDecision();
    const artifact = await buildUiDecisionArtifact(decision, { secretKey, keyId: 'receiver-key' });

    expect(artifact.mediaType).toBe(UI_DECISION_MEDIA_TYPE);
    const verification = verifyArtifact(artifact, { requireSignature: true });
    expect(verification.valid).toBe(true);

    const decoded = await extractUiDecision(artifact, verification);
    expect(decoded).toEqual(decision);
  });

  it('builds an unsigned decision artifact when no signing key is provided', async () => {
    const decision = sampleDecision({ status: 'downgraded', grantedCapabilities: [] });
    const artifact = await buildUiDecisionArtifact(decision);
    expect(artifact.signature).toBeUndefined();
  });

  it('refuses to extract from an unsigned/unverified decision artifact', async () => {
    const decision = sampleDecision();
    const artifact = await buildUiDecisionArtifact(decision); // unsigned
    await expect(extractUiDecision(artifact, { valid: true, signatureValid: 'absent' })).rejects.toThrow(
      /unsigned or unverified/
    );
  });

  it('refuses to extract when verification.valid is false', async () => {
    const { secretKey } = generateSigningKey();
    const decision = sampleDecision();
    const artifact = await buildUiDecisionArtifact(decision, { secretKey });
    await expect(extractUiDecision(artifact, { valid: false, signatureValid: true })).rejects.toThrow(
      /unsigned or unverified/
    );
  });

  it('rejects extracting a non-decision artifact', async () => {
    const other = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('nope') });
    await expect(extractUiDecision(other, { valid: true, signatureValid: 'absent' })).rejects.toThrow(
      /unsigned or unverified/
    );
    // Even with a fabricated "verified" claim, the media type check catches it.
    await expect(extractUiDecision(other, { valid: true, signatureValid: true })).rejects.toThrow(
      /not a ui-decision artifact/
    );
  });

  it('rejects a malformed decision payload (wrong type/version)', async () => {
    const { secretKey } = generateSigningKey();
    const badPayload = new TextEncoder().encode(JSON.stringify({ type: 'not.a.decision', version: 1 }));
    const artifact = await buildArtifact({ mediaType: UI_DECISION_MEDIA_TYPE, payload: badPayload, sign: { secretKey } });
    const verification = verifyArtifact(artifact, { requireSignature: true });
    await expect(extractUiDecision(artifact, verification)).rejects.toThrow(/malformed decision payload/);
  });
});
