import { describe, expect, it, vi } from 'vitest';
import type { SafeHtmlView } from '@johnhenry/oat-protocol';
import { renderSafeHtml } from '../src/safe-html-renderer.js';

describe('renderSafeHtml', () => {
  it('sanitizes the html per its declared profile before rendering', () => {
    const container = document.createElement('div');
    const view: SafeHtmlView = {
      kind: 'safe-html',
      html: '<p>hi</p><script>alert(1)</script>',
      sanitizationProfile: 'strict'
    };
    renderSafeHtml(container, view, { proposalId: 'p1' }, vi.fn());

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('hi');
  });

  it('wires data-optical-action clicks to a typed UiActionRequest', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const view: SafeHtmlView = {
      kind: 'safe-html',
      html: '<button data-optical-action="approve" data-optical-capability="agent.session.import">Go</button>',
      sanitizationProfile: 'forms'
    };
    renderSafeHtml(container, view, { proposalId: 'p2' }, onAction);

    container.querySelector('button')!.click();

    expect(onAction).toHaveBeenCalledWith({
      proposalId: 'p2',
      action: 'approve',
      capability: 'agent.session.import',
      data: undefined
    });
  });

  it('ignores unrecognized data-optical-action values', () => {
    const container = document.createElement('div');
    const onAction = vi.fn();
    const view: SafeHtmlView = {
      kind: 'safe-html',
      html: '<button data-optical-action="nuke-everything">Go</button>',
      sanitizationProfile: 'forms'
    };
    renderSafeHtml(container, view, { proposalId: 'p3' }, onAction);
    container.querySelector('button')!.click();

    expect(onAction).not.toHaveBeenCalled();
  });

  it('collects form data and prevents native submission for a submit-style action button', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onAction = vi.fn();
    const view: SafeHtmlView = {
      kind: 'safe-html',
      html: `
        <form>
          <input name="mode" type="text" value="resume">
          <button type="submit" data-optical-action="submit" data-optical-capability="agent.session.import">Continue</button>
        </form>
      `,
      sanitizationProfile: 'forms'
    };
    renderSafeHtml(container, view, { proposalId: 'p4' }, onAction);

    container.querySelector('button')!.click();

    expect(onAction).toHaveBeenCalledWith({
      proposalId: 'p4',
      action: 'submit',
      capability: 'agent.session.import',
      data: { mode: 'resume' }
    });
    container.remove();
  });

  it('never allows native form navigation regardless of declarative actions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const view: SafeHtmlView = {
      kind: 'safe-html',
      html: '<form><button type="submit">Go</button></form>',
      sanitizationProfile: 'forms'
    };
    renderSafeHtml(container, view, { proposalId: 'p5' }, vi.fn());

    const submitEvent = new Event('submit', { cancelable: true });
    container.querySelector('form')!.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
    container.remove();
  });
});
