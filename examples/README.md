# Examples

Two kinds of examples live here:

- **Numbered scripts (`NN-*.mjs`)** — headless, run on Node, no camera or
  display. They use `@johnhenry/oat-sim` (that's its whole point) plus the
  protocol/codec/bootstrap packages directly, and they assert their own
  results — each one doubles as a smoke test and runs in CI.
- **`file-transfer/`** — the full browser demo app (Vite), wiring
  `<optical-send>` and `<optical-receive>` together for real: arbitrary
  file transfer, UI proposals, policy presets, the M5/M6 flows, and the
  `ui.decision` round trip. Start it with `npm run dev:demo` from the repo
  root.

## Running the numbered examples

The scripts import the built packages, so build first:

```bash
npm install
npm run build
npm run examples      # all of them, in order
npm run example:03    # or one at a time
```

## What each one shows

| Script | What it demonstrates |
| --- | --- |
| [`01-round-trip.mjs`](01-round-trip.mjs) | The pipeline by hand: artifact envelope → canonical CBOR → fountain encode → decode from a packet stream → verify → extract. Also shows fountain overhead and why the packet generator is infinite. |
| [`02-lossy-channel.mjs`](02-lossy-channel.mjs) | `oat-sim`'s impairment knobs: recovery under 30% loss + duplicates + reordering, a late-joining receiver, graceful failure under extreme loss (`delivered:false` is a result, not an error), and the corruption invariant — a bad digest is never delivered. |
| [`03-signed-verify-reject.mjs`](03-signed-verify-reject.mjs) | Signatures end to end: a signed artifact through a lossy channel, tamper detection (including the payload+digest swap the signature exists to stop), unsigned-plus-`requireSignature` rejection, and the `signatureValid: 'absent'` trap. |
| [`04-bootstrap-manifest.mjs`](04-bootstrap-manifest.mjs) | The M5 bootstrap flow headless: a signed release manifest over the optical channel, extraction refusing unsigned artifacts, digest-verified HTTPS download with a lying mirror skipped, and the `https:`-only scheme allowlist. |

Every script is deterministic — seeded randomness throughout — so output is
identical on every run.

Full documentation: <https://opensource.johnhenry.me/oat/>
