import {
  randomId,
  type CapabilityRequest,
  type SafeHtmlView,
  type SanitizationProfile,
  type TextView,
  type UiProposalEnvelope,
  type UiRequestedProfile
} from '@johnhenry/oat-protocol';

export interface BuildUiProposalOptions {
  /** The `<optical-send>` host element — its light-DOM `<template slot="...">` children are read here. */
  host: Element;
  originId: string;
  originLabel?: string;
  title: string;
  summary?: string;
  requestedProfile?: UiRequestedProfile;
  sanitizationProfile?: SanitizationProfile;
}

function templateFor(host: Element, slotName: string): HTMLTemplateElement | null {
  return host.querySelector(`template[slot="${slotName}"]`);
}

function extractCapabilities(html: string): CapabilityRequest[] {
  // Issue #22: this markup is sender-authored proposal HTML, often built
  // from user-provided data -- parsing it into a live `<div>` (innerHTML on
  // a real, connected-document-capable element) lets inline event handlers
  // (`<img onerror>`) and passive network fetches (`<img src>`, `<iframe>`)
  // fire immediately, before the artifact is even encoded, independent of
  // the receiver's own sanitizer. `DOMParser` documents produced by
  // `parseFromString` are inert: scripts don't execute, and neither do
  // event-handler attributes or resource loads, since the parsed document
  // is never inserted into a live view.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const capabilities = new Map<string, CapabilityRequest>();
  doc.querySelectorAll('[data-optical-capability]').forEach((el) => {
    const capability = el.getAttribute('data-optical-capability');
    if (capability) capabilities.set(capability, { capability });
  });
  return [...capabilities.values()];
}

/**
 * Reads sender-authored `<template slot="proposal">` / `<template slot="fallback">`
 * markup and turns it into a portable, signable `UiProposalEnvelope`. Slots
 * are a **local authoring convenience** — this is the one place their
 * content is resolved; nothing about `<template>`/`<slot>` crosses the wire.
 * Returns `undefined` when the sender declared no proposal (the common case
 * — plain artifact transfer with no UI negotiation).
 */
export function buildUiProposal(options: BuildUiProposalOptions): UiProposalEnvelope | undefined {
  const proposalTemplate = templateFor(options.host, 'proposal');
  if (!proposalTemplate) return undefined;

  const fallbackTemplate = templateFor(options.host, 'fallback');
  const html = proposalTemplate.innerHTML.trim();
  const requestedProfile = options.requestedProfile ?? 'safe-html';
  const sanitizationProfile = options.sanitizationProfile ?? 'forms';

  const preferredView: SafeHtmlView = { kind: 'safe-html', title: options.title, html, sanitizationProfile };
  const fallbackView: TextView = fallbackTemplate
    ? { kind: 'text', body: fallbackTemplate.innerHTML.trim() }
    : { kind: 'text', body: options.summary ?? options.title };

  return {
    type: 'ui.proposal',
    version: 1,
    proposalId: randomId(),
    origin: { id: options.originId, label: options.originLabel },
    title: options.title,
    summary: options.summary,
    preferredView,
    fallbackView,
    requestedCapabilities: extractCapabilities(html),
    requestedProfile
  };
}
