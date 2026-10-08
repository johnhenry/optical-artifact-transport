---
'@johnhenry/oat-receiver': minor
---

Optional off-main-thread QR decoding: `<optical-receive>.decodeWorker = new Worker(...)` (entry point `@johnhenry/oat-receiver/decode-worker-entry`) moves jsQR into a worker, transferring the pixel buffer and dropping frames while a decode is in flight; falls back to inline decoding if the worker fails. Adds `processFrameAsync`, `createWorkerDecodeClient`, `handleDecodeRequest`. Inline decoding remains the default (with the 1280px scan cap).
