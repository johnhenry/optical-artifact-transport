import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  buildArtifact,
  encodeCanonical,
  computeDigest,
  generateSigningKey,
  createCapabilityPolicy,
  type UiProposalEnvelope
} from '@oat/protocol';
import { prepareSource, generatePackets, renderPacketToCanvas, type ImageDataLike } from '@oat/qr-fountain';
import { defineOpticalReceive, OpticalReceiveElement } from '../src/optical-receive.js';

/**
 * Exercises the full capture -> decode -> fountain-reassemble -> verify ->
 * policy pipeline with *real* rendered QR frames (via @napi-rs/canvas, the
 * same approach `@oat/qr-fountain`'s own tests use), fed straight into
 * `processFrame()`. This deliberately bypasses `getUserMedia`, which no
 * headless test environment provides — but nothing else about the pipeline
 * is mocked.
 */
async function renderFrames(envelopeBytes: Uint8Array, blockSize: number, frameCount: number): Promise<ImageDataLike[]> {
  const artifactId = computeDigest(envelopeBytes.subarray(0, Math.min(16, envelopeBytes.length))).value.slice(0, 16);
  const source = prepareSource(envelopeBytes, blockSize, artifactId);
  const gen = generatePackets(source);

  const canvas = createCanvas(500, 500);
  const ctx = canvas.getContext('2d');
  const frames: ImageDataLike[] = [];
  for (let i = 0; i < frameCount; i++) {
    const packet = gen.next().value;
    await renderPacketToCanvas(canvas as unknown as Parameters<typeof renderPacketToCanvas>[0], packet, {
      errorCorrectionLevel: 'M'
    });
    frames.push(ctx.getImageData(0, 0, 500, 500));
  }
  return frames;
}

beforeAll(() => {
  defineOpticalReceive();
});

function mount(): OpticalReceiveElement {
  const el = document.createElement('optical-receive') as OpticalReceiveElement;
  document.body.appendChild(el);
  return el;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<optical-receive> end-to-end (synthetic QR frames)', () => {
  it('reconstructs, verifies, and delivers an unsigned artifact with no UI proposal', async () => {
    const payload = crypto.getRandomValues(new Uint8Array(1500));
    const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 120, 40);

    const el = mount();
    const artifactEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-artifact', (e) => resolve(e as CustomEvent), { once: true })
    );

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'accepted') break;
    }

    const evt = await artifactEvent;
    expect(el.state).toBe('accepted');
    expect(evt.detail.verification.valid).toBe(true);
    expect(el.artifact?.mediaType).toBe('application/octet-stream');
  });

  it('rejects when a signature is required but the artifact is unsigned', async () => {
    const payload = new TextEncoder().encode('no signature here');
    const artifact = await buildArtifact({ mediaType: 'text/plain', payload });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 64, 30);

    const el = mount();
    el.setAttribute('verify', 'signature');
    const rejectedEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-rejected', (e) => resolve(e as CustomEvent), { once: true })
    );

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'rejected') break;
    }

    const evt = await rejectedEvent;
    expect(el.state).toBe('rejected');
    expect(evt.detail.verification.reasons).toContain('signature-required');
  });

  it('accepts and verifies a signed artifact', async () => {
    const { secretKey } = generateSigningKey();
    const payload = new TextEncoder().encode('signed payload for receiver test');
    const artifact = await buildArtifact({
      mediaType: 'text/plain',
      payload,
      sign: { secretKey, keyId: 'test' }
    });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 64, 30);

    const el = mount();
    el.setAttribute('verify', 'signature');
    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'accepted') break;
    }

    expect(el.state).toBe('accepted');
    expect(el.verification?.signatureValid).toBe(true);
  });

  it('rejects an artifact whose media type is not in the accept list', async () => {
    const payload = new TextEncoder().encode('image bytes pretend');
    const artifact = await buildArtifact({ mediaType: 'image/png', payload });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 64, 30);

    const el = mount();
    el.setAttribute('accept', 'application/json,text/plain');
    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'rejected') break;
    }

    expect(el.state).toBe('rejected');
    expect(el.verification?.mediaTypeAccepted).toBe(false);
  });

  it('downgrades a sandboxed-html proposal by default (allowUnsafeHtml defaults closed)', async () => {
    const uiProposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: 'p1',
      origin: { id: 'sender-1' },
      title: 'Untrusted UI',
      preferredView: { kind: 'sandboxed-html', html: '<script>alert(1)</script>' },
      fallbackView: { kind: 'text', body: 'fallback' },
      requestedCapabilities: [],
      requestedProfile: 'sandboxed-html'
    };
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal,
      sign: { secretKey } // even a validly signed proposal must downgrade with the receiver's default policy
    });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 96, 40);

    const el = mount();
    let proposalEvent: CustomEvent | null = null;
    el.addEventListener('oat-ui-proposal', (e) => (proposalEvent = e as CustomEvent));

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'downgraded') break;
    }

    expect(el.state).toBe('downgraded');
    expect(el.uiDecision?.outcome).toBe('downgrade');
    expect(el.uiDecision?.reasons).toContain('receiver-policy-disallows-unsafe-html');
    expect(proposalEvent).not.toBeNull();
  });

  it('still downgrades an unsigned sandboxed-html proposal even when allowUnsafeHtml is opted in', async () => {
    const uiProposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: 'p1b',
      origin: { id: 'sender-1' },
      title: 'Untrusted UI',
      preferredView: { kind: 'sandboxed-html', html: '<script>alert(1)</script>' },
      fallbackView: { kind: 'text', body: 'fallback' },
      requestedCapabilities: [],
      requestedProfile: 'sandboxed-html'
    };
    const artifact = await buildArtifact({ mediaType: 'application/json', payload: new TextEncoder().encode('{}'), uiProposal });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 96, 40);

    const el = mount();
    el.allowUnsafeHtml = true;

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'downgraded') break;
    }

    expect(el.state).toBe('downgraded');
    expect(el.uiDecision?.reasons).toContain('signature-required');
  });

  it('reaches accept-unsafe only for a signed sandboxed-html proposal with allowUnsafeHtml opted in', async () => {
    const uiProposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: 'p1c',
      origin: { id: 'sender-1' },
      title: 'Break glass demo',
      preferredView: { kind: 'sandboxed-html', html: '<button>go</button>' },
      fallbackView: { kind: 'text', body: 'fallback' },
      requestedCapabilities: [],
      requestedProfile: 'sandboxed-html'
    };
    const { secretKey, publicKey } = generateSigningKey();
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal,
      sign: { secretKey }
    });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 96, 40);

    const el = mount();
    el.allowUnsafeHtml = true;
    el.trustedPublicKeys = [toHex(publicKey)];

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'unsafe-proposed') break;
    }

    expect(el.state).toBe('unsafe-proposed');
    expect(el.uiDecision?.outcome).toBe('accept-unsafe');
    expect(el.uiDecision?.reasons).toEqual([]);
  });

  it('allowUnsafeHtml is inert without a configured trust list, even for a validly signed proposal', async () => {
    const uiProposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: 'p1d',
      origin: { id: 'sender-1' },
      title: 'Break glass demo',
      preferredView: { kind: 'sandboxed-html', html: '<button>go</button>' },
      fallbackView: { kind: 'text', body: 'fallback' },
      requestedCapabilities: [],
      requestedProfile: 'sandboxed-html'
    };
    const { secretKey } = generateSigningKey();
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal,
      sign: { secretKey }
    });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 96, 40);

    const el = mount();
    el.allowUnsafeHtml = true; // opted in, but trustedPublicKeys was never set

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'downgraded') break;
    }

    expect(el.state).toBe('downgraded');
    expect(el.uiDecision?.outcome).toBe('downgrade');
  });

  it('computes accept-safe with granted capabilities intersecting policy and user approval', async () => {
    const uiProposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: 'p2',
      origin: { id: 'sender-1' },
      title: 'Import handoff',
      preferredView: { kind: 'safe-html', html: '<button data-optical-capability="agent.session.import">Go</button>', sanitizationProfile: 'forms' },
      fallbackView: { kind: 'text', body: 'fallback' },
      requestedCapabilities: [{ capability: 'agent.session.import' }, { capability: 'html.script' }],
      requestedProfile: 'safe-html'
    };
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal
    });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 96, 40);

    const el = mount();
    el.capabilityPolicy = createCapabilityPolicy(['agent.session.import', 'html.script']);
    el.approveCapabilities(['agent.session.import']); // user approves only the import capability, not html.script

    for (const frame of frames) {
      el.processFrame(frame);
      if (el.state === 'ui-proposed') break;
    }

    expect(el.state).toBe('ui-proposed');
    expect(el.uiDecision?.outcome).toBe('accept-safe');
    expect(el.uiDecision?.effectiveCapabilities).toEqual(['agent.session.import']);
  });

  it('processFrame ignores frames with no decodable QR code', async () => {
    const el = mount();
    const blank: ImageDataLike = { data: new Uint8ClampedArray(400 * 400 * 4).fill(255), width: 400, height: 400 };

    expect(() => el.processFrame(blank)).not.toThrow();
    expect(el.state).toBe('idle');
  });

  it('reset() clears an in-progress session', async () => {
    const payload = crypto.getRandomValues(new Uint8Array(600)); // k=~19 blocks at blockSize 32
    const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload });
    const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
    const frames = await renderFrames(envelopeBytes, 32, 3); // far fewer frames than blocks: guaranteed incomplete

    const el = mount();
    for (const frame of frames) el.processFrame(frame);
    expect(el.framesSeen).toBeGreaterThan(0);
    expect(el.state).not.toBe('accepted'); // too few frames to have completed

    el.reset();
    expect(el.framesSeen).toBe(0);
    expect(el.progress).toBe(0);
    expect(el.state).toBe('idle');
  });
});
