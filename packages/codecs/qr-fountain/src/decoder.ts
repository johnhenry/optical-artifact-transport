import { mulberry32, robustSolitonTable, sampleDegree, chooseNeighbors, xorInPlace } from './lt.js';
import type { OatPacket } from './packet.js';

interface PendingEntry {
  neighbors: Set<number>;
  payload: Uint8Array;
}

/**
 * Belief-propagation ("peeling") LT decoder. Feed it packets in any order,
 * with duplicates and unrelated packets safely ignored; call `reconstruct()`
 * once `isComplete` is true.
 */
export class FountainDecoder {
  private readonly k: number;
  private readonly blockSize: number;
  private readonly totalLength: number;
  private readonly cumulative: number[];
  private readonly solved: (Uint8Array | undefined)[];
  private pending: PendingEntry[] = [];
  private readonly seenSeeds = new Set<number>();
  private solvedCount = 0;

  constructor(sourceBlockCount: number, blockSize: number, totalLength: number) {
    this.k = sourceBlockCount;
    this.blockSize = blockSize;
    this.totalLength = totalLength;
    this.cumulative = robustSolitonTable(sourceBlockCount);
    this.solved = new Array(sourceBlockCount).fill(undefined);
  }

  get isComplete(): boolean {
    return this.solvedCount === this.k;
  }

  /** Fraction of source blocks solved so far, in [0, 1]. */
  get progress(): number {
    return this.k === 0 ? 1 : this.solvedCount / this.k;
  }

  get packetsSeen(): number {
    return this.seenSeeds.size;
  }

  /** Returns `true` if this packet completed the transfer. */
  addPacket(packet: OatPacket): boolean {
    if (this.isComplete) return true;
    if (packet.sourceBlockCount !== this.k || packet.blockSize !== this.blockSize) {
      throw new Error('packet does not belong to this decode session');
    }
    if (this.seenSeeds.has(packet.seed)) return false;
    this.seenSeeds.add(packet.seed);

    const rand = mulberry32(packet.seed);
    const degree = sampleDegree(this.cumulative, rand);
    const neighbors = chooseNeighbors(this.k, degree, rand);

    this.reduce({ neighbors: new Set(neighbors), payload: packet.payload.slice() });
    return this.isComplete;
  }

  private reduce(entry: PendingEntry): void {
    const queue: PendingEntry[] = [entry];

    while (queue.length > 0) {
      const current = queue.pop() as PendingEntry;

      for (const idx of [...current.neighbors]) {
        const block = this.solved[idx];
        if (block) {
          xorInPlace(current.payload, block);
          current.neighbors.delete(idx);
        }
      }

      if (current.neighbors.size === 0) continue; // fully redundant packet
      if (current.neighbors.size > 1) {
        this.pending.push(current);
        continue;
      }

      const [idx] = current.neighbors;
      const blockIndex = idx as number;
      if (this.solved[blockIndex]) continue;

      this.solved[blockIndex] = current.payload;
      this.solvedCount++;

      const stillPending: PendingEntry[] = [];
      for (const other of this.pending) {
        if (other.neighbors.has(blockIndex)) {
          xorInPlace(other.payload, current.payload);
          other.neighbors.delete(blockIndex);
          if (other.neighbors.size <= 1) {
            queue.push(other);
            continue;
          }
        }
        stillPending.push(other);
      }
      this.pending = stillPending;
    }
  }

  reconstruct(): Uint8Array {
    if (!this.isComplete) throw new Error('fountain decode incomplete: missing source blocks');
    const out = new Uint8Array(this.totalLength);
    for (let i = 0; i < this.k; i++) {
      const block = this.solved[i] as Uint8Array;
      const start = i * this.blockSize;
      const len = Math.min(this.blockSize, this.totalLength - start);
      out.set(block.subarray(0, len), start);
    }
    return out;
  }
}
