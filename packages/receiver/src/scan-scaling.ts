/**
 * Camera frames are downscaled to at most this many pixels wide before the
 * QR decoder sees them.
 *
 * jsQR's cost is linear in pixel count and — until `decode-worker.ts` grows
 * a real `Worker` — it runs on the main thread, so the resolution a frame is
 * scanned at is what decides whether the frame loop fits inside its own
 * interval. Measured on Apple silicon with a 234-byte fountain packet
 * rendered as a QR filling 70 % of frame height, per frame:
 *
 *   1920x1080 scanned natively      34.5 ms
 *   1920x1080 downscaled to 1280    15.4 ms
 *   1920x1080 downscaled to  960    12.6 ms
 *   1280x720  scanned natively      18.4 ms
 *   640x480   scanned natively       7.7 ms
 *
 * At the default `scan-rate` of 8 fps the budget is 125 ms per frame, and a
 * mid-range Android WebView is several times slower than that host, so
 * native-resolution 1080p scanning is the case that saturates the main
 * thread.
 *
 * 1280 is deliberately conservative: it leaves 720p and below untouched and
 * lands a 1080p capture exactly at 720p, a resolution this element is
 * already used at, so it cannot decode worse than an already-supported
 * configuration. Lower values are faster still and are the right call on a
 * slow device, but they cost decode margin — measured here, a QR filling
 * only 40 % of a 720p frame stops decoding once the scan is downscaled to
 * 640 wide.
 */
export const DEFAULT_MAX_SCAN_WIDTH = 1280;

export interface ScanFrameSize {
  width: number;
  height: number;
}

/**
 * The size a `sourceWidth`x`sourceHeight` camera frame should be scanned at,
 * given a `maxWidth` ceiling. Aspect ratio is preserved; frames already at
 * or under the ceiling are returned unchanged, and a `maxWidth` of `0` (or
 * anything non-positive) means "scan natively".
 */
export function scanFrameSize(sourceWidth: number, sourceHeight: number, maxWidth: number): ScanFrameSize {
  if (!(maxWidth > 0) || sourceWidth <= maxWidth) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = maxWidth / sourceWidth;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(sourceHeight * scale))
  };
}
