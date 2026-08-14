import type { FormField, FormView, MediaView, TextView, UiActionRequest, UiViewDescriptor } from '@johnhenry/oat-protocol';
import { extractScheme, DEFAULT_URI_SCHEMES } from './sanitizer.js';

export interface RenderContext {
  proposalId: string;
}

export type ActionHandler = (action: UiActionRequest) => void;

/**
 * Renders `TextView`/`FormView`/`MediaView` using plain DOM APIs — never
 * `innerHTML` — so these are safe by construction rather than by
 * sanitization. `SafeHtmlView` goes through `safe-html-renderer.ts` instead,
 * and `SandboxedHtmlView` is out of scope for this build (see README).
 */
export function renderSafeView(
  container: Element,
  view: UiViewDescriptor,
  context: RenderContext,
  onAction: ActionHandler
): void {
  container.replaceChildren();
  switch (view.kind) {
    case 'text':
      renderTextView(container, view);
      return;
    case 'form':
      renderFormView(container, view, context, onAction);
      return;
    case 'media':
      renderMediaView(container, view);
      return;
    case 'safe-html':
      throw new Error('renderSafeView: use renderSafeHtml() from safe-html-renderer.ts for safe-html views');
    case 'sandboxed-html':
      throw new Error('renderSafeView: sandboxed-html rendering is out of scope for this build (M6)');
  }
}

function renderTextView(container: Element, view: TextView): void {
  if (view.title) {
    const heading = document.createElement('h3');
    heading.textContent = view.title;
    container.appendChild(heading);
  }
  const body = document.createElement('p');
  body.textContent = view.body;
  container.appendChild(body);
}

function renderFormView(container: Element, view: FormView, context: RenderContext, onAction: ActionHandler): void {
  if (view.title) {
    const heading = document.createElement('h3');
    heading.textContent = view.title;
    container.appendChild(heading);
  }

  const form = document.createElement('form');
  form.addEventListener('submit', (evt) => evt.preventDefault());

  for (const field of view.fields ?? []) {
    form.appendChild(renderField(field));
  }

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = view.submitLabel ?? 'Continue';
  submit.addEventListener('click', () => {
    const data = Object.fromEntries(new FormData(form).entries());
    onAction({ proposalId: context.proposalId, action: 'submit', capability: view.submitAction, data });
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = view.cancelLabel ?? 'Cancel';
  cancel.addEventListener('click', () => onAction({ proposalId: context.proposalId, action: 'reject' }));

  form.append(submit, cancel);
  container.appendChild(form);
}

function renderField(field: FormField): HTMLElement {
  const wrapper = document.createElement('label');
  if (field.label) wrapper.append(`${field.label} `);

  let control: HTMLElement;
  if (field.type === 'select') {
    const select = document.createElement('select');
    select.name = field.name;
    for (const option of field.options ?? []) {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      select.appendChild(opt);
    }
    control = select;
  } else if (field.type === 'checkbox') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = field.name;
    if (field.defaultValue) input.checked = Boolean(field.defaultValue);
    control = input;
  } else {
    const input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : field.type === 'hidden' ? 'hidden' : 'text';
    input.name = field.name;
    if (field.defaultValue !== undefined) input.value = String(field.defaultValue);
    control = input;
  }

  if (field.required) control.setAttribute('required', '');
  wrapper.appendChild(control);
  return wrapper;
}

function renderMediaView(container: Element, view: MediaView): void {
  if (view.title) {
    const heading = document.createElement('h3');
    heading.textContent = view.title;
    container.appendChild(heading);
  }

  const scheme = extractScheme(view.src);
  if (scheme && !DEFAULT_URI_SCHEMES.has(scheme)) {
    const warning = document.createElement('p');
    warning.textContent = `Blocked media with disallowed URI scheme: ${scheme}`;
    container.appendChild(warning);
    return;
  }

  const tag = view.mediaType.startsWith('video/') ? 'video' : view.mediaType.startsWith('audio/') ? 'audio' : 'img';
  const el = document.createElement(tag) as HTMLImageElement | HTMLVideoElement | HTMLAudioElement;
  el.src = view.src;
  if (tag === 'img' && view.alt) (el as HTMLImageElement).alt = view.alt;
  if (tag !== 'img') (el as HTMLVideoElement | HTMLAudioElement).controls = true;
  container.appendChild(el);
}
