export type OpticalSource =
  | Blob
  | Uint8Array
  | ArrayBuffer
  | string
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface ResolvedSource {
  bytes: Uint8Array;
  mediaType?: string;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('/') || value.startsWith('./') || value.startsWith('../');
}

async function collectAsyncIterable(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    total += chunk.length;
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
 * Normalizes any supported `<optical-send>` source into concrete bytes.
 * Streaming sources are fully buffered before encoding starts — this MVP's
 * fountain coding needs the complete source up front to compute block
 * boundaries; true streaming (encode-while-receiving) is a future extension.
 */
export async function resolveSource(
  source: OpticalSource,
  hintMediaType?: string
): Promise<ResolvedSource> {
  if (source instanceof Uint8Array) return { bytes: source, mediaType: hintMediaType };
  if (source instanceof ArrayBuffer) return { bytes: new Uint8Array(source), mediaType: hintMediaType };

  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const buf = await source.arrayBuffer();
    return { bytes: new Uint8Array(buf), mediaType: hintMediaType ?? (source.type || undefined) };
  }

  if (typeof ReadableStream !== 'undefined' && source instanceof ReadableStream) {
    return { bytes: await collectAsyncIterable(source as unknown as AsyncIterable<Uint8Array>), mediaType: hintMediaType };
  }

  if (typeof source === 'string') {
    if (looksLikeUrl(source)) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`optical-send: failed to fetch src "${source}": HTTP ${response.status}`);
      }
      const buf = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buf),
        mediaType: hintMediaType ?? response.headers.get('content-type') ?? undefined
      };
    }
    return { bytes: new TextEncoder().encode(source), mediaType: hintMediaType ?? 'text/plain' };
  }

  if (source && typeof source === 'object' && Symbol.asyncIterator in source) {
    return { bytes: await collectAsyncIterable(source), mediaType: hintMediaType };
  }

  throw new Error('optical-send: unsupported source type');
}
