export type FacingMode = 'environment' | 'user';

/**
 * Thin `getUserMedia` wrapper. Deliberately minimal — hardware access can't
 * be exercised in a headless test environment, so this stays a small,
 * obviously-correct seam rather than something with logic worth unit
 * testing. See `optical-receive.ts` for how the decode loop is structured
 * to be tested independently of this module (via `processFrame()`).
 */
export interface CameraController {
  readonly stream: MediaStream | null;
  start(facingMode?: FacingMode): Promise<MediaStream>;
  stop(): void;
}

export function createCameraController(): CameraController {
  let stream: MediaStream | null = null;
  return {
    get stream() {
      return stream;
    },
    async start(facingMode: FacingMode = 'environment') {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('optical-receive: camera access (getUserMedia) is not available in this environment');
      }
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      return stream;
    },
    stop() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  };
}
