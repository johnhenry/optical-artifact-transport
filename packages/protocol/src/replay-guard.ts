import type { OatArtifact } from './artifact.js';

export interface ReplayGuardOptions {
  /** Upper bound on remembered nonces; the oldest are evicted first. Default 1024. */
  maxEntries?: number;
}

/**
 * Receiver-side memory of artifact nonces already accepted.
 *
 * Guarantees and limits: it is per-receiver and per-lifetime (in memory — a
 * reload or a second device starts empty), and bounded, so under a flood of
 * distinct nonces the oldest are evicted. Eviction cannot reopen replay
 * forever, because every artifact also carries a mandatory expiry; entries
 * for already-expired artifacts are dropped eagerly since they can no longer
 * verify. Pair with `expectedSessionId` for binding to a specific transfer.
 */
export interface ReplayGuard {
  /** True if this artifact's nonce was already recorded — or if it has no nonce at all (fail closed). */
  has(artifact: OatArtifact): boolean;
  /** Records the artifact's nonce. A no-op for artifacts without one. */
  add(artifact: OatArtifact): void;
  readonly size: number;
}

export const DEFAULT_REPLAY_GUARD_ENTRIES = 1024;

export function createReplayGuard(options: ReplayGuardOptions = {}): ReplayGuard {
  const maxEntries = options.maxEntries ?? DEFAULT_REPLAY_GUARD_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error('createReplayGuard: maxEntries must be a positive integer');
  }
  // Map preserves insertion order: first key = oldest. Value = expiry ms (or Infinity).
  const seen = new Map<string, number>();

  const purgeExpired = (): void => {
    const now = Date.now();
    for (const [nonce, expiresMs] of seen) {
      if (expiresMs < now) seen.delete(nonce);
    }
  };

  return {
    has(artifact) {
      if (typeof artifact.nonce !== 'string' || artifact.nonce === '') return true;
      return seen.has(artifact.nonce);
    },
    add(artifact) {
      if (typeof artifact.nonce !== 'string' || artifact.nonce === '') return;
      purgeExpired();
      const expiresMs = artifact.expiresAt ? Date.parse(artifact.expiresAt) : Number.POSITIVE_INFINITY;
      seen.set(artifact.nonce, Number.isNaN(expiresMs) ? Number.POSITIVE_INFINITY : expiresMs);
      while (seen.size > maxEntries) {
        const oldest = seen.keys().next().value as string;
        seen.delete(oldest);
      }
    },
    get size() {
      return seen.size;
    }
  };
}
