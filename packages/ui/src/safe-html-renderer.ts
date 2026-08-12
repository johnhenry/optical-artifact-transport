import type { SafeHtmlView, UiActionRequest } from '@oat/protocol';
import { sanitizeHtml, type SanitizerRules } from './sanitizer.js';
import type { RenderContext, ActionHandler } from './safe-view-renderer.js';

const KNOWN_ACTIONS = new Set<UiActionRequest['action']>(['approve', 'reject', 'submit', 'open-external']);

/**
 * Sanitizes `view.html` per its declared profile and wires up declarative
 * actions (`data-optical-action`/`data-optical-capability`, per the design
 * doc's "Declarative actions" section). No sender script ever runs — clicks
 * on tagged elements are translated into a typed `UiActionRequest` the host
 * app decides how to handle; nothing about the DOM or a callback crosses
 * back to the sender.
 */
export function renderSafeHtml(
  container: Element,
  view: SafeHtmlView,
  context: RenderContext,
  onAction: ActionHandler,
  customRules?: SanitizerRules
): void {
  container.replaceChildren();

  if (view.title) {
    const heading = document.createElement('h3');
    heading.textContent = view.title;
    container.appendChild(heading);
  }

  const fragment = sanitizeHtml(view.html, view.sanitizationProfile, customRules);
  container.appendChild(fragment);

  container.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', (evt) => evt.preventDefault());
  });

  container.querySelectorAll<HTMLElement>('[data-optical-action]').forEach((el) => {
    el.addEventListener('click', (evt) => {
      const rawAction = el.getAttribute('data-optical-action');
      if (!rawAction || !KNOWN_ACTIONS.has(rawAction as UiActionRequest['action'])) return;
      const action = rawAction as UiActionRequest['action'];
      const capability = el.getAttribute('data-optical-capability') ?? undefined;

      let data: Record<string, unknown> | undefined;
      const form = el.closest('form');
      if (form) {
        evt.preventDefault();
        data = Object.fromEntries(new FormData(form).entries());
      }

      onAction({ proposalId: context.proposalId, action, capability, data });
    });
  });
}
