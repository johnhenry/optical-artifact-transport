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
  /**
   * True when the artifact must not be used on lifetime grounds: either its
   * `expiresAt` is in the past, or it is present and cannot be read as an
   * instant. `reasons` distinguishes the two (`'expired'` vs
   * `'expires-at-unreadable'`).
   */
  expired: boolean;
  /** Machine-readable failure reasons, e.g. ['digest-mismatch', 'expired']. */
  reasons: string[];
}

/**
 * An ISO-8601 calendar date, which every value `buildArtifact` produces
 * begins with (`new Date().toISOString()`), and which `Date.parse` is
 * required by the language spec to interpret consistently. Anything else
 * `Date.parse` accepts is implementation-defined: V8 reads the string
 * `'42'` as the year 2042 — in local time, no less — so a field a sender
 * filled in as a duration, or a CBOR integer coerced by `String()`, buys
 * a sixteen-year lifetime instead of failing.
 */
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * Decides the lifetime component of verification, failing closed.
 *
 * `expiresAt` used to be read as
 * `Boolean(artifact.expiresAt && Date.now() > Date.parse(artifact.expiresAt))`,
 * which treats every unreadable value as "does not expire":
 * `Date.parse` returns `NaN` for `'not-a-date'` and for `''`, and
 * `NaN > x` is `false`. `expiresAt` is one of the design doc's named core
 * controls ("Expiry, nonce, and session binding") against its listed
 * "Payload replay" threat, and it is the only one of those three that
 * exists in the code at all — so an unreadable value silently disabling it
 * is the wrong direction to fail in.
 *
 * Absent is still absent: an artifact with no `expiresAt` does not expire,
 * which is the documented optional-field behaviour and unchanged.
 */
function evaluateExpiry(expiresAt: unknown): { expired: boolean; reason?: string } {
  if (expiresAt === undefined || expiresAt === null) return { expired: false };
  if (typeof expiresAt !== 'string' || !ISO_DATE_PREFIX.test(expiresAt)) {
    return { expired: true, reason: 'expires-at-unreadable' };
  }
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) return { expired: true, reason: 'expires-at-unreadable' };
  return Date.now() > at ? { expired: true, reason: 'expired' } : { expired: false };
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

  const expiry = evaluateExpiry(artifact.expiresAt);
  const expired = expiry.expired;
  if (expiry.reason) reasons.push(expiry.reason);

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
