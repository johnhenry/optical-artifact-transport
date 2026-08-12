/**
 * Well-known capability identifiers. Applications may register additional
 * `local.*` capabilities; everything under `ui.*` and `html.*` is reserved
 * by this protocol.
 */
export const WELL_KNOWN_CAPABILITIES = [
  'ui.render.text',
  'ui.render.form.basic',
  'ui.render.media.safe',
  'ui.action.submit',
  'ui.open.external',
  'ui.embed.iframe',
  'ui.render.html.unsafe',

  'html.script',
  'html.network',
  'html.storage',
  'html.popup',
  'html.download',
  'html.fullscreen'
] as const;

export type WellKnownCapability = (typeof WELL_KNOWN_CAPABILITIES)[number];

export type ConsentLevel = 'auto' | 'prompt' | 'administrator-only' | 'denied';

export interface CapabilityGrant {
  capability: string;
  /** 'session' grants last for the lifetime of the receiver session. */
  lifetime: 'one-shot' | 'session' | 'expiry-bound' | 'persisted';
  expiresAt?: string;
  /** The sender identity (origin.id) this grant is scoped to, or '*' for any. */
  audience: string;
  consent: ConsentLevel;
}

export interface CapabilityPolicy {
  /** Capabilities the receiver is willing to grant at all, regardless of request. */
  allowed: Set<string>;
  /** Capabilities the receiver will never grant, even if requested and user-approved. */
  denied: Set<string>;
}

/**
 * Computes `effective capabilities = requested ∩ policy.allowed ∩ approved`,
 * with `policy.denied` always taking precedence.
 */
export function intersectCapabilities(
  requested: readonly string[],
  policy: CapabilityPolicy,
  userApproved: readonly string[]
): string[] {
  const approved = new Set(userApproved);
  return requested.filter(
    (cap) => policy.allowed.has(cap) && !policy.denied.has(cap) && approved.has(cap)
  );
}

export function createCapabilityPolicy(
  allowed: readonly string[],
  denied: readonly string[] = []
): CapabilityPolicy {
  return { allowed: new Set(allowed), denied: new Set(denied) };
}
