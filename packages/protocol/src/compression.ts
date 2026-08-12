import type { CompressionScheme } from './artifact.js';

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const input = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  const chunks: Uint8Array[] = [];
  for await (const chunk of input as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * `gzip` is implemented via the standard `CompressionStream`/`DecompressionStream`
 * APIs, available in modern browsers and Node >= 18. `brotli`/`zstd` are part
 * of the protocol enum for forward compatibility but are not implemented yet.
 */
export async function compress(bytes: Uint8Array, scheme: CompressionScheme): Promise<Uint8Array> {
  if (scheme === 'none') return bytes;
  if (scheme === 'gzip') return pipeThrough(bytes, new CompressionStream('gzip'));
  throw new Error(`compression scheme not implemented: ${scheme}`);
}

export async function decompress(bytes: Uint8Array, scheme: CompressionScheme): Promise<Uint8Array> {
  if (scheme === 'none') return bytes;
  if (scheme === 'gzip') return pipeThrough(bytes, new DecompressionStream('gzip'));
  throw new Error(`compression scheme not implemented: ${scheme}`);
}
