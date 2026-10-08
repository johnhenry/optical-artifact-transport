import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildArtifact, encodeCanonical, computeDigest } from '@johnhenry/oat-protocol';
import { prepareSource, generatePackets, type OatPacket } from '@johnhenry/oat-qr-fountain/fountain';
import { renderPacketToCanvas } from '@johnhenry/oat-qr-fountain/encode';
import type { ImageDataLike } from '@johnhenry/oat-qr-fountain/decode';
import {
  createInlineDecodeWorker,
  createWorkerDecodeClient,
  handleDecodeRequest,
  type DecodeRequest,
  type DecodeResponse,
  type WorkerLike
} from '../src/decode-worker.js';
import { defineOpticalReceive, OpticalReceiveElement } from '../src/optical-receive.js';

/**
 * `decode-worker.ts` used to be an inline stub that ran jsQR on the calling
 * (main) thread. These tests pin the real worker protocol. The fake worker
 * runs the *same* `handleDecodeRequest` the worker entry runs, delivered
 * asynchronously and with the pixel buffer detached the way a transfer
 * list detaches it, so nothing about the decode itself is mocked.
 */
async function renderFrames(blockSize: number, count: number, payloadBytes = 600): Promise<{ frames: ImageDataLike[]; packets: OatPacket[]; envelope: Uint8Array }> {
  const artifact = await buildArtifact({ mediaType: 'application/octet-stream', payload: crypto.getRandomValues(new Uint8Array(payloadBytes)) });
  const envelope = encodeCanonical(artifact) as Uint8Array;
  const source = prepareSource(envelope, blockSize, computeDigest(envelope.subarray(0, 16)).value.slice(0, 16));
  const gen = generatePackets(source);
  const canvas = createCanvas(500, 500);
  const ctx = canvas.getContext('2d');
  const frames: ImageDataLike[] = [];
  const packets: OatPacket[] = [];
  for (let i = 0; i < count; i++) {
    const packet = gen.next().value as OatPacket;
    packets.push(packet);
    await renderPacketToCanvas(canvas as unknown as Parameters<typeof renderPacketToCanvas>[0], packet, { errorCorrectionLevel: 'M' });
    frames.push(ctx.getImageData(0, 0, 500, 500));
  }
  return { frames, packets, envelope };
}

class FakeWorker implements WorkerLike {
  requests: DecodeRequest[] = [];
  terminated = false;
  #listeners = new Map<string, Set<(e: { data?: unknown; message?: string }) => void>>();
  mode: 'ok' | 'error' | 'hang' = 'ok';

  postMessage(message: DecodeRequest, transfer?: Transferable[]): void {
    this.requests.push(message);
    let delivered = message;
    if (transfer?.length) {
      // a real transfer moves the buffer to the worker and detaches the sender's view
      delivered = { ...message, data: new Uint8ClampedArray(message.data) };
      (message.data.buffer as ArrayBuffer & { transfer?: () => ArrayBuffer }).transfer?.();
    }
    if (this.mode === 'hang') return;
    queueMicrotask(() => {
      if (this.mode === 'error') return this.#emit('error', { message: 'boom' });
      this.#emit('message', { data: handleDecodeRequest(delivered) });
    });
  }
  addEventListener(type: string, listener: (e: { data?: unknown; message?: string }) => void): void {
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set());
    this.#listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (e: { data?: unknown; message?: string }) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }
  terminate(): void {
    this.terminated = true;
  }
  listenerCount(): number {
    return [...this.#listeners.values()].reduce((n, s) => n + s.size, 0);
  }
  #emit(type: string, e: { data?: unknown; message?: string }): void {
    for (const l of this.#listeners.get(type) ?? []) l(e);
  }
}

describe('handleDecodeRequest', () => {
  it('decodes a QR frame to the same packet the inline decoder produces', async () => {
    const { frames, packets } = await renderFrames(120, 1);
    const frame = frames[0]!;
    const response = handleDecodeRequest({
      type: 'decode',
      id: 7,
      width: frame.width,
      height: frame.height,
      data: new Uint8ClampedArray(frame.data)
    }) as Extract<DecodeResponse, { type: 'result' }>;
    expect(response.type).toBe('result');
    expect(response.id).toBe(7);
    expect(response.packet?.artifactId).toEqual(packets[0]!.artifactId);
    expect(response.packet).toEqual(createInlineDecodeWorker().decodeFrame(frame));
  });

  it('answers null (not an error) for a frame with no QR code', () => {
    const response = handleDecodeRequest({ type: 'decode', id: 1, width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) });
    expect(response).toEqual({ type: 'result', id: 1, packet: null });
  });

  it('answers with an error response for a malformed request instead of throwing', () => {
    const response = handleDecodeRequest({ type: 'decode', id: 2, width: 10, height: 10, data: new Uint8ClampedArray(3) });
    expect(response.type).toBe('error');
    expect(response.id).toBe(2);
  });
});

describe('createWorkerDecodeClient', () => {
  it('posts the pixel buffer in the transfer list and resolves with the decoded packet', async () => {
    const { frames, packets } = await renderFrames(120, 1);
    const worker = new FakeWorker();
    const client = createWorkerDecodeClient(worker);
    const packet = await client.decodeFrame(frames[0]!);
    expect(packet?.artifactId).toEqual(packets[0]!.artifactId);
    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]!.data.byteLength).toBe(0); // detached: transferred, not copied
  });

  it('reports busy while a decode is in flight, so the frame loop can drop frames instead of queueing them', async () => {
    const { frames } = await renderFrames(120, 1);
    const worker = new FakeWorker();
    const client = createWorkerDecodeClient(worker);
    expect(client.busy).toBe(false);
    const pending = client.decodeFrame(frames[0]!);
    expect(client.busy).toBe(true);
    await pending;
    expect(client.busy).toBe(false);
  });

  it('rejects when the worker errors, and is no longer busy', async () => {
    const { frames } = await renderFrames(120, 1);
    const worker = new FakeWorker();
    worker.mode = 'error';
    const client = createWorkerDecodeClient(worker);
    await expect(client.decodeFrame(frames[0]!)).rejects.toThrow(/boom/);
    expect(client.busy).toBe(false);
  });

  it('dispose() rejects the pending decode, detaches listeners and terminates the worker', async () => {
    const { frames } = await renderFrames(120, 1);
    const worker = new FakeWorker();
    worker.mode = 'hang';
    const client = createWorkerDecodeClient(worker);
    const pending = client.decodeFrame(frames[0]!);
    client.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(worker.terminated).toBe(true);
    expect(worker.listenerCount()).toBe(0);
  });

  it('refuses a second decode while one is in flight', async () => {
    const { frames } = await renderFrames(120, 1);
    const worker = new FakeWorker();
    worker.mode = 'hang';
    const client = createWorkerDecodeClient(worker);
    void client.decodeFrame(frames[0]!).catch(() => {});
    await expect(client.decodeFrame(frames[0]!)).rejects.toThrow(/in flight/);
  });
});

beforeAll(() => defineOpticalReceive());
afterEach(() => {
  document.body.innerHTML = '';
});

describe('<optical-receive> with a decode worker', () => {
  it('delivers an artifact decoded entirely by the worker', { timeout: 60_000 }, async () => {
    const { frames } = await renderFrames(120, 40);
    const worker = new FakeWorker();
    const el = document.createElement('optical-receive') as OpticalReceiveElement;
    document.body.appendChild(el);
    el.decodeWorker = worker;

    for (const frame of frames) {
      await el.processFrameAsync(frame);
      if (el.state === 'accepted') break;
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(el.state).toBe('accepted');
    expect(worker.requests.length).toBeGreaterThan(0);
  });

  it('falls back to inline decoding if the worker errors, still delivering the artifact', { timeout: 60_000 }, async () => {
    const { frames } = await renderFrames(120, 40);
    const worker = new FakeWorker();
    worker.mode = 'error';
    const el = document.createElement('optical-receive') as OpticalReceiveElement;
    document.body.appendChild(el);
    el.decodeWorker = worker;

    for (const frame of frames) {
      await el.processFrameAsync(frame);
      if (el.state === 'accepted') break;
    }
    await new Promise((r) => setTimeout(r, 20));
    expect(el.state).toBe('accepted');
    expect(worker.terminated).toBe(true);
  });

  it('assigning null detaches and terminates the worker', () => {
    const worker = new FakeWorker();
    const el = document.createElement('optical-receive') as OpticalReceiveElement;
    document.body.appendChild(el);
    el.decodeWorker = worker;
    el.decodeWorker = null;
    expect(worker.terminated).toBe(true);
  });
});
