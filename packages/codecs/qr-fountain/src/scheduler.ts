import type { OatPacket } from './packet.js';

/**
 * Cycles through a fixed buffer of packets forever, round-robin. The
 * `<optical-send>` element drives the actual frame-rate timing (rAF /
 * setInterval); this just tracks "which packet is next".
 */
export class PacketCycle {
  private index = 0;
  constructor(private readonly packets: readonly OatPacket[]) {
    if (packets.length === 0) throw new Error('PacketCycle requires at least one packet');
  }

  next(): OatPacket {
    const packet = this.packets[this.index] as OatPacket;
    this.index = (this.index + 1) % this.packets.length;
    return packet;
  }
}
