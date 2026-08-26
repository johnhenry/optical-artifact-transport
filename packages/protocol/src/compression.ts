import type { CompressionScheme } from './artifact.js';

/**
 * Default ceiling for decompressed output, matching the codebase's existing
 * 100 MiB "maximum artifact size" convention (see
 * `packages/bootstrap/src/release-manifest.ts`'s `maxBytes` default) and the
 * design doc's security-model call for a "maximum artifact size" control.
 * Guards against a "gzip bomb": a small, highly-compressible optical payload
 * that expands to consume unbounded memory/CPU during decompression.
 */
export const DEFAULT_MAX_DECOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MiB

class DecompressedSizeExceededError extends Error {
  constructor(maxOutputBytes: number) {
    super(`decompressed output exceeds maximum allowed size (${maxOutputBytes} bytes)`);
    this.name = 'DecompressedSizeExceededError';
  }
}

/**
 * Pipes `bytes` through a Compression/DecompressionStream, reading output
 * incrementally so a `maxOutputBytes` ceiling can abort early — mid-stream,
 * as soon as cumulative output crosses the limit — rather than fully
 * inflating a hostile payload and only checking its size afterward.
 */
async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, maxOutputBytes?: number) {
  const input = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of input as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (maxOutputBytes !== undefined && total > maxOutputBytes) {
      throw new DecompressedSizeExceededError(maxOutputBytes);
    }
    chunks.push(chunk);
  }
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

/**
 * `maxOutputBytes` bounds the decompressed output size (default
 * `DEFAULT_MAX_DECOMPRESSED_BYTES`) — pass `Infinity` to disable the guard.
 * Aborts as soon as cumulative decompressed output crosses the ceiling,
 * rather than decompressing fully and checking after the fact.
 */
export async function decompress(
  bytes: Uint8Array,
  scheme: CompressionScheme,
  maxOutputBytes: number = DEFAULT_MAX_DECOMPRESSED_BYTES
): Promise<Uint8Array> {
  if (scheme === 'none') {
    if (bytes.length > maxOutputBytes) throw new DecompressedSizeExceededError(maxOutputBytes);
    return bytes;
  }
  if (scheme === 'gzip') return pipeThrough(bytes, new DecompressionStream('gzip'), maxOutputBytes);
  throw new Error(`compression scheme not implemented: ${scheme}`);
}
