import {
  checkSandboxEligibility,
  intersectCapabilities,
  type CapabilityPolicy,
  type UiProposalEnvelope
} from '@oat/protocol';
import type { ReceiverVerificationResult } from './verifier.js';

export type UiDecisionOutcome = 'reject' | 'downgrade' | 'accept-safe' | 'accept-unsafe';

export interface UiDecision {
  outcome: UiDecisionOutcome;
  reasons: string[];
  effectiveCapabilities: string[];
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
}

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
  ): UiDecision {
    if (!verification.valid) {
      return { outcome: 'reject', reasons: verification.reasons, effectiveCapabilities: [] };
    }

    if (this.options.uiPolicy === 'none') {
      return { outcome: 'downgrade', reasons: ['ui-policy-none'], effectiveCapabilities: [] };
    }

    if (proposal.requestedProfile === 'trusted-html') {
      return { outcome: 'downgrade', reasons: ['unsafe-profile-not-supported'], effectiveCapabilities: [] };
    }

    if (proposal.requestedProfile === 'sandboxed-html') {
      const eligibility = checkSandboxEligibility({
        signatureValid: verification.signatureValid === true,
        senderTrusted: verification.senderTrusted,
        allowUnsafeHtml: this.options.allowUnsafeHtml ?? false
      });
      return eligibility.eligible
        ? { outcome: 'accept-unsafe', reasons: [], effectiveCapabilities: [] }
        : { outcome: 'downgrade', reasons: eligibility.reasons, effectiveCapabilities: [] };
    }

    const requested = proposal.requestedCapabilities.map((c) => c.capability);
    const approved = [...(this.options.autoApprove ?? []), ...userApprovedCapabilities];
    const effectiveCapabilities = intersectCapabilities(requested, this.options.capabilityPolicy, approved);

    return { outcome: 'accept-safe', reasons: [], effectiveCapabilities };
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
