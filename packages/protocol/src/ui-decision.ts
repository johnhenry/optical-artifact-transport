import { buildArtifact, extractPayload, type BuildArtifactOptions } from './manifest.js';
import type { OatArtifact } from './artifact.js';

export const UI_DECISION_MEDIA_TYPE = 'application/vnd.oat.ui-decision+json';

export type UiDecisionStatus = 'accepted' | 'downgraded' | 'rejected';

export interface DeniedCapability {
  capability: string;
  reason: string;
}

/**
 * The wire-level acknowledgment a receiver may send back to a sender after
 * evaluating a `UiProposalEnvelope` — the "ui.decision" response from the
 * design doc's acceptance algorithm (step 7: "Send the sender a signed/
 * structured `ui.decision` response describing grants, denials, downgrade
 * reason, and a session-scoped capability token").
 *
 * This type only describes the payload; how it physically travels back is
 * up to the host application — optically via a second `<optical-send>`,
 * over a bootstrap channel (`@oat/bootstrap`'s WebRTC data channel), or any
 * other transport. Nothing here assumes a specific return path.
 */
export interface UiDecision {
  type: 'ui.decision';
  version: 1;
  proposalId: string;
  status: UiDecisionStatus;
  profile?: 'safe-view' | 'safe-html' | 'sandboxed-html';
  grantedCapabilities: string[];
  deniedCapabilities: DeniedCapability[];
  sanitized: boolean;
  fallbackUsed: boolean;
  /**
   * An opaque, receiver-generated correlation identifier for this specific
   * grant. It is *not* a bearer credential or cryptographic capability
   * token — it exists so a sender can reference "the grant from decision
   * X" in a later interaction; the receiver alone still enforces every
   * capability check independently, every time.
   */
  capabilityToken?: string;
  decidedAt: string;
}

/** Wraps a `UiDecision` as a (optionally signed) `OatArtifact` ready to transmit back to the sender. */
export function buildUiDecisionArtifact(decision: UiDecision, sign?: BuildArtifactOptions['sign']): Promise<OatArtifact> {
  const payload = new TextEncoder().encode(JSON.stringify(decision));
  return buildArtifact({ mediaType: UI_DECISION_MEDIA_TYPE, payload, sign });
}

/**
 * `verification` must come from `verifyArtifact`/`verifyReceivedArtifact`
 * having already run on `artifact` — a `ui.decision` claiming capabilities
 * were granted is exactly the kind of thing that shouldn't be trusted
 * without a verified signature.
 */
export async function extractUiDecision(
  artifact: OatArtifact,
  verification: { valid: boolean; signatureValid: boolean | 'absent' }
): Promise<UiDecision> {
  if (!verification.valid || verification.signatureValid !== true) {
    throw new Error('ui-decision: refusing to process an unsigned or unverified decision artifact');
  }
  if (artifact.mediaType !== UI_DECISION_MEDIA_TYPE) {
    throw new Error(`ui-decision: not a ui-decision artifact (mediaType=${artifact.mediaType})`);
  }

  const bytes = await extractPayload(artifact);
  const decision = JSON.parse(new TextDecoder().decode(bytes)) as UiDecision;
  if (decision.type !== 'ui.decision' || decision.version !== 1) {
    throw new Error('ui-decision: malformed decision payload');
  }
  return decision;
}
