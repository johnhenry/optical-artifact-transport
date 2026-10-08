# @johnhenry/oat-protocol

## 0.2.0

### Minor Changes

- 7d9096c: Security: implement the three replay controls named in the design doc. `expiresAt` is now mandatory (`buildArtifact` defaults to one hour, `verifyArtifact` rejects a missing one unless `requireExpiry: false`); artifacts carry a signed `nonce` and a receiver-side bounded `ReplayGuard` rejects repeats (`<optical-receive>` enables one by default); an optional signed `sessionId` is checked against `expectedSessionId` / the `session-id` attribute. Artifacts lacking expiry or nonce from older senders are now rejected by default.

### Patch Changes

- 8d70df4: `mountSandboxedHtml` now enforces `checkSandboxEligibility` itself and fails closed (throws, mounts nothing) unless the new required `eligibility` option is fully satisfied. Previously the gate was enforced only by the receiver's policy engine, although the docblock claimed both layers enforced it. Callers must pass `eligibility: { signatureValid, senderTrusted, allowUnsafeHtml }`. Fixes the `checkSandboxEligibility` docblock.
