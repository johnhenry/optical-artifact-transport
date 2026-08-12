import { verifyArtifact, type OatArtifact, type VerificationResult } from '@oat/protocol';

export interface ReceiverVerificationOptions {
  requireSignature?: boolean;
  /** Media types this receiver will accept; `undefined`/empty means "accept anything". */
  acceptMediaTypes?: string[];
  /** Trusted sender public keys (hex-encoded), for signed artifacts. Empty means "trust any valid signature". */
  trustedPublicKeysHex?: string[];
}

export interface ReceiverVerificationResult extends VerificationResult {
  mediaTypeAccepted: boolean;
  senderTrusted: boolean;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Wraps `@oat/protocol`'s `verifyArtifact` with the receiver-side checks
 * that live outside the protocol layer by design: whether this receiver
 * even accepts the artifact's media type, and (when a trust list is
 * configured) whether the signer is one this receiver recognizes.
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

  let senderTrusted = true;
  if (options.trustedPublicKeysHex && options.trustedPublicKeysHex.length > 0) {
    senderTrusted = Boolean(
      artifact.signature && options.trustedPublicKeysHex.includes(toHex(artifact.signature.publicKey))
    );
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
