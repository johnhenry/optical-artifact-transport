/**
 * A single fountain-coded LT packet: the XOR of `neighborsForSeed(seed, k)`
 * source blocks. Independently decodable given only the packet bytes — a
 * receiver never needs to have seen any particular earlier frame.
 */
export interface OatPacket {
  version: 1;
  /** Identifies which artifact/transfer session this packet belongs to. */
  artifactId: Uint8Array; // 16 bytes
  codec: 'qr-fountain';
  fecScheme: 'lt';
  /** 32-bit PRNG seed determining this packet's neighbor block set. */
  seed: number;
  sourceBlockCount: number;
  blockSize: number;
  /** Original (pre-padding) byte length of the encoded artifact. */
  totalLength: number;
  payload: Uint8Array; // length === blockSize
}

const HEADER_LENGTH = 1 + 16 + 1 + 4 + 4 + 4 + 4; // version+artifactId+fec+seed+k+blockSize+totalLength
const FEC_SCHEME_LT = 1;

/**
 * Sane ceilings for `sourceBlockCount`/`blockSize`/`totalLength`, enforced by
 * `decodePacket` *before* any of these attacker-controlled `uint32` fields
 * can reach `FountainDecoder`'s constructor. That constructor does
 * `O(sourceBlockCount)` work (array allocation plus `robustSolitonTable`),
 * synchronously, on the receiver's main thread, before any signature/digest
 * verification happens — so an unbounded `sourceBlockCount` is a one-frame
 * pre-auth DoS. `MAX_TOTAL_LENGTH` mirrors the 100 MiB "maximum artifact
 * size" convention already used elsewhere (see
 * `packages/bootstrap/src/release-manifest.ts`'s `maxBytes` default), per
 * the design doc's security model. `MAX_SOURCE_BLOCK_COUNT` and
 * `MAX_BLOCK_SIZE` are generous relative to any legitimate transfer (real QR
 * frames carry at most a few KB of payload per packet) but far below
 * anything that makes `robustSolitonTable`/array allocation expensive.
 */
export const MAX_TOTAL_LENGTH = 100 * 1024 * 1024; // 100 MiB
export const MAX_SOURCE_BLOCK_COUNT = 65_536;
export const MAX_BLOCK_SIZE = 65_536;

/** Packs a packet into a compact fixed-header binary frame for QR encoding. */
export function encodePacket(packet: OatPacket): Uint8Array {
  if (packet.artifactId.length !== 16) {
    throw new Error('artifactId must be exactly 16 bytes');
  }
  const out = new Uint8Array(HEADER_LENGTH + packet.blockSize);
  const view = new DataView(out.buffer);
  let offset = 0;

  out[offset] = packet.version;
  offset += 1;

  out.set(packet.artifactId, offset);
  offset += 16;

  out[offset] = FEC_SCHEME_LT;
  offset += 1;

  view.setUint32(offset, packet.seed >>> 0, false);
  offset += 4;
  view.setUint32(offset, packet.sourceBlockCount, false);
  offset += 4;
  view.setUint32(offset, packet.blockSize, false);
  offset += 4;
  view.setUint32(offset, packet.totalLength, false);
  offset += 4;

  out.set(packet.payload, offset);
  return out;
}

/** Inverse of `encodePacket`. Returns `null` for malformed/foreign frames. */
export function decodePacket(bytes: Uint8Array): OatPacket | null {
  if (bytes.length < HEADER_LENGTH) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  const version = bytes[offset] as number;
  if (version !== 1) return null;
  offset += 1;

  const artifactId = bytes.slice(offset, offset + 16);
  offset += 16;

  const fecScheme = bytes[offset] as number;
  if (fecScheme !== FEC_SCHEME_LT) return null;
  offset += 1;

  const seed = view.getUint32(offset, false);
  offset += 4;
  const sourceBlockCount = view.getUint32(offset, false);
  offset += 4;
  const blockSize = view.getUint32(offset, false);
  offset += 4;
  const totalLength = view.getUint32(offset, false);
  offset += 4;

  // Reject before any of these fields can drive `O(sourceBlockCount)` work
  // (see `FountainDecoder`'s constructor) — this must happen before the
  // packet is ever handed to a decoder, not merely before reconstruction.
  if (sourceBlockCount === 0 || sourceBlockCount > MAX_SOURCE_BLOCK_COUNT) return null;
  if (blockSize === 0 || blockSize > MAX_BLOCK_SIZE) return null;
  if (totalLength > MAX_TOTAL_LENGTH) return null;

  if (bytes.length !== HEADER_LENGTH + blockSize) return null;
  const payload = bytes.slice(offset);

  return {
    version: 1,
    artifactId,
    codec: 'qr-fountain',
    fecScheme: 'lt',
    seed,
    sourceBlockCount,
    blockSize,
    totalLength,
    payload
  };
}
