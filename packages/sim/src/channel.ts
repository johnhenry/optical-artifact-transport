import type { OatPacket } from '@oat/qr-fountain';

export interface ImpairmentConfig {
  /** Probability in [0,1] that a given packet is dropped entirely. */
  lossRate?: number;
  /** Probability in [0,1] that a given packet is duplicated. */
  duplicateRate?: number;
  /** Probability in [0,1] that a given packet's payload is bit-corrupted. */
  corruptionRate?: number;
  /** Packets are locally shuffled within windows of this size to simulate reordering. */
  reorderWindow?: number;
}

/**
 * Applies loss, duplication, corruption, and windowed reordering to a fixed
 * list of packets, using `rand` (in [0,1)) for all decisions so runs are
 * reproducible given a seeded PRNG.
 */
export function applyImpairments(
  packets: readonly OatPacket[],
  config: ImpairmentConfig,
  rand: () => number
): OatPacket[] {
  const lossRate = config.lossRate ?? 0;
  const duplicateRate = config.duplicateRate ?? 0;
  const corruptionRate = config.corruptionRate ?? 0;
  const reorderWindow = Math.max(1, config.reorderWindow ?? 1);

  const survivors: OatPacket[] = [];
  for (const packet of packets) {
    if (rand() < lossRate) continue;

    const delivered = rand() < corruptionRate ? corrupt(packet, rand) : packet;
    survivors.push(delivered);

    if (rand() < duplicateRate) survivors.push(delivered);
  }

  return windowedShuffle(survivors, reorderWindow, rand);
}

function corrupt(packet: OatPacket, rand: () => number): OatPacket {
  const payload = packet.payload.slice();
  const flips = 1 + Math.floor(rand() * Math.max(1, payload.length / 8));
  for (let i = 0; i < flips; i++) {
    const idx = Math.floor(rand() * payload.length);
    const bit = 1 << Math.floor(rand() * 8);
    payload[idx] = (payload[idx] as number) ^ bit;
  }
  return { ...packet, payload };
}

function windowedShuffle<T>(items: readonly T[], windowSize: number, rand: () => number): T[] {
  const out = [...items];
  for (let start = 0; start < out.length; start += windowSize) {
    const end = Math.min(start + windowSize, out.length);
    for (let i = end - 1; i > start; i--) {
      const j = start + Math.floor(rand() * (i - start + 1));
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
  }
  return out;
}
