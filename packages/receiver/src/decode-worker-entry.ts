import { handleDecodeRequest, type DecodeRequest } from './decode-worker.js';

/**
 * Module-worker entry point. Host apps start it with their bundler's worker
 * syntax, e.g.
 *
 *   new Worker(new URL('@johnhenry/oat-receiver/decode-worker-entry', import.meta.url), { type: 'module' })
 *
 * and hand it to `<optical-receive>.decodeWorker`.
 */
const scope = globalThis as unknown as {
  addEventListener(type: 'message', listener: (event: { data: DecodeRequest }) => void): void;
  postMessage(message: unknown): void;
};

scope.addEventListener('message', (event) => {
  if (event.data?.type !== 'decode') return;
  scope.postMessage(handleDecodeRequest(event.data));
});
