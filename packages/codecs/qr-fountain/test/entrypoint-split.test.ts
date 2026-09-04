import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The encode half and the decode half of this package must not drag each
 * other's dependency into a consumer's bundle: a sender only ever renders
 * QR codes (`qrcode`) and a receiver only ever scans them (`jsqr`, roughly
 * 46 KB gzipped).
 *
 * Before the entrypoints were split, `renderPacketToCanvas` and
 * `decodePacketFromImageData` lived in one module that imported both
 * libraries at top level, and `sideEffects: false` could not save it —
 * neither `qrcode` nor `jsqr` declares `sideEffects`, so a bundler must
 * keep a top-level import of them that it cannot prove unreachable. The
 * measured result was two byte-identical bundles: an encode-only import
 * still shipped the whole QR decoder.
 *
 * These tests bundle each entrypoint for real and read esbuild's metafile
 * for how many bytes of each dependency actually survived into the output.
 * To watch them fail, put `renderPacketToCanvas` and
 * `decodePacketFromImageData` back in a single module.
 */
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'oat-entrypoint-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Bundles `source` and reports how many output bytes each node_modules package contributed. */
async function bundledBytesByDependency(source: string): Promise<Record<string, number>> {
  const entry = join(scratch, `entry-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(entry, source);
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    absWorkingDir: repoRoot,
    nodePaths: [join(repoRoot, 'node_modules')]
  });

  const totals: Record<string, number> = {};
  for (const output of Object.values(result.metafile.outputs)) {
    for (const [input, info] of Object.entries(output.inputs)) {
      const dependency = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1];
      if (!dependency) continue;
      totals[dependency] = (totals[dependency] ?? 0) + info.bytesInOutput;
    }
  }
  return totals;
}

describe('encode/decode entrypoints tree-shake apart', () => {
  it('an encode-only import ships the QR encoder and none of the decoder', async () => {
    const bytes = await bundledBytesByDependency(
      "import { renderPacketToDataUrl } from '@johnhenry/oat-qr-fountain/encode';\nglobalThis.__keep = renderPacketToDataUrl;\n"
    );
    expect(bytes.qrcode ?? 0).toBeGreaterThan(1000);
    expect(bytes.jsqr ?? 0).toBe(0);
  });

  it('a decode-only import ships the QR decoder and none of the encoder', async () => {
    const bytes = await bundledBytesByDependency(
      "import { decodePacketFromImageData } from '@johnhenry/oat-qr-fountain/decode';\nglobalThis.__keep = decodePacketFromImageData;\n"
    );
    expect(bytes.jsqr ?? 0).toBeGreaterThan(1000);
    expect(bytes.qrcode ?? 0).toBe(0);
  });

  it('the fountain-codec entrypoint ships neither QR library', async () => {
    const bytes = await bundledBytesByDependency(
      "import { prepareSource } from '@johnhenry/oat-qr-fountain/fountain';\nglobalThis.__keep = prepareSource;\n"
    );
    expect(bytes.jsqr ?? 0).toBe(0);
    expect(bytes.qrcode ?? 0).toBe(0);
  });

  it('the package root also tree-shakes to one half when only one half is used', async () => {
    const encodeOnly = await bundledBytesByDependency(
      "import { renderPacketToDataUrl } from '@johnhenry/oat-qr-fountain';\nglobalThis.__keep = renderPacketToDataUrl;\n"
    );
    expect(encodeOnly.jsqr ?? 0).toBe(0);

    const decodeOnly = await bundledBytesByDependency(
      "import { decodePacketFromImageData } from '@johnhenry/oat-qr-fountain';\nglobalThis.__keep = decodePacketFromImageData;\n"
    );
    expect(decodeOnly.qrcode ?? 0).toBe(0);
  });
});
