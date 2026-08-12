import { buildArtifact, type BuildArtifactOptions, type OatArtifact } from '@oat/protocol';

/**
 * Thin seam over `@oat/protocol`'s `buildArtifact` — kept as its own module
 * (matching the design doc's package layout) so sender-specific defaults
 * (e.g. auto-expiry policies) have one obvious place to live as they're
 * added, without `optical-send.ts` growing protocol-level knowledge.
 */
export function buildSenderArtifact(options: BuildArtifactOptions): Promise<OatArtifact> {
  return buildArtifact(options);
}
