import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIframeBridge, parseRemoteUiRequest } from '../src/iframe-bridge.js';

describe('parseRemoteUiRequest', () => {
  it('accepts every known message shape', () => {
    expect(parseRemoteUiRequest({ type: 'ui.ready' })).toEqual({ type: 'ui.ready' });
    expect(parseRemoteUiRequest({ type: 'ui.resize', height: 200 })).toEqual({ type: 'ui.resize', height: 200 });
    expect(parseRemoteUiRequest({ type: 'request.capability', requestId: 'r1', capability: 'ui.action.submit' })).toEqual({
      type: 'request.capability',
      requestId: 'r1',
      capability: 'ui.action.submit',
      reason: undefined
    });
    expect(parseRemoteUiRequest({ type: 'request.action', requestId: 'r2', action: 'approve' })).toEqual({
      type: 'request.action',
      requestId: 'r2',
      action: 'approve',
      payload: undefined
    });
    expect(parseRemoteUiRequest({ type: 'submit.form', requestId: 'r3', payload: { a: 1 } })).toEqual({
      type: 'submit.form',
      requestId: 'r3',
      payload: { a: 1 }
    });
  });

  it('rejects an unrecognized message type', () => {
    expect(parseRemoteUiRequest({ type: 'ui.execute-arbitrary-code' })).toBeNull();
  });

  it('rejects malformed payloads for known types', () => {
    expect(parseRemoteUiRequest({ type: 'ui.resize', height: 'not-a-number' })).toBeNull();
    expect(parseRemoteUiRequest({ type: 'request.capability', capability: 'x' })).toBeNull(); // missing requestId
    expect(parseRemoteUiRequest({ type: 'submit.form', requestId: 'r', payload: 'not-an-object' })).toBeNull();
  });

  it('rejects non-object and null input', () => {
    expect(parseRemoteUiRequest(null)).toBeNull();
    expect(parseRemoteUiRequest('a string')).toBeNull();
    expect(parseRemoteUiRequest([1, 2, 3])).toBeNull();
    expect(parseRemoteUiRequest(42)).toBeNull();
  });
});

function fakeIframe() {
  const contentWindow = { postMessage: vi.fn() };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  return { iframe, contentWindow };
}

describe('createIframeBridge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers well-formed messages from the bound iframe to onRequest', () => {
    const { iframe, contentWindow } = fakeIframe();
    const onRequest = vi.fn();
    const bridge = createIframeBridge(iframe, { onRequest });

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'ui.ready' }, source: contentWindow as unknown as Window }));

    expect(onRequest).toHaveBeenCalledWith({ type: 'ui.ready' });
    bridge.destroy();
  });

  it('ignores messages whose source is not this iframe (spoofed postMessage)', () => {
    const { iframe } = fakeIframe();
    const spoofedSource = { postMessage: vi.fn() };
    const onRequest = vi.fn();
    const bridge = createIframeBridge(iframe, { onRequest });

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'ui.ready' }, source: spoofedSource as unknown as Window })
    );

    expect(onRequest).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it('ignores malformed/unknown message types even from the correct source', () => {
    const { iframe, contentWindow } = fakeIframe();
    const onRequest = vi.fn();
    const bridge = createIframeBridge(iframe, { onRequest });

    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'exfiltrate.cookies' }, source: contentWindow as unknown as Window })
    );
    window.dispatchEvent(new MessageEvent('message', { data: 'just a string', source: contentWindow as unknown as Window }));

    expect(onRequest).not.toHaveBeenCalled();
    bridge.destroy();
  });

  it('rate-limits a flood of messages within one window and reports the drop count', () => {
    const { iframe, contentWindow } = fakeIframe();
    const onRequest = vi.fn();
    const onRateLimited = vi.fn();
    const bridge = createIframeBridge(iframe, { onRequest, rateLimitPerSecond: 3, onRateLimited });

    for (let i = 0; i < 10; i++) {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'ui.ready' }, source: contentWindow as unknown as Window }));
    }

    expect(onRequest).toHaveBeenCalledTimes(3);

    // Trigger the next window boundary to flush the drop count.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'ui.ready' }, source: contentWindow as unknown as Window }));
    expect(onRateLimited).toHaveBeenCalledWith(7);

    bridge.destroy();
  });

  it('postResponse posts directly to the bound iframe contentWindow with targetOrigin "*"', () => {
    const { iframe, contentWindow } = fakeIframe();
    const bridge = createIframeBridge(iframe, { onRequest: vi.fn() });

    bridge.postResponse({ type: 'policy', grantedCapabilities: ['ui.render.text'] });

    expect(contentWindow.postMessage).toHaveBeenCalledWith({ type: 'policy', grantedCapabilities: ['ui.render.text'] }, '*');
    bridge.destroy();
  });

  it('destroy() stops delivering further messages and further responses', () => {
    const { iframe, contentWindow } = fakeIframe();
    const onRequest = vi.fn();
    const bridge = createIframeBridge(iframe, { onRequest });
    bridge.destroy();

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'ui.ready' }, source: contentWindow as unknown as Window }));
    bridge.postResponse({ type: 'policy', grantedCapabilities: [] });

    expect(onRequest).not.toHaveBeenCalled();
    expect(contentWindow.postMessage).not.toHaveBeenCalled();
  });
});
