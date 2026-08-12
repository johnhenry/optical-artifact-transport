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
