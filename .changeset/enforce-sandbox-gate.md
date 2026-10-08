---
'@johnhenry/oat-ui': minor
'@johnhenry/oat-protocol': patch
'@johnhenry/oat-receiver': patch
---

`mountSandboxedHtml` now enforces `checkSandboxEligibility` itself and fails closed (throws, mounts nothing) unless the new required `eligibility` option is fully satisfied. Previously the gate was enforced only by the receiver's policy engine, although the docblock claimed both layers enforced it. Callers must pass `eligibility: { signatureValid, senderTrusted, allowUnsafeHtml }`. Fixes the `checkSandboxEligibility` docblock.
