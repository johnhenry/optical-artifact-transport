import { checkSandboxEligibility, type SandboxEligibilityInput, type SandboxedHtmlView } from '@johnhenry/oat-protocol';
import { createIframeBridge, type ReceiverUiResponse, type RemoteUiRequest } from './iframe-bridge.js';
import { toTrustedSrcdoc } from './trusted-types.js';

// Re-exported for convenience — the canonical definition lives in `@johnhenry/oat-protocol`
// so `@johnhenry/oat-receiver`'s policy engine and this module can never disagree on it.
export { checkSandboxEligibility, type SandboxEligibility, type SandboxEligibilityInput } from '@johnhenry/oat-protocol';

export interface UnsafeOptInPromptOptions {
  container: Element;
  originLabel: string;
  onActivate: () => void;
  onCancel: () => void;
}

/**
 * The "high-visibility opt-in" gate from the design doc — nothing unsafe
 * renders until the user explicitly clicks through this warning. Call only
 * after `checkSandboxEligibility` already passed.
 */
export function renderUnsafeOptInPrompt(options: UnsafeOptInPromptOptions): void {
  const { container, originLabel, onActivate, onCancel } = options;
  container.replaceChildren();

  const panel = document.createElement('div');
  panel.setAttribute('part', 'trust-warning');

  const warning = document.createElement('p');
  warning.textContent =
    `"${originLabel}" wants to show unverified HTML with its own script, isolated in a sandboxed frame. ` +
    'Nothing it does is trusted by default, and it cannot access this page, your cookies, or any host ' +
    'capability without a separate approval for each request.';
  panel.appendChild(warning);

  const activateBtn = document.createElement('button');
  activateBtn.type = 'button';
  activateBtn.textContent = 'I understand — show this content in an isolated sandbox';
  activateBtn.addEventListener('click', onActivate);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', onCancel);

  panel.append(activateBtn, cancelBtn);
  container.appendChild(panel);
}

export interface SandboxHostOptions {
  view: SandboxedHtmlView;
  /**
   * The receiver-side inputs to `checkSandboxEligibility`. `mountSandboxedHtml`
   * re-evaluates the gate itself and throws (mounting nothing) unless every
   * field is strictly `true`, so the policy engine's decision cannot be
   * bypassed by calling this exported primitive directly.
   */
  eligibility: SandboxEligibilityInput;
  onRequest: (request: RemoteUiRequest, respond: (response: ReceiverUiResponse) => void) => void;
  onRateLimited?: (droppedCount: number) => void;
  rateLimitPerSecond?: number;
}

export interface SandboxHostHandle {
  iframe: HTMLIFrameElement;
  /** The "kill remote UI" / "return to safe rendering" control — also called by the built-in banner button. */
  destroy: () => void;
}

// default-src 'none' first, then allowlist exactly what a sandboxed inline document needs.
const SANDBOXED_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; " +
  "connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Mounts the actual break-glass iframe: `sandbox="allow-scripts"` only (no
 * `allow-same-origin`/`allow-forms`/`allow-popups`/`allow-downloads`/
 * `allow-top-navigation`), `referrerpolicy="no-referrer"`, `allow=""`
 * (no permissions-policy grants), and an injected CSP inside the `srcdoc`
 * document itself. A persistent unsafe-mode banner with a kill switch is
 * always rendered alongside it.
 *
 * Enforces `checkSandboxEligibility` itself, failing closed: it throws —
 * before touching `container` — unless `options.eligibility` is present and
 * every field is strictly `true` (a truthy-but-not-`true` value such as the
 * `'absent'` signature state does not count). The policy engine
 * (`PolicyEngine.decideUi`) is the other enforcement point; both evaluate
 * the same shared function. The user's click-through on
 * `renderUnsafeOptInPrompt` is still the caller's responsibility.
 *
 * @throws if the sandbox eligibility gate does not pass.
 */
export function mountSandboxedHtml(container: Element, options: SandboxHostOptions): SandboxHostHandle {
  const input = options.eligibility as Partial<SandboxEligibilityInput> | undefined;
  if (!input || typeof input !== 'object') {
    throw new Error('mountSandboxedHtml: refusing to mount without sandbox eligibility input');
  }
  const strict: SandboxEligibilityInput = {
    signatureValid: input.signatureValid === true,
    senderTrusted: input.senderTrusted === true,
    allowUnsafeHtml: input.allowUnsafeHtml === true
  };
  const eligibility = checkSandboxEligibility(strict);
  if (!eligibility.eligible) {
    throw new Error(`mountSandboxedHtml: refusing to mount, sandbox eligibility failed: ${eligibility.reasons.join(', ')}`);
  }

  container.replaceChildren();

  const banner = document.createElement('div');
  banner.setAttribute('part', 'trust-warning');
  banner.textContent = 'Unsafe HTML mode active — this frame runs sender-provided script in isolation. ';

  const killBtn = document.createElement('button');
  killBtn.type = 'button';
  killBtn.textContent = 'Kill remote UI / return to safe rendering';
  banner.appendChild(killBtn);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('allow', '');
  iframe.setAttribute('part', 'sandbox-frame');

  const destroy = () => {
    bridge.destroy();
    container.replaceChildren();
  };
  killBtn.addEventListener('click', destroy);

  // `sandbox="allow-scripts"` (deliberately, without `allow-top-navigation`)
  // still lets the sandboxed script navigate *itself* — e.g. `location.href
  // = 'https://attacker.example'` — which is unaffected by any sandbox
  // token. A document reached that way does not carry the CSP <meta> tag
  // below, silently dropping the `connect-src 'none'`/`form-action 'none'`
  // network-isolation guarantee for that new document. Sandbox tokens can't
  // prevent self-navigation, so this detects it out-of-band: the initial
  // `srcdoc` render fires exactly one 'load' event, so any further 'load'
  // means the frame navigated to something else — treat that as a policy
  // violation and tear the whole thing down immediately.
  let hasLoadedOnce = false;
  iframe.addEventListener('load', () => {
    if (!hasLoadedOnce) {
      hasLoadedOnce = true;
      return;
    }
    destroy();
  });

  iframe.srcdoc = toTrustedSrcdoc(
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="${SANDBOXED_CSP}">${options.view.html}`
  );
  container.append(banner, iframe);

  const bridge = createIframeBridge(iframe, {
    rateLimitPerSecond: options.rateLimitPerSecond,
    onRateLimited: options.onRateLimited,
    onRequest: (request) => options.onRequest(request, (response) => bridge.postResponse(response))
  });

  return { iframe, destroy };
}
