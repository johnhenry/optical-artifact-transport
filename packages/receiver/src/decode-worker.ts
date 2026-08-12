import { decodePacketFromImageData, type ImageDataLike, type OatPacket } from '@oat/qr-fountain';

/**
 * QR decode is a pure function of one video frame's pixels — a natural fit
 * for a Web Worker so the main thread stays free for UI/permission prompts,
 * as called for in the design doc's M3 milestone. This module intentionally
 * has no DOM dependency beyond the structural `ImageDataLike` shape, so it
 * can run unmodified inside a `Worker`.
 *
 * This first pass runs it inline on the calling thread (`InlineDecodeWorker`)
 * rather than wiring an actual `Worker`/`postMessage` bridge, since that
 * requires bundler-specific worker imports this package doesn't want to
 * assume. Swapping in a real worker later means moving `decodeFrame` behind
 * a `postMessage`/`onmessage` pair — the decode logic itself does not change.
 */
export interface DecodeWorker {
  decodeFrame(image: ImageDataLike): OatPacket | null;
}

export function createInlineDecodeWorker(): DecodeWorker {
  return {
    decodeFrame: (image) => decodePacketFromImageData(image)
  };
}
