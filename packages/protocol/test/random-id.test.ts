import { afterEach, describe, expect, it } from 'vitest';
import { randomId } from '../src/random-id.js';
import { buildArtifact } from '../src/manifest.js';

/**
 * `crypto.randomUUID` landed in WebKit 15.4 and is secure-context-only, so
 * it is missing on iOS 15.0-15.3 and on any plain-`http:` origin — a LAN
 * address or a custom WebView scheme included. Before `randomId()` existed,
 * `buildArtifact()` called it unconditionally and threw
 * `TypeError: crypto.randomUUID is not a function` on those platforms,
 * taking the whole send path down with it.
 *
 * These tests remove `randomUUID` while leaving `getRandomValues` in place,
 * which is exactly the shape of those environments.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let restore: (() => void) | null = null;

function withoutRandomUUID(): void {
  const descriptor = Object.getOwnPropertyDescriptor(Crypto.prototype, 'randomUUID');
  delete (Crypto.prototype as { randomUUID?: unknown }).randomUUID;
  restore = () => {
    if (descriptor) Object.defineProperty(Crypto.prototype, 'randomUUID', descriptor);
  };
}

afterEach(() => {
  restore?.();
  restore = null;
});

describe('randomId', () => {
  it('returns a v4 UUID when crypto.randomUUID is available', () => {
    expect(randomId()).toMatch(UUID_V4);
  });

  it('returns a v4 UUID when crypto.randomUUID is missing', () => {
    withoutRandomUUID();
    expect(crypto.randomUUID).toBeUndefined();
    expect(randomId()).toMatch(UUID_V4);
  });

  it('does not repeat itself', () => {
    withoutRandomUUID();
    const ids = new Set(Array.from({ length: 500 }, () => randomId()));
    expect(ids.size).toBe(500);
  });

  it('lets buildArtifact mint an id without crypto.randomUUID', async () => {
    withoutRandomUUID();
    const artifact = await buildArtifact({
      mediaType: 'text/plain',
      payload: new TextEncoder().encode('iOS 15.0 says hello')
    });
    expect(artifact.id).toMatch(UUID_V4);
  });

  it('still honours an explicitly supplied id', async () => {
    withoutRandomUUID();
    const artifact = await buildArtifact({
      mediaType: 'text/plain',
      payload: new Uint8Array(0),
      id: 'caller-chosen-id'
    });
    expect(artifact.id).toBe('caller-chosen-id');
  });
});
