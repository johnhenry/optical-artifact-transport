/**
 * Minimal ambient shape for the Trusted Types API — not yet part of
 * TypeScript's default DOM lib. Only the pieces this module actually uses.
 */
interface TrustedTypesPolicyOptions {
  createHTML?: (input: string) => string;
}
interface TrustedTypesPolicy {
  createHTML(input: string): unknown; // returns a platform TrustedHTML object
}
interface TrustedTypesGlobal {
  createPolicy(name: string, options: TrustedTypesPolicyOptions): TrustedTypesPolicy;
}

export const OAT_SANDBOX_SRCDOC_POLICY_NAME = 'oat-sandbox-srcdoc';

let policy: TrustedTypesPolicy | null | undefined; // undefined = not yet attempted

function getPolicy(): TrustedTypesPolicy | null {
  if (policy !== undefined) return policy;

  const trustedTypes = (globalThis as unknown as { trustedTypes?: TrustedTypesGlobal }).trustedTypes;
  if (!trustedTypes) {
    policy = null;
    return policy;
  }

  try {
    policy = trustedTypes.createPolicy(OAT_SANDBOX_SRCDOC_POLICY_NAME, {
      // This policy exists purely for compatibility with a host CSP that
      // sets `require-trusted-types-for 'script'` — it does not itself
      // sanitize anything. The actual safety guarantee for M6 content comes
      // from the iframe's `sandbox="allow-scripts"` attribute (no
      // `allow-same-origin`) in `sandbox-host.ts`, which this policy is
      // only ever used alongside — never for an arbitrary caller-supplied
      // string.
      createHTML: (input: string) => input
    });
  } catch {
    // A policy with this name may already exist (e.g. HMR in dev), or the
    // host's `trusted-types` CSP directive may not list this policy name.
    policy = null;
  }
  return policy;
}

/**
 * Wraps `html` as a `TrustedHTML` via a dedicated policy when the Trusted
 * Types API is present, so assigning to `iframe.srcdoc` keeps working under
 * a host CSP with `require-trusted-types-for 'script'` (srcdoc is a
 * Trusted-Types-guarded sink; a raw string assignment throws under that
 * directive). Falls back to returning `html` unchanged when Trusted Types
 * isn't present or policy creation fails — the overwhelmingly common case,
 * since Trusted Types enforcement is opt-in.
 *
 * Host apps that do enable Trusted Types must list `'oat-sandbox-srcdoc'`
 * in their `Content-Security-Policy: trusted-types` directive for this to
 * take effect; see README.md's security model section.
 */
export function toTrustedSrcdoc(html: string): string {
  const p = getPolicy();
  return (p ? p.createHTML(html) : html) as string;
}

/** Test-only: forces the next `toTrustedSrcdoc` call to re-attempt policy creation. */
export function resetTrustedTypesPolicyForTests(): void {
  policy = undefined;
}
