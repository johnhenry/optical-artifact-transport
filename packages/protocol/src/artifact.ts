import type { UiProposalEnvelope } from './ui-proposal.js';

export type CompressionScheme = 'none' | 'gzip';

/** Digest algorithms understood by this implementation. */
export type DigestAlgorithm = 'sha256';

export interface ArtifactDigest {
  algorithm: DigestAlgorithm;
  value: Uint8Array;
}

export type SignatureAlgorithm = 'ed25519';

export interface ArtifactSignature {
  algorithm: SignatureAlgorithm;
  keyId?: string;
  publicKey: Uint8Array;
  value: Uint8Array;
}

export interface ArtifactEncryption {
  scheme: string;
  recipientHint?: string;
  keyEnvelope: Uint8Array;
}

/**
 * The canonical artifact envelope. `digest` and `signature` (when present)
 * are computed over the artifact with those two fields themselves excluded
 * — see `manifest.ts` for the exact signing payload construction.
 */
export interface OatArtifact {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt?: string;

  mediaType: string;
  payload: Uint8Array;

  compression?: CompressionScheme;

  digest: ArtifactDigest;
  signature?: ArtifactSignature;
  encryption?: ArtifactEncryption;

  uiProposal?: UiProposalEnvelope;
  metadata?: Record<string, unknown>;
}

/**
 * Fields of `OatArtifact` that are covered by the signature — everything
 * except the `signature` slot itself, so a signature binds the payload
 * bytes *and* their digest (an attacker cannot swap payload+digest together
 * without invalidating the signature).
 */
export type SignablePayloadFields = Omit<OatArtifact, 'signature'>;

export function isOatArtifact(value: unknown): value is OatArtifact {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1 &&
    typeof v.id === 'string' &&
    typeof v.createdAt === 'string' &&
    typeof v.mediaType === 'string' &&
    v.payload instanceof Uint8Array &&
    typeof v.digest === 'object' &&
    v.digest !== null
  );
}
