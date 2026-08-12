import { ed25519 } from '@noble/curves/ed25519';
import type { ArtifactSignature } from './artifact.js';

export interface Ed25519KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateSigningKey(): Ed25519KeyPair {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function signPayload(
  secretKey: Uint8Array,
  payload: Uint8Array,
  keyId?: string
): ArtifactSignature {
  const publicKey = ed25519.getPublicKey(secretKey);
  const value = ed25519.sign(payload, secretKey);
  return { algorithm: 'ed25519', keyId, publicKey, value };
}

export function verifySignature(payload: Uint8Array, signature: ArtifactSignature): boolean {
  if (signature.algorithm !== 'ed25519') return false;
  try {
    return ed25519.verify(signature.value, payload, signature.publicKey);
  } catch {
    return false;
  }
}
