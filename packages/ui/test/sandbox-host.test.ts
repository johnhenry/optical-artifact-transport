import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SandboxedHtmlView } from '@oat/protocol';
import { checkSandboxEligibility, mountSandboxedHtml, renderUnsafeOptInPrompt } from '../src/sandbox-host.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('checkSandboxEligibility', () => {
  it('is eligible only when the signature is valid, the sender is trusted, AND the receiver explicitly allows unsafe HTML', () => {
    expect(checkSandboxEligibility({ signatureValid: true, senderTrusted: true, allowUnsafeHtml: true }).eligible).toBe(true);
  });

  it('refuses when the signature was not verified, regardless of receiver policy', () => {
    const result = checkSandboxEligibility({ signatureValid: false, senderTrusted: true, allowUnsafeHtml: true });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('signature-required');
  });

  it('refuses when the sender is not on the receiver trust list, even with a valid signature (self-signed bypass)', () => {
    const result = checkSandboxEligibility({ signatureValid: true, senderTrusted: false, allowUnsafeHtml: true });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('sender-not-trusted');
  });

  it('refuses when the receiver has not opted in, even for a validly signed, trusted-sender artifact', () => {
    const result = checkSandboxEligibility({ signatureValid: true, senderTrusted: true, allowUnsafeHtml: false });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('receiver-policy-disallows-unsafe-html');
  });

  it('a sender cannot influence eligibility at all — it depends only on receiver-side inputs', () => {
    // There is no `view`/`proposal` parameter to this function at all — this test documents that
    // by construction, not by exercising a bypass attempt.
    const result = checkSandboxEligibility({ signatureValid: false, senderTrusted: false, allowUnsafeHtml: false });
    expect(result.reasons).toEqual(['signature-required', 'sender-not-trusted', 'receiver-policy-disallows-unsafe-html']);
  });
});

describe('renderUnsafeOptInPrompt', () => {
  it('renders a warning naming the origin and does not render anything unsafe yet', () => {
    const container = document.createElement('div');
    renderUnsafeOptInPrompt({ container, originLabel: 'Evil Corp', onActivate: vi.fn(), onCancel: vi.fn() });

    expect(container.textContent).toContain('Evil Corp');
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('only calls onActivate after the explicit opt-in click', () => {
    const container = document.createElement('div');
    const onActivate = vi.fn();
    renderUnsafeOptInPrompt({ container, originLabel: 'x', onActivate, onCancel: vi.fn() });

    expect(onActivate).not.toHaveBeenCalled();
    [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('isolated sandbox'))!.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('cancel calls onCancel and not onActivate', () => {
    const container = document.createElement('div');
    const onActivate = vi.fn();
    const onCancel = vi.fn();
    renderUnsafeOptInPrompt({ container, originLabel: 'x', onActivate, onCancel });

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

const view: SandboxedHtmlView = {
  kind: 'sandboxed-html',
  title: 'Break glass',
  html: '<button id="go">go</button><script>window.parent.postMessage({type:"ui.ready"}, "*")</script>'
};

describe('mountSandboxedHtml', () => {
  it('sets sandbox="allow-scripts" and nothing else — no allow-same-origin/forms/popups/downloads/top-navigation', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { iframe } = mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    for (const forbidden of ['allow-same-origin', 'allow-forms', 'allow-popups', 'allow-downloads', 'allow-top-navigation']) {
      expect(iframe.getAttribute('sandbox')).not.toContain(forbidden);
    }
  });

  it('sets referrerpolicy=no-referrer and an empty Permissions-Policy (allow="")', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { iframe } = mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(iframe.getAttribute('allow')).toBe('');
  });

  it('injects a restrictive CSP into the srcdoc document ahead of the sender HTML', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { iframe } = mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(iframe.srcdoc).toContain("default-src 'none'");
    expect(iframe.srcdoc).toContain("connect-src 'none'");
    expect(iframe.srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(iframe.srcdoc.indexOf('<button id="go">'));
  });

  it('renders a persistent unsafe-mode banner alongside the frame', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(container.textContent).toContain('Unsafe HTML mode active');
  });

  it('the kill-switch button removes the frame and banner entirely', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(container.querySelector('iframe')).not.toBeNull();
    container.querySelector('button')!.click();

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).not.toContain('Unsafe HTML mode active');
  });

  it('destroy() also works as a direct handle call, independent of the banner button', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    handle.destroy();
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('routes a real postMessage from the mounted iframe to onRequest, and responds back through the same bridge', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const onRequest = vi.fn((request, respond) => {
      if (request.type === 'ui.ready') respond({ type: 'policy', grantedCapabilities: [] });
    });
    const { iframe } = mountSandboxedHtml(container, { view, onRequest });

    const postMessageSpy = vi.spyOn(iframe.contentWindow as Window, 'postMessage');

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'ui.ready' }, source: iframe.contentWindow as unknown as Window })
    );

    expect(onRequest).toHaveBeenCalledWith({ type: 'ui.ready' }, expect.any(Function));
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'policy', grantedCapabilities: [] }, '*');
  });

  it('ignores a postMessage claiming to be from this iframe but sourced from elsewhere', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onRequest = vi.fn();
    mountSandboxedHtml(container, { view, onRequest });

    const otherContainer = document.createElement('div');
    document.body.appendChild(otherContainer);
    const otherIframe = document.createElement('iframe');
    otherContainer.appendChild(otherIframe);

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'ui.ready' }, source: otherIframe.contentWindow as unknown as Window })
    );

    expect(onRequest).not.toHaveBeenCalled();
  });

  it('auto-destroys if the sandboxed iframe self-navigates away from its initial srcdoc (CSP-bypass mitigation)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mountSandboxedHtml(container, { view, onRequest: vi.fn() });

    expect(container.querySelector('iframe')).not.toBeNull();

    // happy-dom doesn't fire a real 'load' for srcdoc content, so the first
    // dispatch here stands in for that initial, legitimate load — it must
    // NOT trigger destroy. The second simulates an actual navigation.
    handle.iframe.dispatchEvent(new Event('load'));
    expect(container.querySelector('iframe')).not.toBeNull();

    handle.iframe.dispatchEvent(new Event('load'));
    expect(container.querySelector('iframe')).toBeNull();
  });
});
