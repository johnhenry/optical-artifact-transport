import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { encodePacket, decodePacket, type OatPacket } from './packet.js';

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

export interface ImageDataLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decodes a camera/video frame back into a fountain packet, or `null` if no valid QR was found. */
export function decodePacketFromImageData(image: ImageDataLike): OatPacket | null {
  const result = jsQR(image.data, image.width, image.height);
  if (!result) return null;

  const raw =
    result.binaryData && result.binaryData.length > 0
      ? Uint8Array.from(result.binaryData)
      : Uint8Array.from(result.data, (ch) => ch.charCodeAt(0) & 0xff);

  return decodePacket(raw);
}

/**
 * Cycles through a fixed buffer of packets forever, round-robin. The
 * `<optical-send>` element drives the actual frame-rate timing (rAF /
 * setInterval); this just tracks "which packet is next".
 */
export class PacketCycle {
  private index = 0;
  constructor(private readonly packets: readonly OatPacket[]) {
    if (packets.length === 0) throw new Error('PacketCycle requires at least one packet');
  }

  next(): OatPacket {
    const packet = this.packets[this.index] as OatPacket;
    this.index = (this.index + 1) % this.packets.length;
    return packet;
  }
}
