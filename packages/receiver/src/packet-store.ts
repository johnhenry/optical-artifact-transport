import { FountainDecoder, type OatPacket } from '@oat/qr-fountain';

function artifactIdHex(id: Uint8Array): string {
  return Array.from(id, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Session-aware wrapper around `FountainDecoder`. Lazily starts a decode
 * session on the first packet seen for a given `artifactId`, and resets if
 * a packet from a *different* artifact arrives (the sender started a new
 * transfer). Also tracks the bookkeeping metrics a scanning UI wants:
 * frames seen, duplicates, and frames that failed to parse as a packet.
 */
export class PacketStore {
  #decoder: FountainDecoder | null = null;
  #artifactId: string | null = null;

  framesSeen = 0;
  duplicateFrames = 0;
  invalidFrames = 0;

  /** Feeds one already-decoded fountain packet in. Returns `true` if the transfer just completed. */
  ingestPacket(packet: OatPacket): boolean {
    const id = artifactIdHex(packet.artifactId);
    if (id !== this.#artifactId) {
      this.#artifactId = id;
      this.#decoder = new FountainDecoder(packet.sourceBlockCount, packet.blockSize, packet.totalLength);
      this.framesSeen = 0;
      this.duplicateFrames = 0;
    }

    this.framesSeen++;
    const decoder = this.#decoder as FountainDecoder;
    const before = decoder.packetsSeen;
    const complete = decoder.addPacket(packet);
    if (decoder.packetsSeen === before) this.duplicateFrames++;
    return complete;
  }

  /** Feeds one raw video/QR-decoded frame; `null` frames (no QR found) count as invalid. */
  ingestFrame(packet: OatPacket | null): boolean {
    if (!packet) {
      this.invalidFrames++;
      return false;
    }
    return this.ingestPacket(packet);
  }

  get isComplete(): boolean {
    return this.#decoder?.isComplete ?? false;
  }

  get progress(): number {
    return this.#decoder?.progress ?? 0;
  }

  reconstruct(): Uint8Array {
    if (!this.#decoder) throw new Error('optical-receive: no packets received yet');
    return this.#decoder.reconstruct();
  }

  reset(): void {
    this.#decoder = null;
    this.#artifactId = null;
    this.framesSeen = 0;
    this.duplicateFrames = 0;
    this.invalidFrames = 0;
  }
}
