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
  const container = document.createElement('div');
  container.innerHTML = html;
  const capabilities = new Map<string, CapabilityRequest>();
  container.querySelectorAll('[data-optical-capability]').forEach((el) => {
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
