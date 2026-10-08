import { decodePacketFromImageData, type ImageDataLike } from '@johnhenry/oat-qr-fountain/decode';
import type { OatPacket } from '@johnhenry/oat-qr-fountain/fountain';

/**
 * QR decode is a pure function of one video frame's pixels, so it can run
 * off the main thread. jsQR's cost is linear in pixel count; even after
 * `scan-scaling.ts` caps the scan width, a 720p frame costs ~15 ms on a fast
 * desktop and several times that on a mid-range phone, against a 125 ms
 * frame interval that the host page's own UI shares.
 *
 * Two implementations sit behind `DecodeWorker`/`AsyncDecodeWorker`:
 *
 * - `createInlineDecodeWorker()` — decodes on the calling thread. The
 *   default, because it needs no bundler support.
 * - `createWorkerDecodeClient(worker)` — talks to a real `Worker` running
 *   `decode-worker-entry.ts` (shipped as `@johnhenry/oat-receiver/decode-worker-entry`).
 *   Opt in with `<optical-receive>.decodeWorker = new Worker(...)`.
 *   Constructing the `Worker` stays with the host app deliberately:
 *   `new Worker(new URL(..., import.meta.url), { type: 'module' })`
 *   resolves differently under Vite, webpack, esbuild and plain
 *   `<script type=module>`, so this package does not guess.
 *
 * This module has no DOM dependency beyond the structural `ImageDataLike`
 * shape, so it runs unmodified inside a `Worker`.
 */
export interface DecodeWorker {
  decodeFrame(image: ImageDataLike): OatPacket | null;
}

export function createInlineDecodeWorker(): DecodeWorker {
  return {
    decodeFrame: (image) => decodePacketFromImageData(image)
  };
}

/** Request posted to the decode worker. `data` is RGBA, transferred (not copied). */
export interface DecodeRequest {
  type: 'decode';
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type DecodeResponse =
  | { type: 'result'; id: number; packet: OatPacket | null }
  | { type: 'error'; id: number; message: string };

/**
 * The worker-side handler: pure, synchronous, never throws. A frame with no
 * QR code is `packet: null`; anything that makes decoding itself fail
 * (e.g. a buffer whose length is not width*height*4) becomes an `error`
 * response so one bad frame cannot take down the worker.
 */
export function handleDecodeRequest(request: DecodeRequest): DecodeResponse {
  try {
    const packet = decodePacketFromImageData({ data: request.data, width: request.width, height: request.height });
    return { type: 'result', id: request.id, packet };
  } catch (err) {
    return { type: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) };
  }
}

/** The subset of `Worker` the client uses — also satisfied by test fakes and `MessagePort`-likes. */
export interface WorkerLike {
  postMessage(message: DecodeRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
  terminate(): void;
}

export interface AsyncDecodeWorker {
  /** Rejects if a decode is already in flight, the worker errors, or the client is disposed. */
  decodeFrame(image: ImageDataLike): Promise<OatPacket | null>;
  /** True while a decode is in flight; the frame loop drops frames rather than queueing them. */
  readonly busy: boolean;
  /** Rejects any pending decode, detaches listeners and terminates the worker. */
  dispose(): void;
}

export function createWorkerDecodeClient(worker: WorkerLike): AsyncDecodeWorker {
  let nextId = 1;
  let pending: { id: number; resolve: (p: OatPacket | null) => void; reject: (e: Error) => void } | null = null;
  let disposed = false;

  const onMessage = (event: { data: DecodeResponse }): void => {
    const response = event.data;
    if (!pending || !response || response.id !== pending.id) return;
    const current = pending;
    pending = null;
    if (response.type === 'result') current.resolve(response.packet);
    else current.reject(new Error(response.message));
  };
  const onError = (event: { message?: string }): void => {
    if (!pending) return;
    const current = pending;
    pending = null;
    current.reject(new Error(event?.message ?? 'decode worker error'));
  };
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);

  return {
    get busy() {
      return pending !== null;
    },
    decodeFrame(image) {
      if (disposed) return Promise.reject(new Error('decode worker client disposed'));
      if (pending) return Promise.reject(new Error('a decode is already in flight'));
      return new Promise<OatPacket | null>((resolve, reject) => {
        const id = nextId++;
        pending = { id, resolve, reject };
        // Copy-free hand-off: the buffer is transferred, so the sender's view is detached.
        const data = image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
        worker.postMessage({ type: 'decode', id, width: image.width, height: image.height, data }, [data.buffer]);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.terminate();
      if (pending) {
        const current = pending;
        pending = null;
        current.reject(new Error('decode worker client disposed'));
      }
    }
  };
}
