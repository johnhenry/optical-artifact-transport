# @johnhenry/oat-ui

## 0.2.0

### Minor Changes

- 8d70df4: `mountSandboxedHtml` now enforces `checkSandboxEligibility` itself and fails closed (throws, mounts nothing) unless the new required `eligibility` option is fully satisfied. Previously the gate was enforced only by the receiver's policy engine, although the docblock claimed both layers enforced it. Callers must pass `eligibility: { signatureValid, senderTrusted, allowUnsafeHtml }`. Fixes the `checkSandboxEligibility` docblock.

### Patch Changes

- Updated dependencies [8d70df4]
- Updated dependencies [7d9096c]
  - @johnhenry/oat-protocol@0.2.0
