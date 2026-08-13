import { describe, expect, it, vi } from 'vitest';
import { formatFingerprint, renderTrustPrompt } from '../src/trust-prompt.js';

describe('formatFingerprint', () => {
  it('groups hex into 4-char chunks', () => {
    expect(formatFingerprint('6041758e653456f9')).toBe('6041 758e 6534 56f9');
  });

  it('passes through an empty string unchanged', () => {
    expect(formatFingerprint('')).toBe('');
  });
});

describe('renderTrustPrompt', () => {
  const publicKeyHex = '6041758e653456f9a1f7d553bb000ebcdd12723c89926d687ca0fb023fe713fa';

  it('shows the confirm-public-key fingerprint', () => {
    const container = document.createElement('div');
    renderTrustPrompt({ container, publicKeyHex, onTrust: vi.fn(), onReject: vi.fn() });

    expect(container.textContent).toContain('New sender');
    expect(container.textContent).toContain('Confirm public key:');
    expect(container.textContent).toContain(formatFingerprint(publicKeyHex));
  });

  it('includes the origin label in the message when provided', () => {
    const container = document.createElement('div');
    renderTrustPrompt({ container, publicKeyHex, originLabel: 'Agent Bot', onTrust: vi.fn(), onReject: vi.fn() });
    expect(container.textContent).toContain('"Agent Bot"');
  });

  it('falls back to a generic message when no origin label is given', () => {
    const container = document.createElement('div');
    renderTrustPrompt({ container, publicKeyHex, onTrust: vi.fn(), onReject: vi.fn() });
    expect(container.textContent).toContain("This artifact is signed with a key");
  });

  it('calls onTrust only after the Trust button is clicked', () => {
    const container = document.createElement('div');
    const onTrust = vi.fn();
    renderTrustPrompt({ container, publicKeyHex, onTrust, onReject: vi.fn() });

    expect(onTrust).not.toHaveBeenCalled();
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Trust this sender')!.click();
    expect(onTrust).toHaveBeenCalledTimes(1);
  });

  it('calls onReject only after the Reject button is clicked, never onTrust', () => {
    const container = document.createElement('div');
    const onTrust = vi.fn();
    const onReject = vi.fn();
    renderTrustPrompt({ container, publicKeyHex, onTrust, onReject });

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Reject')!.click();
    expect(onReject).toHaveBeenCalledTimes(1);
    expect(onTrust).not.toHaveBeenCalled();
  });

  it('replaces any previous content in the container', () => {
    const container = document.createElement('div');
    container.textContent = 'stale content';
    renderTrustPrompt({ container, publicKeyHex, onTrust: vi.fn(), onReject: vi.fn() });
    expect(container.textContent).not.toContain('stale content');
  });
});
