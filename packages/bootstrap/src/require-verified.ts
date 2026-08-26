import type { VerificationResult } from '@johnhenry/oat-protocol';

/**
 * The minimal proof callers must supply before any bootstrap payload is
 * trusted. Deliberately *not* `Pick<VerificationResult, ...>`: the
 * protocol-level `VerificationResult` has no notion of sender identity at
 * all (only `@johnhenry/oat-receiver`'s `verifyReceivedArtifact` computes
 * that, against an explicit `trustedPublicKeysHex` allowlist), so
 * `senderTrusted` is declared here as its own required field. This forces
 * every caller to make an affirmative sender-trust decision — e.g. via
 * `verifyReceivedArtifact`'s `trustedPublicKeysHex`/`requireExplicitTrust`,
 * or an equivalent local trust check — rather than silently defaulting to
 * "any signature will do."
 */
export interface BootstrapVerification {
  valid: VerificationResult['valid'];
  signatureValid: VerificationResult['signatureValid'];
  /**
   * True only when the signer is on the caller's explicit trust list, not
   * merely that *some* key signed the content — anyone can call
   * `generateSigningKey()` and self-sign. Mirrors
   * `checkSandboxEligibility`'s `senderTrusted` input
   * (`packages/protocol/src/sandbox-eligibility.ts`), which gates M6's
   * unsafe-HTML break-glass path the same way; bootstrap side effects
   * (WebRTC session hijack, manifest-driven HTTP fetches) are no less
   * sensitive and get the same bar.
   */
  senderTrusted: boolean;
}

/**
 * Every bootstrap payload (a release manifest, a WebRTC offer/answer)
 * triggers a real side effect the instant it's trusted — an HTTP fetch to a
 * sender-chosen URL, or applying sender-chosen WebRTC session data via
 * `setRemoteDescription`/`addIceCandidate`. Unlike a plain artifact
 * delivery (where `<optical-receive>` itself gates the `oat-artifact` event
 * on `verification.valid`), these extract/apply functions are meant to be
 * called directly by application code, so — rather than relying on every
 * caller to remember a doc-comment — they enforce their own gate:
 *
 * - `valid`/`signatureValid` alone isn't enough, since an unsigned artifact
 *   with `requireSignature: false` is still "valid", and any attacker can
 *   self-sign with a freshly generated key. A bootstrap payload requires an
 *   affirmatively verified signature *from a sender the caller trusts* —
 *   `senderTrusted`, not just `signatureValid` — matching the design doc's
 *   distinction between "integrity verified" and "identity verified."
 */
export function assertVerified(verification: BootstrapVerification, context: string): void {
  if (!verification.valid || verification.signatureValid !== true) {
    throw new Error(`${context}: refusing to process an unsigned or unverified artifact`);
  }
  if (!verification.senderTrusted) {
    throw new Error(`${context}: refusing to process an artifact from an untrusted sender`);
  }
}
