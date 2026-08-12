import { chooseNeighbors, mulberry32, robustSolitonTable, sampleDegree } from './lt.js';
import type { OatPacket } from './packet.js';

export interface FountainSource {
  artifactId: Uint8Array;
  sourceBlockCount: number;
  blockSize: number;
  totalLength: number;
  blocks: Uint8Array[];
}

/** Splits `bytes` into fixed-size, zero-padded source blocks ready for fountain coding. */
export function prepareSource(
  bytes: Uint8Array,
  blockSize: number,
  artifactId: Uint8Array
): FountainSource {
  if (blockSize <= 0) throw new Error('blockSize must be positive');
  const k = Math.max(1, Math.ceil(bytes.length / blockSize));
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < k; i++) {
    const block = new Uint8Array(blockSize);
    const start = i * blockSize;
    block.set(bytes.subarray(start, Math.min(start + blockSize, bytes.length)));
    blocks.push(block);
  }
  return { artifactId, sourceBlockCount: k, blockSize, totalLength: bytes.length, blocks };
}

/**
 * Infinite generator of independently-decodable LT packets for `source`.
 * Pass a deterministic `nextSeed` (e.g. a counter-derived PRNG) in tests for
 * reproducible fixtures; defaults to `Math.random()`-derived seeds.
 */
export function* generatePackets(
  source: FountainSource,
  nextSeed: () => number = () => Math.floor(Math.random() * 0xffffffff)
): Generator<OatPacket, never, void> {
  const cumulative = robustSolitonTable(source.sourceBlockCount);
  for (;;) {
    const seed = nextSeed() >>> 0;
    const rand = mulberry32(seed);
    const degree = sampleDegree(cumulative, rand);
    const neighbors = chooseNeighbors(source.sourceBlockCount, degree, rand);

    const payload = new Uint8Array(source.blockSize);
    for (const idx of neighbors) {
      const block = source.blocks[idx] as Uint8Array;
      for (let b = 0; b < payload.length; b++) {
        payload[b] = (payload[b] as number) ^ (block[b] as number);
      }
    }

    yield {
      version: 1,
      artifactId: source.artifactId,
      codec: 'qr-fountain',
      fecScheme: 'lt',
      seed,
      sourceBlockCount: source.sourceBlockCount,
      blockSize: source.blockSize,
      totalLength: source.totalLength,
      payload
    };
  }
}

/** Counter-based seed generator — useful for deterministic tests. */
export function counterSeeds(start = 1): () => number {
  let n = start >>> 0;
  return () => n++;
}
