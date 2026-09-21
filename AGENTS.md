# Agent playbook

Short rulebook for anyone (human or agent) working in this repo. Modeled on
the pattern established in `math-plus`'s `AGENTS.md`.

## The verification loop (before considering anything done)

1. `npm run build` — plain npm workspaces (`npm run build --workspaces
   --if-present`), **not** Turbo. There is no dependency graph enforcing
   build order: packages build in the order listed in the root
   `package.json`'s `"workspaces"` array (`protocol` →
   `codecs/qr-fountain` → `sim` → `sender` → `receiver` → `ui` →
   `bootstrap` → `examples/file-transfer`), which already matches the real
   dependency order (see the README's Architecture pipeline). If you add a
   package, insert it into that array in the right dependency position —
   nothing else will catch an out-of-order build for you.
2. `npm test` — Vitest at the root (`vitest.config.ts`), not per-package.
   Tests that touch DOM/canvas surfaces run against `happy-dom` /
   `@napi-rs/canvas`, not a real browser — the examples (below) are the
   check against a closer-to-real environment.
3. `npm run typecheck` (`tsc -b --pretty` — a composite build, so it also
   catches project-reference misconfiguration between packages).
4. `npm run examples` — four numbered, headless examples exercise the full
   envelope → fountain-encode → decode → verify pipeline via
   `@johnhenry/oat-sim`, with no camera or display required. These are the
   CI smoke test; run them after any change to `protocol`, `qr-fountain`,
   or `sim`.
5. Only then commit/push.

## Repo-specific gotchas

- **This is a security-sensitive transport.** The receiver must never
  deliver unverified bytes to the host app, and M6 (unsafe-HTML
  break-glass) eligibility requires *all* of: verified signature, signer
  on `trustedPublicKeys`, and `allowUnsafeHtml` opted in. If you touch
  verification, trust, or the M6 sandbox path, treat "fails closed" as a
  correctness requirement, not a nice-to-have — see the README's Security
  model section and `packages/ui/src/trusted-types.ts` before changing
  anything there.
- **No per-package `CHANGELOG.md` or `LICENSE`** beyond what's already
  present. This repo's convention is a root `CHANGELOG.md`; per-package
  `LICENSE` files exist already (added at package creation) but version
  history is tracked only at the root — don't start per-package
  changelogs.
- **`packages/codecs/` is a grouping directory, not a package** — it has
  no `package.json` of its own. The actual package lives at
  `packages/codecs/qr-fountain`. Future codecs (denser grids, low-salience
  modulation) would slot in as siblings under `packages/codecs/`.
- **No Rust/Cargo** — this is a pure TypeScript/npm workspace despite the
  "optical"/hardware-adjacent subject matter (camera/display are accessed
  via browser APIs, not native bindings).
