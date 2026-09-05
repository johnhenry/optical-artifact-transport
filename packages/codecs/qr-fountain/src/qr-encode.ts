import QRCode from 'qrcode';
import { encodePacket, type OatPacket } from './packet.js';

export interface QrRenderOptions {
  /** 'L' | 'M' | 'Q' | 'H' — higher tolerates more camera-side noise, at lower capacity. */
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  margin?: number;
  scale?: number;
  width?: number;
}

type CanvasLike = Parameters<typeof QRCode.toCanvas>[0];

/** Renders one fountain packet as a QR code onto `canvas` (browser `<canvas>` or node-canvas-compatible). */
export async function renderPacketToCanvas(
  canvas: CanvasLike,
  packet: OatPacket,
  options: QrRenderOptions = {}
): Promise<void> {
  const bytes = encodePacket(packet);
  await QRCode.toCanvas(canvas, [{ data: bytes, mode: 'byte' }], {
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: options.margin ?? 2,
    scale: options.scale,
    width: options.width
  });
}

/** Renders one fountain packet as a QR code to a data: URL (useful for static previews/manifests). */
export async function renderPacketToDataUrl(
  packet: OatPacket,
  options: QrRenderOptions = {}
): Promise<string> {
  const bytes = encodePacket(packet);
  return QRCode.toDataURL([{ data: bytes, mode: 'byte' }], {
    errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
    margin: options.margin ?? 2,
    scale: options.scale,
    width: options.width
  });
}
