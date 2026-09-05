import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildArtifact, encodeCanonical, computeDigest } from '@johnhenry/oat-protocol';
import { prepareSource, generatePackets } from '@johnhenry/oat-qr-fountain/fountain';
import { renderPacketToCanvas } from '@johnhenry/oat-qr-fountain/encode';
import { DEFAULT_MAX_SCAN_WIDTH, scanFrameSize } from '../src/scan-scaling.js';
import { defineOpticalReceive, OpticalReceiveElement } from '../src/optical-receive.js';

/**
 * `#scanFrame()` used to size its scan canvas to `video.videoWidth` /
 * `videoHeight` — the camera's native resolution — and hand every one of
 * those pixels to jsQR, on the main thread, at 8 fps. Measured here on
 * Apple silicon, one 1080p frame costs 34.5 ms of decode against a 125 ms
 * budget, and a mid-range Android WebView is several times slower again.
 *
 * The first group covers the scaling arithmetic; the second is the reason
 * the default is 1280 rather than something more aggressive — it renders a
 * QR into a real 1080p frame, downscales exactly as the element does, and
 * asserts the artifact still arrives.
 */
describe('scanFrameSize', () => {
  it('leaves a frame narrower than the ceiling alone', () => {
    expect(scanFrameSize(640, 480, 1280)).toEqual({ width: 640, height: 480 });
    expect(scanFrameSize(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('downscales a wider frame to the ceiling, preserving aspect ratio', () => {
    expect(scanFrameSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(scanFrameSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(scanFrameSize(3840, 2160, 640)).toEqual({ width: 640, height: 360 });
  });

  it('treats a non-positive ceiling as "scan natively"', () => {
    expect(scanFrameSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
    expect(scanFrameSize(1920, 1080, -1)).toEqual({ width: 1920, height: 1080 });
  });

  it('never rounds a height down to zero', () => {
    expect(scanFrameSize(4000, 3, 100).height).toBe(1);
  });
});

beforeAll(() => defineOpticalReceive());
afterEach(() => {
  document.body.innerHTML = '';
});

function mount(attributes: Record<string, string> = {}): OpticalReceiveElement {
  const el = document.createElement('optical-receive') as OpticalReceiveElement;
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

describe('<optical-receive> max-scan-width', () => {
  it('defaults to DEFAULT_MAX_SCAN_WIDTH', () => {
    expect(mount().maxScanWidth).toBe(DEFAULT_MAX_SCAN_WIDTH);
  });

  it('reads the attribute, and treats 0 and garbage as "scan natively"', () => {
    expect(mount({ 'max-scan-width': '960' }).maxScanWidth).toBe(960);
    expect(mount({ 'max-scan-width': '0' }).maxScanWidth).toBe(0);
    expect(mount({ 'max-scan-width': 'wide' }).maxScanWidth).toBe(0);
    expect(mount({ 'max-scan-width': '-100' }).maxScanWidth).toBe(0);
  });
});

describe('a 1080p frame still decodes after the default downscale', () => {
  it('delivers the artifact from frames scanned at 1280x720', async () => {
    const payload = crypto.getRandomValues(new Uint8Array(1200));
    const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload });
    const envelope = encodeCanonical(artifact);
    const artifactId = computeDigest(envelope.subarray(0, 16)).value.slice(0, 16);
    const source = prepareSource(envelope, 200, artifactId);
    const packets = generatePackets(source);

    const element = mount();
    const artifactEvent = new Promise<CustomEvent>((resolve) =>
      element.addEventListener('oat-artifact', (event) => resolve(event as CustomEvent), { once: true })
    );

    // A 1920x1080 capture, QR filling 70% of frame height — then the exact
    // resize `#scanFrame()` performs before handing pixels to the decoder.
    const captureWidth = 1920;
    const captureHeight = 1080;
    const qrPx = Math.round(captureHeight * 0.7);
    const { width, height } = scanFrameSize(captureWidth, captureHeight, element.maxScanWidth);
    expect([width, height]).toEqual([1280, 720]);

    const qr = createCanvas(qrPx, qrPx);
    const capture = createCanvas(captureWidth, captureHeight);
    const captureCtx = capture.getContext('2d');
    const scan = createCanvas(width, height);
    const scanCtx = scan.getContext('2d');

    for (let i = 0; i < 60; i++) {
      const packet = packets.next().value;
      await renderPacketToCanvas(qr as unknown as Parameters<typeof renderPacketToCanvas>[0], packet, {
        errorCorrectionLevel: 'M',
        width: qrPx
      });
      captureCtx.fillStyle = '#ffffff';
      captureCtx.fillRect(0, 0, captureWidth, captureHeight);
      captureCtx.drawImage(qr, (captureWidth - qrPx) / 2, (captureHeight - qrPx) / 2);
      scanCtx.drawImage(capture, 0, 0, width, height);
      element.processFrame(scanCtx.getImageData(0, 0, width, height));
      if (element.state === 'accepted') break;
    }

    const event = await artifactEvent;
    expect(element.state).toBe('accepted');
    expect(event.detail.verification.valid).toBe(true);
    expect(element.artifact?.digest.value).toEqual(artifact.digest.value);
  }, 30_000);
});
