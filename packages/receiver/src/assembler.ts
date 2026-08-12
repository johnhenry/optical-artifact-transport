import { decodeCanonical, isOatArtifact, type OatArtifact } from '@oat/protocol';

/**
 * Turns fully-reconstructed fountain bytes back into an `OatArtifact`.
 * Returns `null` (never throws) for bytes that aren't valid canonical CBOR
 * or don't decode to a well-formed artifact — e.g. residual FEC corruption
 * that the LT decoder didn't detect on its own (digest/signature checks in
 * `verifier.ts` are the actual integrity backstop; this step only guards
 * against structurally malformed output).
 */
export function assembleArtifact(bytes: Uint8Array): OatArtifact | null {
  try {
    const decoded = decodeCanonical(bytes);
    return isOatArtifact(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
