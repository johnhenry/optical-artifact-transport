---
'@johnhenry/oat-protocol': minor
'@johnhenry/oat-receiver': minor
---

Security: implement the three replay controls named in the design doc. `expiresAt` is now mandatory (`buildArtifact` defaults to one hour, `verifyArtifact` rejects a missing one unless `requireExpiry: false`); artifacts carry a signed `nonce` and a receiver-side bounded `ReplayGuard` rejects repeats (`<optical-receive>` enables one by default); an optional signed `sessionId` is checked against `expectedSessionId` / the `session-id` attribute. Artifacts lacking expiry or nonce from older senders are now rejected by default.
