import { describe, expect, it, vi } from 'vitest';
import type { FormView, MediaView, TextView } from '@oat/protocol';
import { renderSafeView } from '../src/safe-view-renderer.js';

describe('renderSafeView', () => {
  it('renders a TextView using textContent, never parsing body as HTML', () => {
    const container = document.createElement('div');
    const view: TextView = { kind: 'text', title: 'Hi', body: '<img src=x onerror=alert(1)>' };
    renderSafeView(container, view, { proposalId: 'p1' }, vi.fn());

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('renders a FormView and dispatches a submit action with field data', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const view: FormView = {
      kind: 'form',
      title: 'Import',
      schema: {},
      fields: [{ name: 'mode', type: 'text', defaultValue: 'preview' }],
      submitAction: 'agent.session.import',
      submitLabel: 'Continue'
    };
    renderSafeView(container, view, { proposalId: 'p2' }, onAction);

    const input = container.querySelector('input[name="mode"]') as HTMLInputElement;
    expect(input.value).toBe('preview');

    const submitBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    submitBtn.click();

    expect(onAction).toHaveBeenCalledWith({
      proposalId: 'p2',
      action: 'submit',
      capability: 'agent.session.import',
      data: { mode: 'preview' }
    });
  });

  it('a FormView cancel button dispatches a reject action', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const view: FormView = { kind: 'form', schema: {}, submitAction: 'x', cancelLabel: 'Nope' };
    renderSafeView(container, view, { proposalId: 'p3' }, onAction);

    const cancelBtn = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Nope')!;
    cancelBtn.click();

    expect(onAction).toHaveBeenCalledWith({ proposalId: 'p3', action: 'reject' });
  });

  it('blocks a MediaView with a disallowed URI scheme', () => {
    const container = document.createElement('div');
    const view: MediaView = { kind: 'media', mediaType: 'image/png', src: 'javascript:alert(1)' };
    renderSafeView(container, view, { proposalId: 'p4' }, vi.fn());

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Blocked media');
  });

  it('renders a MediaView with an allowed https src', () => {
    const container = document.createElement('div');
    const view: MediaView = { kind: 'media', mediaType: 'image/png', src: 'https://example.com/a.png', alt: 'A' };
    renderSafeView(container, view, { proposalId: 'p5' }, vi.fn());

    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/a.png');
    expect(img.alt).toBe('A');
  });

  it('throws for safe-html views (must go through renderSafeHtml)', () => {
    const container = document.createElement('div');
    expect(() =>
      renderSafeView(container, { kind: 'safe-html', html: '<p>x</p>', sanitizationProfile: 'strict' }, { proposalId: 'p6' }, vi.fn())
    ).toThrow();
  });
});
