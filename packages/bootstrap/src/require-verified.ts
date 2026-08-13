import type { VerificationResult } from '@oat/protocol';

/** The minimal proof callers must supply before any bootstrap payload is trusted. */
export type BootstrapVerification = Pick<VerificationResult, 'valid' | 'signatureValid'>;

/**
 * Every bootstrap payload (a release manifest, a WebRTC offer/answer)
 * triggers a real side effect the instant it's trusted — an HTTP fetch to a
 * sender-chosen URL, or applying sender-chosen WebRTC session data via
 * `setRemoteDescription`/`addIceCandidate`. Unlike a plain artifact
 * delivery (where `<optical-receive>` itself gates the `oat-artifact` event
 * on `verification.valid`), these extract/apply functions are meant to be
 * called directly by application code, so — rather than relying on every
 * caller to remember a doc-comment — they enforce their own gate: `valid`
 * alone isn't enough, since an unsigned artifact with `requireSignature:
 * false` is still "valid". A bootstrap payload specifically requires an
 * affirmatively verified signature.
 */
export function assertVerified(verification: BootstrapVerification, context: string): void {
  if (!verification.valid || verification.signatureValid !== true) {
    throw new Error(`${context}: refusing to process an unsigned or unverified artifact`);
  }
}
