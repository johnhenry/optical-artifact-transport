import type {
  ArtifactEncryption,
  CompressionScheme,
  OatArtifact,
  SignablePayloadFields
} from './artifact.js';
import type { UiProposalEnvelope } from './ui-proposal.js';
import { compress, decompress } from './compression.js';
import { computeDigest, verifyDigest } from './digest.js';
import { encodeCanonical } from './canonical-cbor.js';
import { randomId } from './random-id.js';
import { signPayload, verifySignature } from './signatures.js';

export interface BuildArtifactOptions {
  mediaType: string;
  payload: Uint8Array;
  id?: string;
  createdAt?: string;
  expiresAt?: string;
  compression?: CompressionScheme;
  sign?: { secretKey: Uint8Array; keyId?: string };
  encryption?: ArtifactEncryption;
  uiProposal?: UiProposalEnvelope;
  metadata?: Record<string, unknown>;
}

/**
 * Compresses, digests, and (optionally) signs `options.payload` into a
 * complete `OatArtifact`. The signature — when requested — covers the
 * canonical CBOR encoding of every field except `signature` itself,
 * including the digest, so payload and digest cannot be swapped together
 * without invalidating it.
 */
export async function buildArtifact(options: BuildArtifactOptions): Promise<OatArtifact> {
  const compression = options.compression ?? 'none';
  const compressed = await compress(options.payload, compression);
  const digest = computeDigest(compressed);

  const base: SignablePayloadFields = {
    version: 1,
    id: options.id ?? randomId(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    expiresAt: options.expiresAt,
    mediaType: options.mediaType,
    payload: compressed,
    compression,
    digest,
    encryption: options.encryption,
    uiProposal: options.uiProposal,
    metadata: options.metadata
  };

  if (!options.sign) return base;

  const signBytes = encodeCanonical(base);
  const signature = signPayload(options.sign.secretKey, signBytes, options.sign.keyId);
  return { ...base, signature };
}

export interface VerificationResult {
  valid: boolean;
  digestValid: boolean;
  signatureValid: boolean | 'absent';
  expired: boolean;
  /** Machine-readable failure reasons, e.g. ['digest-mismatch', 'expired']. */
  reasons: string[];
}

/**
 * Verifies digest, signature (if present or required), and expiry. Never
 * throws — a malformed artifact simply fails verification with reasons.
 */
export function verifyArtifact(
  artifact: OatArtifact,
  opts: { requireSignature?: boolean } = {}
): VerificationResult {
  const reasons: string[] = [];

  const digestValid = verifyDigest(artifact.payload, artifact.digest);
  if (!digestValid) reasons.push('digest-mismatch');

  let signatureValid: boolean | 'absent' = 'absent';
  if (artifact.signature) {
    const { signature, ...rest } = artifact;
    signatureValid = verifySignature(encodeCanonical(rest), signature);
    if (!signatureValid) reasons.push('signature-invalid');
  } else if (opts.requireSignature) {
    reasons.push('signature-required');
  }

  const expired = Boolean(artifact.expiresAt && Date.now() > Date.parse(artifact.expiresAt));
  if (expired) reasons.push('expired');

  const signatureOk = artifact.signature ? signatureValid === true : !opts.requireSignature;
  const valid = digestValid && signatureOk && !expired;

  return { valid, digestValid, signatureValid, expired, reasons };
}

/**
 * Decompresses `artifact.payload` back to its original bytes. `maxOutputBytes`
 * bounds the decompressed size (default: `decompress`'s
 * `DEFAULT_MAX_DECOMPRESSED_BYTES`, 100 MiB) as a guard against a "gzip
 * bomb" — a small, highly-compressible attacker-controlled payload that
 * expands to consume unbounded memory/CPU.
 */
export function extractPayload(artifact: OatArtifact, maxOutputBytes?: number): Promise<Uint8Array> {
  return maxOutputBytes === undefined
    ? decompress(artifact.payload, artifact.compression ?? 'none')
    : decompress(artifact.payload, artifact.compression ?? 'none', maxOutputBytes);
}
