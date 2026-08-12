import { sha256 } from '@noble/hashes/sha256';
import type { ArtifactDigest } from './artifact.js';

export function computeDigest(bytes: Uint8Array): ArtifactDigest {
  return { algorithm: 'sha256', value: sha256(bytes) };
}

export function verifyDigest(bytes: Uint8Array, digest: ArtifactDigest): boolean {
  if (digest.algorithm !== 'sha256') return false;
  const actual = sha256(bytes);
  return constantTimeEqual(actual, digest.value);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}
