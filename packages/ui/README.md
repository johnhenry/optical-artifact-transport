# @johnhenry/oat-ui

Receiver-owned rendering for sender-proposed UI: the pinned allowlist
sanitizer, the safe-view and safe-html renderers, the capability and trust
prompts, and the M6 sandbox host with its typed iframe bridge. The rule this
package enforces: **the sender proposes, the receiver renders** — sender
markup is input to sanitization, never something that executes.

```sh
npm install @johnhenry/oat-ui
```

## Quick start

```js
import { renderSafeView, renderSafeHtml, sanitizeHtml } from '@johnhenry/oat-ui';

receiver.addEventListener('oat-ui-proposal', (e) => {
  const { proposal, decision } = e.detail;
  if (decision.outcome !== 'accept-safe') return; // downgraded/rejected — show your own fallback

  const context = { proposalId: proposal.proposalId };
  const onAction = (action) => {
    // typed, receiver-mediated UiActionRequest — re-check capability at point of use
  };

  const view = proposal.preferredView;
  if (view.kind === 'safe-html') {
    renderSafeHtml(container, view, context, onAction);
  } else {
    renderSafeView(container, view, context, onAction); // text / form / media — plain DOM, never innerHTML
  }
});
```

`sanitizeHtml(html, profile)` returns a `DocumentFragment` built from a
pinned allowlist — profiles: `'text-only'`, `'strict'`, `'rich-text'`,
`'forms'`, `'media'`, `'custom'`.

## The traps

- **The sanitizer strips by allowlist, not blocklist.** `<script>`,
  `<style>`, `<iframe>`, `<object>`, event handlers, and `javascript:` URLs
  (including control-character-obfuscated ones) are gone regardless of
  profile; disallowed tags are unwrapped to their text, code-bearing tags
  are dropped subtree and all. URI attributes only survive on
  `http`/`https`/`mailto`/`tel`.
- **Resource limits apply to the sanitized result**, not to parsing the raw
  input — `maxNodes`/`maxDepth`/`maxTextBytes` per profile guard against
  markup bombs surviving sanitization.
- **Native `Element.setHTML()` is a pre-pass, not the sanitizer.** When the
  runtime supports it, it runs ahead of the pinned allowlist with an
  explicit per-profile config — the native *default* config silently drops
  `<form>`/`<button>` in Chrome, which is stricter than the `forms` profile
  intends. The pinned allowlist still runs either way, so behavior doesn't
  drift across browsers.
- **`mountSandboxedHtml` (M6) is not a convenience API.** It exists for the
  break-glass path only: `sandbox="allow-scripts"` with *none* of
  `allow-same-origin`/`allow-forms`/`allow-popups`/`allow-downloads`/
  `allow-top-navigation`, a rate-limited typed postMessage bridge, and
  self-navigation teardown (a second `load` event after the initial
  `srcdoc` render kills the frame — sandbox tokens don't gate
  self-navigation, so the host watches for it out-of-band). Eligibility is
  decided upstream by `checkSandboxEligibility`; don't mount without it.
- **Trusted Types**: under `Content-Security-Policy:
  require-trusted-types-for 'script'`, the host must allow the
  `oat-sandbox-srcdoc` policy (or `trusted-types *`) or the M6 iframe's
  `srcdoc` assignment throws. Not optional under that CSP.

## API surface

| Area | Exports |
| --- | --- |
| Sanitizer | `sanitizeHtml`, `SanitizerRules`, `DEFAULT_URI_SCHEMES` |
| Renderers | `renderSafeView` (`text`/`form`/`media` descriptors — the `form` kind is typed field descriptors, no HTML at all), `renderSafeHtml` |
| Prompts | `renderCapabilityPrompt` (+ `CapabilityAuditRecord`), `renderTrustPrompt`/`formatFingerprint` (the TOFU "confirm public key" prompt), `renderUnsafeOptInPrompt` |
| M6 sandbox | `mountSandboxedHtml`, `SandboxHostHandle`, `createIframeBridge`, `parseRemoteUiRequest`, typed bridge message types |
| Trusted Types | `toTrustedSrcdoc`, `OAT_SANDBOX_SRCDOC_POLICY_NAME` |
| Re-exports | `checkSandboxEligibility` from `@johnhenry/oat-protocol` |

## Docs

Full documentation: <https://opensource.johnhenry.me/oat/> — the
[security model page](https://opensource.johnhenry.me/oat/security/) covers
the four rendering outcomes, M6 eligibility, and Trusted Types.

## License

MIT
