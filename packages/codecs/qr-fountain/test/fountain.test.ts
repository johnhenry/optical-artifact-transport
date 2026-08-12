import { describe, expect, it } from 'vitest';
import { prepareSource, generatePackets, counterSeeds } from '../src/encoder.js';
import { FountainDecoder } from '../src/decoder.js';
import { encodePacket, decodePacket } from '../src/packet.js';

function artifactId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

describe('LT fountain encode/decode', () => {
  it('reconstructs source bytes from a modest overhead of packets', () => {
    const original = crypto.getRandomValues(new Uint8Array(5000));
    const source = prepareSource(original, 128, artifactId());

    const packets = generatePackets(source, counterSeeds());
    const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);

    let consumed = 0;
    for (const packet of packets) {
      decoder.addPacket(packet);
      consumed++;
      if (decoder.isComplete) break;
      if (consumed > source.sourceBlockCount * 5) break; // safety valve
    }

    expect(decoder.isComplete).toBe(true);
    // LT codes typically need only a modest overhead beyond k packets.
    expect(consumed).toBeLessThan(source.sourceBlockCount * 3);
    expect(decoder.reconstruct()).toEqual(original);
  });

  it('tolerates dropped, duplicated, and reordered packets', () => {
    const original = new TextEncoder().encode('the quick brown fox jumps over the lazy dog '.repeat(50));
    const source = prepareSource(original, 64, artifactId());

    const buffered = [];
    const gen = generatePackets(source, counterSeeds());
    for (let i = 0; i < source.sourceBlockCount * 4; i++) buffered.push(gen.next().value);

    // Simulate loss (drop every 3rd), duplication, and reordering.
    const lossy = buffered.filter((_, i) => i % 3 !== 0);
    const withDuplicates = [...lossy, ...lossy.slice(0, 5)];
    const reordered = [...withDuplicates].reverse();

    const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);
    for (const packet of reordered) {
      decoder.addPacket(packet);
      if (decoder.isComplete) break;
    }

    expect(decoder.isComplete).toBe(true);
    expect(decoder.reconstruct()).toEqual(original);
  });

  it('a receiver can join mid-stream and still recover the artifact', () => {
    const original = crypto.getRandomValues(new Uint8Array(3000));
    const source = prepareSource(original, 96, artifactId());
    const gen = generatePackets(source, counterSeeds());

    // Skip the first 200 packets ("late join").
    for (let i = 0; i < 200; i++) gen.next();

    const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);
    for (let i = 0; i < source.sourceBlockCount * 5 && !decoder.isComplete; i++) {
      decoder.addPacket(gen.next().value);
    }

    expect(decoder.isComplete).toBe(true);
    expect(decoder.reconstruct()).toEqual(original);
  });

  it('ignores packets from a different decode session', () => {
    const source = prepareSource(new Uint8Array(500), 50, artifactId());
    const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);
    const foreignPacket = generatePackets(prepareSource(new Uint8Array(500), 25, artifactId())).next().value;
    expect(() => decoder.addPacket(foreignPacket)).toThrow();
  });
});

describe('packet binary framing', () => {
  it('round-trips through encodePacket/decodePacket', () => {
    const source = prepareSource(new TextEncoder().encode('hello'), 16, artifactId());
    const packet = generatePackets(source, counterSeeds(42)).next().value;

    const framed = encodePacket(packet);
    const decoded = decodePacket(framed);

    expect(decoded).not.toBeNull();
    expect(decoded?.seed).toBe(packet.seed);
    expect(decoded?.sourceBlockCount).toBe(packet.sourceBlockCount);
    expect(decoded?.blockSize).toBe(packet.blockSize);
    expect(decoded?.totalLength).toBe(packet.totalLength);
    expect(decoded?.payload).toEqual(packet.payload);
    expect(decoded?.artifactId).toEqual(packet.artifactId);
  });

  it('rejects malformed frames', () => {
    expect(decodePacket(new Uint8Array(5))).toBeNull();
    const garbage = new Uint8Array(64);
    garbage[0] = 99; // bogus version
    expect(decodePacket(garbage)).toBeNull();
  });
});
