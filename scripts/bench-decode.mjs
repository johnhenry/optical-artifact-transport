#!/usr/bin/env node
// Benchmark: main-thread cost of QR-decoding one camera frame, before/after
// downscaling (max-scan-width) and after moving the decode into a worker.
//
//   npm run build && node scripts/bench-decode.mjs [iterations=20]
//
// "Main-thread cost" is what the host page's UI thread pays per frame:
//   inline       drawImage + getImageData + jsQR   (the original behaviour)
//   inline@1280  the same, after scan-scaling.ts caps the width
//   worker@1280  drawImage + getImageData + postMessage (decode runs in a worker_thread)
// Synthetic render (QR filling 70% of frame height), decoded in-process:
// this measures CPU, not the optical channel.
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createCanvas } from '@napi-rs/canvas';
import { buildArtifact, encodeCanonical, computeDigest } from '@johnhenry/oat-protocol';
import { prepareSource, generatePackets } from '@johnhenry/oat-qr-fountain/fountain';
import { renderPacketToCanvas } from '@johnhenry/oat-qr-fountain/encode';
// Imported from the built files directly: the package index also defines the
// <optical-receive> element, which needs a DOM.
import { handleDecodeRequest } from '../packages/receiver/dist/decode-worker.js';
import { scanFrameSize } from '../packages/receiver/dist/scan-scaling.js';

const iterations = Number(process.argv[2]) || 20;
const SRC_W = 1920;
const SRC_H = 1080;

const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload: new Uint8Array(150).map((_, i) => i * 7) });
const envelope = encodeCanonical(artifact);
const source = prepareSource(envelope, 200, computeDigest(envelope.subarray(0, 16)).value.slice(0, 16));
const packet = generatePackets(source).next().value;

// A 1080p "camera frame": white background, QR centred at 70% of frame height.
const qrSize = Math.round(SRC_H * 0.7);
const qrCanvas = createCanvas(qrSize, qrSize);
await renderPacketToCanvas(qrCanvas, packet, { errorCorrectionLevel: 'M' });
const frame = createCanvas(SRC_W, SRC_H);
const fctx = frame.getContext('2d');
fctx.fillStyle = '#fff';
fctx.fillRect(0, 0, SRC_W, SRC_H);
fctx.drawImage(qrCanvas, (SRC_W - qrSize) / 2, (SRC_H - qrSize) / 2);

const scan = createCanvas(SRC_W, SRC_H);
function capture(maxWidth) {
  const { width, height } = scanFrameSize(SRC_W, SRC_H, maxWidth);
  scan.width = width;
  scan.height = height;
  const ctx = scan.getContext('2d');
  ctx.drawImage(frame, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function row(label, ms, extra = '') {
  console.log(`${label.padEnd(34)} ${ms.toFixed(1).padStart(7)} ms/frame  ${extra}`);
}

function inline(maxWidth) {
  const times = [];
  const captures = [];
  let decoded = 0;
  for (let i = 0; i < iterations + 3; i++) {
    const t0 = performance.now();
    const img = capture(maxWidth);
    const t1 = performance.now();
    const res = handleDecodeRequest({ type: 'decode', id: i, width: img.width, height: img.height, data: img.data });
    const dt = performance.now() - t0;
    if (i >= 3) {
      times.push(dt); // 3 warm-up frames
      captures.push(t1 - t0);
    }
    if (res.type === 'result' && res.packet) decoded++;
  }
  return { ms: mean(times), capture: mean(captures), decoded };
}

const workerSource = `
  const { parentPort } = require('node:worker_threads');
  import(${JSON.stringify(new URL('../packages/receiver/dist/decode-worker.js', import.meta.url).href)}).then(({ handleDecodeRequest }) => {
    parentPort.on('message', (req) => parentPort.postMessage(handleDecodeRequest(req)));
    parentPort.postMessage({ type: 'ready' });
  });
`;
async function viaWorker(maxWidth) {
  const worker = new Worker(workerSource, { eval: true });
  await new Promise((resolve) => worker.once('message', resolve));
  const mainCost = [];
  const roundTrip = [];
  let decoded = 0;
  for (let i = 0; i < iterations + 3; i++) {
    const t0 = performance.now();
    const img = capture(maxWidth);
    // @napi-rs/canvas' ImageData buffer is not transferable (a browser's is), so
    // copy it here and exclude the copy from the main-thread figure.
    const tc0 = performance.now();
    const data = new Uint8ClampedArray(img.data);
    const copyMs = performance.now() - tc0;
    const reply = new Promise((resolve) => worker.once('message', resolve));
    worker.postMessage({ type: 'decode', id: i, width: img.width, height: img.height, data }, [data.buffer]);
    const tPosted = performance.now(); // main thread is free again from here
    const res = await reply;
    if (i >= 3) {
      mainCost.push(tPosted - t0 - copyMs);
      roundTrip.push(performance.now() - t0);
    }
    if (res.type === 'result' && res.packet) decoded++;
  }
  await worker.terminate();
  return { ms: mean(mainCost), roundTrip: mean(roundTrip), decoded };
}

console.log(`bench-decode: ${SRC_W}x${SRC_H} frame, QR 70% of height, ${iterations} iterations, node ${process.version}`);
const total = iterations + 3;
const a = inline(0);
row('inline, native 1920x1080', a.ms, `(capture ${a.capture.toFixed(1)} + jsQR ${(a.ms - a.capture).toFixed(1)}; decoded ${a.decoded}/${total})`);
const b = inline(1280);
row('inline, max-scan-width 1280', b.ms, `(capture ${b.capture.toFixed(1)} + jsQR ${(b.ms - b.capture).toFixed(1)}; decoded ${b.decoded}/${total})`);
const c = await viaWorker(1280);
row('worker, max-scan-width 1280', c.ms, `main-thread cost; decode round trip ${c.roundTrip.toFixed(1)} ms (decoded ${c.decoded}/${total})`);
const d = await viaWorker(0);
row('worker, native 1920x1080', d.ms, `main-thread cost; decode round trip ${d.roundTrip.toFixed(1)} ms (decoded ${d.decoded}/${total})`);
