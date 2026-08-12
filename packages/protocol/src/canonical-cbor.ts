import { Encoder, Decoder } from 'cbor-x';

// cbor-x preserves the iteration order of native `Map` instances when
// encoding, so canonical determinism is achieved by recursively converting
// plain objects into `Map`s with lexicographically (byte-wise) sorted keys
// before encoding, rather than relying on JS object key insertion order.

const encoder = new Encoder({ mapsAsObjects: false, useRecords: false, tagUint8Array: false });
const decoder = new Decoder({ mapsAsObjects: false, useRecords: false, tagUint8Array: false });

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Map) {
    const sortedKeys = [...value.keys()].map(String).sort();
    const out = new Map<string, unknown>();
    for (const key of sortedKeys) out.set(key, canonicalize(value.get(key)));
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out = new Map<string, unknown>();
  for (const [k, v] of entries) out.set(k, canonicalize(v));
  return out;
}

function mapsToObjects(value: unknown): unknown {
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value) out[String(k)] = mapsToObjects(v);
    return out;
  }
  if (Array.isArray(value)) return value.map(mapsToObjects);
  return value;
}

/** Deterministically encodes `value` as canonical CBOR (sorted map keys at every level). */
export function encodeCanonical(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

/** Decodes CBOR produced by `encodeCanonical`, returning plain objects (not `Map`s). */
export function decodeCanonical(bytes: Uint8Array): unknown {
  return mapsToObjects(decoder.decode(bytes));
}
