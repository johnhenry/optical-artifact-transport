import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyArtifact, generateSigningKey, decodeCanonical, isOatArtifact, buildArtifact } from '@oat/protocol';
import { defineOpticalSend, OpticalSendElement } from '../src/optical-send.js';

/**
 * happy-dom (this package's test environment) has no real 2D canvas — QR
 * rendering itself is exercised end to end with a genuine canvas in
 * `@oat/qr-fountain`'s test suite. These tests cover everything the sender
 * element controls that doesn't require actual pixels: artifact
 * construction, the slots -> UiProposalEnvelope authoring pipeline,
 * lifecycle state, and event wiring. `#tick()`'s render failures under
 * happy-dom are expected and asserted on directly, as a proof the sender
 * degrades to an `oat-error` event rather than crashing the transmit loop.
 */
beforeAll(() => {
  defineOpticalSend();
});

function mount(html: string): OpticalSendElement {
  const el = document.createElement('optical-send') as OpticalSendElement;
  document.body.appendChild(el);
  if (html) el.innerHTML = html;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('<optical-send> artifact preparation', () => {
  it('builds a manifest-ready artifact from a literal text source', async () => {
    const el = mount('');
    const readyEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-manifest-ready', (e) => resolve(e as CustomEvent), { once: true })
    );

    el.source = 'hello optical world';
    await readyEvent;

    expect(el.state).toBe('manifest-ready');
    expect(el.artifact).not.toBeNull();
    expect(el.artifact?.mediaType).toBe('text/plain');
    expect(verifyArtifact(el.artifact!).valid).toBe(true);
  });

  it('signs the artifact when a signingKey is provided and verify="signature" is set', async () => {
    const el = mount('');
    el.setAttribute('verify', 'signature');
    const { secretKey } = generateSigningKey();
    el.signingKey = { secretKey, keyId: 'sender-key' };

    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = 'sign me';
    await readyEvent;

    expect(el.artifact?.signature).toBeDefined();
    expect(verifyArtifact(el.artifact!, { requireSignature: true }).valid).toBe(true);
  });

  it('errors when verify="signature" is set without a signingKey', async () => {
    const el = mount('');
    el.setAttribute('verify', 'signature');

    const errorEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-error', (e) => resolve(e as CustomEvent), { once: true })
    );
    el.source = 'unsigned attempt';
    await errorEvent;

    expect(el.state).toBe('error');
  });

  it('builds a UiProposalEnvelope from slotted <template> markup', async () => {
    const el = mount(`
      <template slot="proposal">
        <form>
          <button data-optical-action="submit" data-optical-capability="agent.session.import">Go</button>
        </form>
      </template>
      <template slot="fallback"><p>Fallback text</p></template>
    `);
    el.setAttribute('title', 'Agent handoff');

    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = 'payload bytes';
    await readyEvent;

    const proposal = el.artifact?.uiProposal;
    expect(proposal).toBeDefined();
    expect(proposal?.title).toBe('Agent handoff');
    expect(proposal?.requestedCapabilities).toEqual([{ capability: 'agent.session.import' }]);
    expect(proposal?.preferredView.kind).toBe('safe-html');
    expect(proposal?.fallbackView).toEqual({ kind: 'text', body: '<p>Fallback text</p>' });
  });

  it('produces no uiProposal when no proposal template is slotted', async () => {
    const el = mount('');
    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = 'plain transfer';
    await readyEvent;

    expect(el.artifact?.uiProposal).toBeUndefined();
  });

  it('the prepared artifact envelope round-trips through canonical CBOR (what the wire actually carries)', async () => {
    const el = mount('');
    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = 'round trip me';
    await readyEvent;

    const { encodeCanonical } = await import('@oat/protocol');
    const bytes = encodeCanonical(el.artifact) as Uint8Array;
    const decoded = decodeCanonical(bytes);
    expect(isOatArtifact(decoded)).toBe(true);
  });
});

describe('<optical-send>.sendArtifact()', () => {
  it('transmits a pre-built artifact directly, bypassing envelope construction', async () => {
    const el = mount('');
    const prebuilt = await buildArtifact({
      mediaType: 'application/vnd.oat.release-manifest+json',
      payload: new TextEncoder().encode('{"hello":"bootstrap"}')
    });

    const readyEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-manifest-ready', (e) => resolve(e as CustomEvent), { once: true })
    );
    el.sendArtifact(prebuilt);
    const evt = await readyEvent;

    expect(el.state).toBe('manifest-ready');
    expect(el.artifact).toBe(prebuilt);
    expect(evt.detail.artifact.id).toBe(prebuilt.id);
  });
});

describe('<optical-send> transmit lifecycle', () => {
  it('transitions idle -> transmitting -> paused -> transmitting via toggle()', async () => {
    const el = mount('');
    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = new Uint8Array(500);
    await readyEvent;

    expect(el.state).toBe('manifest-ready');
    el.start();
    expect(el.state).toBe('transmitting');
    el.toggle();
    expect(el.state).toBe('paused');
    el.toggle();
    expect(el.state).toBe('transmitting');
    el.stop();
  });

  it('increments framesSent on a timer and stops cleanly', async () => {
    vi.useFakeTimers();
    const el = mount('');
    el.setAttribute('frame-rate', '10');
    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = new Uint8Array(300);
    await readyEvent;

    el.start();
    expect(el.framesSent).toBe(1); // first frame renders immediately
    vi.advanceTimersByTime(350); // ~3-4 more ticks at 10fps
    expect(el.framesSent).toBeGreaterThan(1);

    el.stop();
    const framesAtStop = el.framesSent;
    vi.advanceTimersByTime(500);
    expect(el.framesSent).toBe(framesAtStop);
    vi.useRealTimers();
  });

  it('dispatches oat-error for a per-frame render failure without stopping the loop', async () => {
    const el = mount('');
    const readyEvent = new Promise<void>((resolve) =>
      el.addEventListener('oat-manifest-ready', () => resolve(), { once: true })
    );
    el.source = new Uint8Array(200);
    await readyEvent;

    const errorEvent = new Promise<CustomEvent>((resolve) =>
      el.addEventListener('oat-error', (e) => resolve(e as CustomEvent), { once: true })
    );
    el.start();
    const evt = await errorEvent;

    expect(evt.detail.phase).toBe('render');
    expect(el.framesSent).toBeGreaterThanOrEqual(1); // counting continued despite the render failure
    el.stop();
  });
});
