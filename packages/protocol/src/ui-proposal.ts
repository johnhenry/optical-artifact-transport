export type SanitizationProfile =
  | 'text-only'
  | 'strict'
  | 'rich-text'
  | 'forms'
  | 'media'
  | 'custom';

export type UiRequestedProfile = 'safe-view' | 'safe-html' | 'sandboxed-html' | 'trusted-html';

export interface TextView {
  kind: 'text';
  title?: string;
  body: string;
}

export interface FormField {
  name: string;
  label?: string;
  type: 'text' | 'select' | 'checkbox' | 'number' | 'hidden';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  defaultValue?: string | number | boolean;
}

export interface FormView {
  kind: 'form';
  title?: string;
  schema: Record<string, unknown>;
  fields?: FormField[];
  submitAction: string;
  submitLabel?: string;
  cancelLabel?: string;
}

export interface MediaView {
  kind: 'media';
  title?: string;
  mediaType: string;
  src: string;
  alt?: string;
}

export interface SafeHtmlView {
  kind: 'safe-html';
  title?: string;
  html: string;
  sanitizationProfile: SanitizationProfile;
}

export interface SandboxedHtmlView {
  kind: 'sandboxed-html';
  title?: string;
  html: string;
}

export type UiViewDescriptor = TextView | FormView | MediaView | SafeHtmlView | SandboxedHtmlView;

export interface CapabilityRequest {
  capability: string;
  reason?: string;
}

export interface UiProposalOrigin {
  id: string;
  label?: string;
  publicKey?: Uint8Array;
  signature?: Uint8Array;
}

export interface UiProposalEnvelope {
  type: 'ui.proposal';
  version: 1;
  proposalId: string;

  origin: UiProposalOrigin;

  title: string;
  summary?: string;

  preferredView: UiViewDescriptor;
  fallbackView: UiViewDescriptor;

  requestedCapabilities: CapabilityRequest[];
  requestedProfile: UiRequestedProfile;

  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UiActionRequest {
  proposalId: string;
  action: 'approve' | 'reject' | 'submit' | 'open-external';
  capability?: string;
  data?: Record<string, unknown>;
}
