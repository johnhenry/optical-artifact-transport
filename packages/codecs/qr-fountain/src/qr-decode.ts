import jsQR from 'jsqr';
import { decodePacket, type OatPacket } from './packet.js';

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
