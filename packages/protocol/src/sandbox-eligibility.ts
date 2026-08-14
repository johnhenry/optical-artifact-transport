export interface SandboxEligibility {
  eligible: boolean;
  reasons: string[];
}

export interface SandboxEligibilityInput {
  /** True only when the artifact's signature was independently verified (see `verifyArtifact`). */
  signatureValid: boolean;
  /**
   * True only when the signer is on the receiver's explicit trust list
   * (`verifyReceivedArtifact`'s `senderTrusted`, computed against
   * `trustedPublicKeysHex`). A valid signature alone proves *some* key
   * signed the content — anyone can call `generateSigningKey()` and
   * self-sign — so it is not, on its own, authorization to run arbitrary
   * script. Per the design doc, "sender identity verified" is a condition
   * independent from "content signed".
   */
  senderTrusted: boolean;
  /** The receiver deployment must explicitly opt in; there is no default that enables this. */
  allowUnsafeHtml: boolean;
}

/**
 * Refuses `sandboxed-html` (M6 break-glass) rendering unless every
 * eligibility condition holds. This depends only on receiver-side
 * inputs — a sender requesting `sandboxed-html` cannot influence it. Shared
 * by `@johnhenry/oat-receiver`'s policy engine (which decides the outcome) and
 * `@johnhenry/oat-ui`'s sandbox host (which enforces the same gate before mounting
 * anything) so the two can never disagree.
 */
export function checkSandboxEligibility(input: SandboxEligibilityInput): SandboxEligibility {
  const reasons: string[] = [];
  if (!input.signatureValid) reasons.push('signature-required');
  if (!input.senderTrusted) reasons.push('sender-not-trusted');
  if (!input.allowUnsafeHtml) reasons.push('receiver-policy-disallows-unsafe-html');
  return { eligible: reasons.length === 0, reasons };
}
