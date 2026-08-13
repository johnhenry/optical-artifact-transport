import { verifyArtifact, type OatArtifact, type VerificationResult } from '@oat/protocol';

export interface ReceiverVerificationOptions {
  requireSignature?: boolean;
  /** Media types this receiver will accept; `undefined`/empty means "accept anything". */
  acceptMediaTypes?: string[];
  /**
   * Trusted sender public keys (hex-encoded), for signed artifacts. When
   * empty *and* `requireExplicitTrust` is not set, this means "trust any
   * valid signature" (the permissive default). Set `requireExplicitTrust`
   * for TOFU-style flows where an empty list should mean "nothing trusted
   * yet", not "trust everyone".
   */
  trustedPublicKeysHex?: string[];
  /**
   * Disables the "empty trust list = trust any signature" default. With
   * this set, a signer must be explicitly present in `trustedPublicKeysHex`
   * — including when that list is empty — to be considered trusted. Pairs
   * with `<optical-receive>`'s `trustSenderAndContinue()`/
   * `rejectUnknownSender()` for a first-contact confirmation flow.
   */
  requireExplicitTrust?: boolean;
}

export interface ReceiverVerificationResult extends VerificationResult {
  mediaTypeAccepted: boolean;
  senderTrusted: boolean;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Wraps `@oat/protocol`'s `verifyArtifact` with the receiver-side checks
 * that live outside the protocol layer by design: whether this receiver
 * even accepts the artifact's media type, and whether the signer is one
 * this receiver recognizes.
 */
export function verifyReceivedArtifact(
  artifact: OatArtifact,
  options: ReceiverVerificationOptions = {}
): ReceiverVerificationResult {
  const base = verifyArtifact(artifact, { requireSignature: options.requireSignature });

  const mediaTypeAccepted =
    !options.acceptMediaTypes || options.acceptMediaTypes.length === 0
      ? true
      : options.acceptMediaTypes.includes(artifact.mediaType);

  const trustList = options.trustedPublicKeysHex ?? [];
  let senderTrusted = true;
  if (trustList.length > 0 || options.requireExplicitTrust) {
    senderTrusted = Boolean(artifact.signature && trustList.includes(toHex(artifact.signature.publicKey)));
  }

  const reasons = [...base.reasons];
  if (!mediaTypeAccepted) reasons.push('media-type-rejected');
  if (!senderTrusted) reasons.push('sender-untrusted');

  return {
    ...base,
    valid: base.valid && mediaTypeAccepted && senderTrusted,
    reasons,
    mediaTypeAccepted,
    senderTrusted
  };
}
