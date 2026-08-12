import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { prepareSource, generatePackets, counterSeeds } from '../src/encoder.js';
import { FountainDecoder } from '../src/decoder.js';
import { renderPacketToCanvas, decodePacketFromImageData } from '../src/scheduler.js';

/**
 * These tests exercise the *actual* screen->camera pipeline end to end:
 * render a real QR PNG for each packet with the `qrcode` library, "capture"
 * it back with `jsqr` (the same decoder a phone camera pipeline would use),
 * and reconstruct the artifact via the LT decoder. No mocking of the codec
 * internals — this is the closest thing to a hardware test we can run
 * headlessly.
 */
describe('QR frame render -> jsQR decode (simulated camera)', () => {
  it('renders a packet to a QR canvas and decodes it back byte-for-byte', async () => {
    const original = new TextEncoder().encode('optical artifact transport');
    const source = prepareSource(original, 64, crypto.getRandomValues(new Uint8Array(16)));
    const packet = generatePackets(source, counterSeeds(7)).next().value;

    const canvas = createCanvas(400, 400);
    await renderPacketToCanvas(canvas as unknown as Parameters<typeof renderPacketToCanvas>[0], packet, {
      errorCorrectionLevel: 'M'
    });

    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, 400, 400);

    const decoded = decodePacketFromImageData(imageData);
    expect(decoded).not.toBeNull();
    expect(decoded?.seed).toBe(packet.seed);
    expect(decoded?.payload).toEqual(packet.payload);
    expect(decoded?.artifactId).toEqual(packet.artifactId);
  });

  it('reconstructs a whole artifact from a sequence of real rendered/decoded QR frames', async () => {
    const original = crypto.getRandomValues(new Uint8Array(1200));
    const source = prepareSource(original, 96, crypto.getRandomValues(new Uint8Array(16)));
    const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);

    const gen = generatePackets(source, counterSeeds());
    const canvas = createCanvas(400, 400);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < source.sourceBlockCount * 4 && !decoder.isComplete; i++) {
      const packet = gen.next().value;
      await renderPacketToCanvas(canvas as unknown as Parameters<typeof renderPacketToCanvas>[0], packet, {
        errorCorrectionLevel: 'M'
      });
      const imageData = ctx.getImageData(0, 0, 400, 400);
      const captured = decodePacketFromImageData(imageData);
      expect(captured).not.toBeNull();
      decoder.addPacket(captured as NonNullable<typeof captured>);
    }

    expect(decoder.isComplete).toBe(true);
    expect(decoder.reconstruct()).toEqual(original);
  });

  it('returns null for a frame with no QR code present', () => {
    const canvas = createCanvas(200, 200);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 200, 200);
    const imageData = ctx.getImageData(0, 0, 200, 200);
    expect(decodePacketFromImageData(imageData)).toBeNull();
  });
});
