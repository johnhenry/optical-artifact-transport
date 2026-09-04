/**
 * A UUIDv4 string, from `crypto.randomUUID()` where it exists and from
 * `crypto.getRandomValues()` where it does not.
 *
 * `crypto.randomUUID` is newer and narrower than it looks: it landed in
 * WebKit 15.4, so it is absent on iOS 15.0-15.3, and it is a
 * secure-context-only API, so it is absent on any plain-`http:` origin —
 * including the LAN addresses and custom WebView schemes this library is
 * most often used from. `crypto.getRandomValues` has neither restriction
 * and is the same CSPRNG, so the fallback is not weaker; it just has to
 * set the version and variant bits itself.
 *
 * Every id in this codebase is a correlation handle, not a secret, but
 * they are still generated from the CSPRNG rather than `Math.random()` so
 * that no caller has to reason about which of the two they got.
 */
export function randomId(): string {
  const webcrypto = globalThis.crypto as Crypto | undefined;

  if (typeof webcrypto?.randomUUID === 'function') return webcrypto.randomUUID();

  if (typeof webcrypto?.getRandomValues !== 'function') {
    throw new Error(
      'randomId() requires a Web Crypto implementation: neither crypto.randomUUID nor crypto.getRandomValues is available'
    );
  }

  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 4122 variant

  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
