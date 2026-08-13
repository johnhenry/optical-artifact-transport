import { describe, expect, it } from 'vitest';
import { createCapabilityPolicy, type UiProposalEnvelope, type VerificationResult } from '@oat/protocol';
import { PolicyEngine } from '../src/policy-engine.js';
import type { ReceiverVerificationResult } from '../src/verifier.js';

function verified(overrides: Partial<ReceiverVerificationResult> = {}): ReceiverVerificationResult {
  const base: VerificationResult = { valid: true, digestValid: true, signatureValid: true, expired: false, reasons: [] };
  return { ...base, mediaTypeAccepted: true, senderTrusted: true, ...overrides };
}

function proposal(overrides: Partial<UiProposalEnvelope> = {}): UiProposalEnvelope {
  return {
    type: 'ui.proposal',
    version: 1,
    proposalId: 'p1',
    origin: { id: 'sender-1' },
    title: 'Test proposal',
    preferredView: { kind: 'text', body: 'x' },
    fallbackView: { kind: 'text', body: 'x' },
    requestedCapabilities: [],
    requestedProfile: 'safe-view',
    ...overrides
  };
}

describe('PolicyEngine.decideUi', () => {
  it('rejects when verification failed, regardless of the proposal', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]) });
    const result = engine.decideUi(proposal(), verified({ valid: false, digestValid: false, reasons: ['digest-mismatch'] }));
    expect(result).toEqual({
      outcome: 'reject',
      reasons: ['digest-mismatch'],
      effectiveCapabilities: [],
      approvalMode: 'automatic',
      requiresExplicitApproval: false
    });
  });

  it("downgrades everything when uiPolicy is 'none'", () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy(['x']), uiPolicy: 'none' });
    const result = engine.decideUi(proposal({ requestedCapabilities: [{ capability: 'x' }] }), verified());
    expect(result.outcome).toBe('downgrade');
    expect(result.reasons).toEqual(['ui-policy-none']);
  });

  it('always downgrades trusted-html — it is not implemented by this build', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]), allowUnsafeHtml: true });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'trusted-html', preferredView: { kind: 'sandboxed-html', html: '<p>x</p>' } }),
      verified()
    );
    expect(result.outcome).toBe('downgrade');
    expect(result.reasons).toEqual(['unsafe-profile-not-supported']);
  });

  it('downgrades sandboxed-html when allowUnsafeHtml is not set, even with a valid signature', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]) });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'sandboxed-html', preferredView: { kind: 'sandboxed-html', html: '<p>x</p>' } }),
      verified({ signatureValid: true })
    );
    expect(result.outcome).toBe('downgrade');
    expect(result.reasons).toContain('receiver-policy-disallows-unsafe-html');
  });

  it('downgrades sandboxed-html when allowUnsafeHtml is set but the signature is absent', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]), allowUnsafeHtml: true });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'sandboxed-html', preferredView: { kind: 'sandboxed-html', html: '<p>x</p>' } }),
      verified({ signatureValid: 'absent' })
    );
    expect(result.outcome).toBe('downgrade');
    expect(result.reasons).toContain('signature-required');
  });

  it('reaches accept-unsafe only when both allowUnsafeHtml and a valid signature are present', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]), allowUnsafeHtml: true });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'sandboxed-html', preferredView: { kind: 'sandboxed-html', html: '<p>x</p>' } }),
      verified({ signatureValid: true })
    );
    expect(result).toEqual({
      outcome: 'accept-unsafe',
      reasons: [],
      effectiveCapabilities: [],
      approvalMode: 'prompt-with-warning',
      requiresExplicitApproval: true
    });
  });

  it('accept-unsafe never pre-grants capabilities — the sandbox bridge mediates each request individually', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy(['html.script']),
      allowUnsafeHtml: true,
      autoApprove: ['html.script']
    });
    const result = engine.decideUi(
      proposal({
        requestedProfile: 'sandboxed-html',
        preferredView: { kind: 'sandboxed-html', html: '<p>x</p>' },
        requestedCapabilities: [{ capability: 'html.script' }]
      }),
      verified({ signatureValid: true })
    );
    expect(result.effectiveCapabilities).toEqual([]);
  });

  it('computes accept-safe capabilities as requested ∩ policy ∩ approved for a safe profile', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy(['a', 'b']), autoApprove: ['a'] });
    const result = engine.decideUi(
      proposal({ requestedCapabilities: [{ capability: 'a' }, { capability: 'b' }, { capability: 'c' }] }),
      verified(),
      ['b']
    );
    expect(result.outcome).toBe('accept-safe');
    expect(result.effectiveCapabilities.sort()).toEqual(['a', 'b']);
  });

  it('accept-safe defaults to automatic approval with no explicit gate', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]) });
    const result = engine.decideUi(proposal(), verified());
    expect(result.approvalMode).toBe('automatic');
    expect(result.requiresExplicitApproval).toBe(false);
  });

  it('honors a per-profile approval mode for safe-html', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy([]),
      approval: { 'safe-html': 'prompt' }
    });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'safe-html', preferredView: { kind: 'safe-html', html: '<p>x</p>', sanitizationProfile: 'strict' } }),
      verified()
    );
    expect(result.outcome).toBe('accept-safe');
    expect(result.approvalMode).toBe('prompt');
    expect(result.requiresExplicitApproval).toBe(true);
  });

  it('a safe-view profile is unaffected by a safe-html-only approval override', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy([]),
      approval: { 'safe-html': 'prompt' }
    });
    const result = engine.decideUi(proposal({ requestedProfile: 'safe-view' }), verified());
    expect(result.approvalMode).toBe('automatic');
  });

  it('requireSignatureFor downgrades an unsigned safe-view proposal even though safe-view normally needs no signature', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy([]),
      requireSignatureFor: ['safe-view']
    });
    const result = engine.decideUi(proposal(), verified({ signatureValid: 'absent' }));
    expect(result.outcome).toBe('downgrade');
    expect(result.reasons).toContain('signature-required-for-profile');
  });

  it('requireSignatureFor accepts a signed proposal for the configured profile', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy([]),
      requireSignatureFor: ['safe-html']
    });
    const result = engine.decideUi(
      proposal({ requestedProfile: 'safe-html', preferredView: { kind: 'safe-html', html: '<p>x</p>', sanitizationProfile: 'strict' } }),
      verified({ signatureValid: true })
    );
    expect(result.outcome).toBe('accept-safe');
  });

  it('requireSignatureFor does not affect a profile not listed', () => {
    const engine = new PolicyEngine({
      capabilityPolicy: createCapabilityPolicy([]),
      requireSignatureFor: ['safe-html']
    });
    const result = engine.decideUi(proposal({ requestedProfile: 'safe-view' }), verified({ signatureValid: 'absent' }));
    expect(result.outcome).toBe('accept-safe');
  });
});

describe('PolicyEngine.checkCapability', () => {
  it('allows a capability that is both policy-allowed and user-approved', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy(['x']) });
    expect(engine.checkCapability('x', ['x'])).toBe(true);
  });

  it('denies a capability that is policy-allowed but not user-approved', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy(['x']) });
    expect(engine.checkCapability('x', [])).toBe(false);
  });

  it('denies a capability that is user-approved but not in policy', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy([]) });
    expect(engine.checkCapability('x', ['x'])).toBe(false);
  });

  it('honors denied capabilities even if allowed and approved elsewhere', () => {
    const policy = createCapabilityPolicy(['x'], ['x']);
    const engine = new PolicyEngine({ capabilityPolicy: policy });
    expect(engine.checkCapability('x', ['x'])).toBe(false);
  });

  it('respects autoApprove without requiring explicit user approval', () => {
    const engine = new PolicyEngine({ capabilityPolicy: createCapabilityPolicy(['x']), autoApprove: ['x'] });
    expect(engine.checkCapability('x', [])).toBe(true);
  });
});
