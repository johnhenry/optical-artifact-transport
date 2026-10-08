# @johnhenry/oat-receiver

## 0.2.0

### Minor Changes

- eaa1070: Optional off-main-thread QR decoding: `<optical-receive>.decodeWorker = new Worker(...)` (entry point `@johnhenry/oat-receiver/decode-worker-entry`) moves jsQR into a worker, transferring the pixel buffer and dropping frames while a decode is in flight; falls back to inline decoding if the worker fails. Adds `processFrameAsync`, `createWorkerDecodeClient`, `handleDecodeRequest`. Inline decoding remains the default (with the 1280px scan cap).
- 7d9096c: Security: implement the three replay controls named in the design doc. `expiresAt` is now mandatory (`buildArtifact` defaults to one hour, `verifyArtifact` rejects a missing one unless `requireExpiry: false`); artifacts carry a signed `nonce` and a receiver-side bounded `ReplayGuard` rejects repeats (`<optical-receive>` enables one by default); an optional signed `sessionId` is checked against `expectedSessionId` / the `session-id` attribute. Artifacts lacking expiry or nonce from older senders are now rejected by default.

### Patch Changes

- 8d70df4: `mountSandboxedHtml` now enforces `checkSandboxEligibility` itself and fails closed (throws, mounts nothing) unless the new required `eligibility` option is fully satisfied. Previously the gate was enforced only by the receiver's policy engine, although the docblock claimed both layers enforced it. Callers must pass `eligibility: { signatureValid, senderTrusted, allowUnsafeHtml }`. Fixes the `checkSandboxEligibility` docblock.
- Updated dependencies [8d70df4]
- Updated dependencies [7d9096c]
  - @johnhenry/oat-protocol@0.2.0
