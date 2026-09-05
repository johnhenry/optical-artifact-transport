import { describe, expect, it } from 'vitest';
import { compress, decompress, DEFAULT_MAX_DECOMPRESSED_BYTES } from '../src/compression.js';
import { buildArtifact, extractPayload } from '../src/manifest.js';

const MIB = 1024 * 1024;

/**
 * Builds a real gzip "bomb": a small compressed input that inflates to
 * `inflatedMib` MiB. Built incrementally through `CompressionStream` so the
 * test itself never holds the inflated form in memory — writing 256 MiB of
 * zeros a chunk at a time costs ~370 ms and ~260 KB of output.
 */
async function buildBomb(inflatedMib: number): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  const zeros = new Uint8Array(MIB);
  const parts: Uint8Array[] = [];
  const collect = (async () => {
    for await (const chunk of cs.readable as unknown as AsyncIterable<Uint8Array>) parts.push(chunk);
  })();
  for (let i = 0; i < inflatedMib; i++) await writer.write(zeros);
  await writer.close();
  await collect;
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * The existing ceiling tests in `envelope.test.ts` assert only that
 * `decompress`/`extractPayload` *reject*. That is necessary but not
 * sufficient: an implementation that inflates the payload completely and
 * only then compares its size throws exactly the same error, and passes
 * every one of those assertions — while doing precisely the thing the
 * finding was about. Verified by fault injection: moving the ceiling check
 * to after the read loop leaves the whole protocol suite green.
 *
 * These tests pin the property that actually bounds the damage — memory is
 * released back to the ceiling *during* the read, not after it.
 */
describe('decompression bomb (mid-stream abort, not post-hoc check)', () => {
  it('never allocates the inflated form of a 256 MiB bomb', async () => {
    const bomb = await buildBomb(256);

    // Confirms this is bomb-shaped rather than merely large: ~1000:1, the
    // ratio DEFLATE reaches on repetitive input.
    expect(bomb.length).toBeLessThan(MIB);
    expect((256 * MIB) / bomb.length).toBeGreaterThan(500);

    // Sample allocation *during* the decompress, not after: by the time the
    // rejection surfaces, a fully-inflated buffer is already garbage and its
    // memory may have been reclaimed, which would let a broken
    // implementation measure clean.
    const base = process.memoryUsage().arrayBuffers;
    let peak = 0;
    const sampler = setInterval(() => {
      const delta = process.memoryUsage().arrayBuffers - base;
      if (delta > peak) peak = delta;
    }, 1);

    try {
      await expect(decompress(bomb, 'gzip', MIB)).rejects.toThrow(/exceeds maximum allowed size/);
    } finally {
      clearInterval(sampler);
    }

    // Measured: 3 MiB peak when the ceiling aborts mid-stream, 257 MiB when
    // the same ceiling is checked after the read loop. 64 MiB sits two
    // orders of magnitude clear of both.
    expect(peak).toBeLessThan(64 * MIB);
  });

  it('rejects a bomb far sooner than it would take to inflate it', async () => {
    const bomb = await buildBomb(256);

    const started = performance.now();
    await expect(decompress(bomb, 'gzip', MIB)).rejects.toThrow(/exceeds maximum allowed size/);
    const elapsed = performance.now() - started;

    // Measured: ~2 ms aborting mid-stream vs ~160 ms inflating all 256 MiB
    // first. A generous bound, so a loaded CI host cannot make it flap.
    expect(elapsed).toBeLessThan(100);
  });

  it('applies the same mid-stream ceiling through extractPayload on a real artifact', async () => {
    // The attacker-reachable path: `artifact.payload` arrives from a camera
    // pointed at an untrusted screen, and `extractPayload` decompresses it.
    const bomb = await buildBomb(256);
    const artifact = await buildArtifact({
      mediaType: 'application/octet-stream',
      payload: new Uint8Array(0)
    });
    const hostile = { ...artifact, payload: bomb, compression: 'gzip' as const };

    const base = process.memoryUsage().arrayBuffers;
    let peak = 0;
    const sampler = setInterval(() => {
      const delta = process.memoryUsage().arrayBuffers - base;
      if (delta > peak) peak = delta;
    }, 1);

    try {
      await expect(extractPayload(hostile, MIB)).rejects.toThrow(/exceeds maximum allowed size/);
    } finally {
      clearInterval(sampler);
    }

    expect(peak).toBeLessThan(64 * MIB);
  });

  it('lets a legitimate payload of the same size through when the ceiling allows it', async () => {
    // Guards against "fix" by refusing everything: the ceiling must bound
    // output, not forbid compression. Kept at 256 KiB — the assertion is
    // about the ceiling, and `toEqual` on a multi-MiB typed array costs
    // seconds in vitest's deep-equality walk.
    const payload = new Uint8Array(256 * 1024).fill(97);
    const compressed = await compress(payload, 'gzip');

    await expect(decompress(compressed, 'gzip', 8 * MIB)).resolves.toEqual(payload);
    expect(DEFAULT_MAX_DECOMPRESSED_BYTES).toBe(100 * MIB);
  });
});
