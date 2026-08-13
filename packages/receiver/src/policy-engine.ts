import {
  checkSandboxEligibility,
  intersectCapabilities,
  type CapabilityPolicy,
  type UiProposalEnvelope
} from '@oat/protocol';
import type { ReceiverVerificationResult } from './verifier.js';

export type UiDecisionOutcome = 'reject' | 'downgrade' | 'accept-safe' | 'accept-unsafe';

/** Profiles a receiver can independently configure signature/consent requirements for. */
export type SignableProfile = 'safe-view' | 'safe-html' | 'sandboxed-html';

export type UiApprovalMode = 'automatic' | 'prompt' | 'prompt-with-warning';

/** The policy engine's internal decision — distinct from the wire-level `UiDecision` artifact sent back to the sender (see `@oat/protocol`'s `ui-decision.ts`). */
export interface PolicyDecision {
  outcome: UiDecisionOutcome;
  reasons: string[];
  effectiveCapabilities: string[];
  /** How the host should gate rendering before the user sees granted content. */
  approvalMode: UiApprovalMode;
  /** `true` whenever `approvalMode !== 'automatic'` — a convenience flag for callers that don't want to compare strings. */
  requiresExplicitApproval: boolean;
}

export interface PolicyEngineOptions {
  capabilityPolicy: CapabilityPolicy;
  /** Capabilities granted without an explicit user gesture. Keep this short — see README security model. */
  autoApprove?: string[];
  /** 'none' downgrades every proposal without evaluating it — the receiver only ever wants raw artifacts. */
  uiPolicy?: 'safe' | 'none';
  /**
   * M6 break-glass opt-in. Defaults closed (`false`/omitted): even a
   * fully-eligible `sandboxed-html` proposal (valid signature, etc.) is
   * downgraded unless the receiver deployment explicitly sets this.
   */
  allowUnsafeHtml?: boolean;
  /**
   * Per-profile signature requirement, independent of the receiver
   * element's global `verify`/`require-signature` attribute. `sandboxed-html`
   * always requires a signature via `checkSandboxEligibility` regardless of
   * whether it's listed here.
   */
  requireSignatureFor?: SignableProfile[];
  /**
   * Per-profile consent UX. Defaults: `safe-view`/`safe-html` are
   * `'automatic'` (render as soon as capabilities are computed);
   * `sandboxed-html` is always effectively `'prompt-with-warning'`
   * regardless of this setting, since M6 requires the break-glass opt-in
   * unconditionally.
   */
  approval?: Partial<Record<SignableProfile, UiApprovalMode>>;
}

export function profileOf(requestedProfile: UiProposalEnvelope['requestedProfile']): SignableProfile {
  if (requestedProfile === 'sandboxed-html') return 'sandboxed-html';
  if (requestedProfile === 'safe-html') return 'safe-html';
  return 'safe-view';
}

const NO_APPROVAL_NEEDED: Pick<PolicyDecision, 'approvalMode' | 'requiresExplicitApproval'> = {
  approvalMode: 'automatic',
  requiresExplicitApproval: false
};

/**
 * Decides what a receiver does with a sender-proposed UI. `accept-unsafe`
 * (raw HTML in an isolated sandbox, M6) is only ever reachable for a
 * `sandboxed-html` proposal that passes `checkSandboxEligibility` — a
 * signed, verified artifact AND an explicit `allowUnsafeHtml` receiver
 * opt-in. Everything else (`trusted-html`, or `sandboxed-html` that fails
 * eligibility) downgrades instead of rejecting outright, since the
 * underlying artifact may still be perfectly legitimate — only the
 * requested *rendering* is refused.
 */
export class PolicyEngine {
  constructor(private readonly options: PolicyEngineOptions) {}

  decideUi(
    proposal: UiProposalEnvelope,
    verification: ReceiverVerificationResult,
    userApprovedCapabilities: readonly string[] = []
  ): PolicyDecision {
    if (!verification.valid) {
      return { outcome: 'reject', reasons: verification.reasons, effectiveCapabilities: [], ...NO_APPROVAL_NEEDED };
    }

    if (this.options.uiPolicy === 'none') {
      return { outcome: 'downgrade', reasons: ['ui-policy-none'], effectiveCapabilities: [], ...NO_APPROVAL_NEEDED };
    }

    if (proposal.requestedProfile === 'trusted-html') {
      return { outcome: 'downgrade', reasons: ['unsafe-profile-not-supported'], effectiveCapabilities: [], ...NO_APPROVAL_NEEDED };
    }

    const profile = profileOf(proposal.requestedProfile);

    if (this.options.requireSignatureFor?.includes(profile) && verification.signatureValid !== true) {
      return {
        outcome: 'downgrade',
        reasons: ['signature-required-for-profile'],
        effectiveCapabilities: [],
        ...NO_APPROVAL_NEEDED
      };
    }

    if (proposal.requestedProfile === 'sandboxed-html') {
      const eligibility = checkSandboxEligibility({
        signatureValid: verification.signatureValid === true,
        senderTrusted: verification.senderTrusted,
        allowUnsafeHtml: this.options.allowUnsafeHtml ?? false
      });
      return eligibility.eligible
        ? {
            outcome: 'accept-unsafe',
            reasons: [],
            effectiveCapabilities: [],
            approvalMode: 'prompt-with-warning',
            requiresExplicitApproval: true
          }
        : { outcome: 'downgrade', reasons: eligibility.reasons, effectiveCapabilities: [], ...NO_APPROVAL_NEEDED };
    }

    const requested = proposal.requestedCapabilities.map((c) => c.capability);
    const approved = [...(this.options.autoApprove ?? []), ...userApprovedCapabilities];
    const effectiveCapabilities = intersectCapabilities(requested, this.options.capabilityPolicy, approved);
    const approvalMode = this.options.approval?.[profile] ?? 'automatic';

    return {
      outcome: 'accept-safe',
      reasons: [],
      effectiveCapabilities,
      approvalMode,
      requiresExplicitApproval: approvalMode !== 'automatic'
    };
  }

  /**
   * Checks a single capability against this engine's policy — used by the
   * M6 sandbox bridge to independently mediate each `request.capability`/
   * `request.action` message from an unsafe-mode iframe, rather than
   * pre-granting a batch the way `accept-safe` does.
   */
  checkCapability(capability: string, userApprovedCapabilities: readonly string[] = []): boolean {
    const approved = [...(this.options.autoApprove ?? []), ...userApprovedCapabilities];
    return intersectCapabilities([capability], this.options.capabilityPolicy, approved).length > 0;
  }
}
