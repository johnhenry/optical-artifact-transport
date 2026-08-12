import {
  intersectCapabilities,
  type CapabilityPolicy,
  type UiProposalEnvelope
} from '@oat/protocol';
import type { ReceiverVerificationResult } from './verifier.js';

export type UiDecisionOutcome = 'reject' | 'downgrade' | 'accept-safe';

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
}

/**
 * Decides what a receiver does with a sender-proposed UI. This never grants
 * "accept-unsafe" (raw HTML in an isolated sandbox) — that's the M6
 * break-glass profile and is out of scope for this implementation pass; any
 * proposal requesting `sandboxed-html`/`trusted-html` is downgraded instead
 * of rejected outright, since the artifact itself may still be legitimate.
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

    if (proposal.requestedProfile === 'sandboxed-html' || proposal.requestedProfile === 'trusted-html') {
      return { outcome: 'downgrade', reasons: ['unsafe-profile-not-supported'], effectiveCapabilities: [] };
    }

    const requested = proposal.requestedCapabilities.map((c) => c.capability);
    const approved = [...(this.options.autoApprove ?? []), ...userApprovedCapabilities];
    const effectiveCapabilities = intersectCapabilities(requested, this.options.capabilityPolicy, approved);

    return { outcome: 'accept-safe', reasons: [], effectiveCapabilities };
  }
}
