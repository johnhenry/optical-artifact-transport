import {
  buildArtifact,
  extractPayload,
  verifyDigest,
  type ArtifactDigest,
  type BuildArtifactOptions,
  type OatArtifact
} from '@johnhenry/oat-protocol';
import { assertVerified, type BootstrapVerification } from './require-verified.js';

export const RELEASE_MANIFEST_MEDIA_TYPE = 'application/vnd.oat.release-manifest+json';

export interface ReleaseArtifactEntry {
  name: string;
  mediaType: string;
  size: number;
  digest: ArtifactDigest;
  /** Tried in order; the first mirror that responds and verifies wins. */
  urls: string[];
}

export interface ReleaseManifest {
  version: 1;
  name: string;
  releaseId: string;
  artifacts: ReleaseArtifactEntry[];
}

interface ReleaseArtifactEntryJson {
  name: string;
  mediaType: string;
  size: number;
  digestAlgorithm: string;
  digestHex: string;
  urls: string[];
}

interface ReleaseManifestJson {
  version: 1;
  name: string;
  releaseId: string;
  artifacts: ReleaseArtifactEntryJson[];
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error('release-manifest: malformed hex digest');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Manifests transit as JSON (not canonical CBOR) — digests are hex-encoded since JSON has no binary type. */
export function serializeManifest(manifest: ReleaseManifest): Uint8Array {
  const json: ReleaseManifestJson = {
    version: 1,
    name: manifest.name,
    releaseId: manifest.releaseId,
    artifacts: manifest.artifacts.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      size: a.size,
      digestAlgorithm: a.digest.algorithm,
      digestHex: toHex(a.digest.value),
      urls: a.urls
    }))
  };
  return new TextEncoder().encode(JSON.stringify(json));
}

export function deserializeManifest(bytes: Uint8Array): ReleaseManifest {
  const json = JSON.parse(new TextDecoder().decode(bytes)) as ReleaseManifestJson;
  if (json.version !== 1 || !Array.isArray(json.artifacts)) {
    throw new Error('release-manifest: malformed manifest JSON');
  }
  return {
    version: 1,
    name: json.name,
    releaseId: json.releaseId,
    artifacts: json.artifacts.map((a) => ({
      name: a.name,
      mediaType: a.mediaType,
      size: a.size,
      digest: { algorithm: a.digestAlgorithm as ArtifactDigest['algorithm'], value: fromHex(a.digestHex) },
      urls: a.urls
    }))
  };
}

export function buildReleaseManifestArtifact(
  manifest: ReleaseManifest,
  options: Omit<BuildArtifactOptions, 'mediaType' | 'payload'> = {}
): Promise<OatArtifact> {
  return buildArtifact({ ...options, mediaType: RELEASE_MANIFEST_MEDIA_TYPE, payload: serializeManifest(manifest) });
}

/**
 * `verification` must come from `verifyReceivedArtifact`/`verifyArtifact`
 * having already run on `artifact` — this refuses to extract from anything
 * without an affirmatively verified signature, since a manifest's `urls`
 * drive real outbound HTTP requests (see `fetchAndVerifyReleaseArtifact`).
 */
export async function extractReleaseManifest(
  artifact: OatArtifact,
  verification: BootstrapVerification
): Promise<ReleaseManifest> {
  assertVerified(verification, 'release-manifest');
  if (artifact.mediaType !== RELEASE_MANIFEST_MEDIA_TYPE) {
    throw new Error(`release-manifest: not a release-manifest artifact (mediaType=${artifact.mediaType})`);
  }
  return deserializeManifest(await extractPayload(artifact));
}

export interface FetchVerifyOptions {
  fetchImpl?: typeof fetch;
  /** Resource-exhaustion guard from the design doc's security model — default 100 MiB. */
  maxBytes?: number;
  /**
   * `entry.urls` travels over the optical channel under the sender's
   * control — restricting which schemes are fetchable mirrors the same
   * allowlist `@johnhenry/oat-ui`'s sanitizer already applies to sender-controlled
   * `href`/`src` values. Defaults to `['https:']`, matching this module's
   * own "ordinary HTTPS" design intent; widen deliberately if you need to.
   */
  allowedUrlSchemes?: string[];
}

export interface FetchVerifyResult {
  entry: ReleaseArtifactEntry;
  bytes: Uint8Array;
  urlUsed: string;
}

/**
 * Downloads and hash-verifies one manifest entry, trying `entry.urls` in
 * order until one both responds and matches the manifest's declared size
 * and digest. This is the "optical bootstrap unlocks a faster follow-up
 * transport" flow: the manifest itself came over the optical channel
 * (small, signed), the actual bytes come over ordinary HTTPS.
 */
export async function fetchAndVerifyReleaseArtifact(
  entry: ReleaseArtifactEntry,
  options: FetchVerifyOptions = {}
): Promise<FetchVerifyResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const allowedUrlSchemes = options.allowedUrlSchemes ?? ['https:'];
  const errors: string[] = [];

  for (const url of entry.urls) {
    try {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        errors.push(`${url}: not a valid absolute URL`);
        continue;
      }
      if (!allowedUrlSchemes.includes(parsed.protocol)) {
        errors.push(`${url}: scheme "${parsed.protocol}" not in allowedUrlSchemes (${allowedUrlSchemes.join(', ')})`);
        continue;
      }

      const response = await doFetch(url);
      if (!response.ok) {
        errors.push(`${url}: HTTP ${response.status}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > maxBytes) {
        errors.push(`${url}: exceeds maxBytes (${bytes.length} > ${maxBytes})`);
        continue;
      }
      if (bytes.length !== entry.size) {
        errors.push(`${url}: size mismatch (expected ${entry.size}, got ${bytes.length})`);
        continue;
      }
      if (!verifyDigest(bytes, entry.digest)) {
        errors.push(`${url}: digest mismatch`);
        continue;
      }
      return { entry, bytes, urlUsed: url };
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
    }
  }

  throw new Error(`fetchAndVerifyReleaseArtifact: all mirrors failed for "${entry.name}": ${errors.join('; ')}`);
}

export async function fetchAndVerifyManifest(
  manifest: ReleaseManifest,
  options: FetchVerifyOptions = {}
): Promise<FetchVerifyResult[]> {
  const results: FetchVerifyResult[] = [];
  for (const entry of manifest.artifacts) {
    results.push(await fetchAndVerifyReleaseArtifact(entry, options));
  }
  return results;
}
