import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  toTrustedSrcdoc,
  OAT_SANDBOX_SRCDOC_POLICY_NAME,
  resetTrustedTypesPolicyForTests
} from '../src/trusted-types.js';

afterEach(() => {
  resetTrustedTypesPolicyForTests();
  // @ts-expect-error test-only cleanup of a mocked global
  delete globalThis.trustedTypes;
});

describe('toTrustedSrcdoc', () => {
  it('returns the input unchanged when Trusted Types is not present', () => {
    expect(toTrustedSrcdoc('<p>hi</p>')).toBe('<p>hi</p>');
  });

  it('wraps input through a createPolicy(...).createHTML(...) call when Trusted Types is present', () => {
    const createHTML = vi.fn((input: string) => `TRUSTED:${input}`);
    const createPolicy = vi.fn((name: string, options: { createHTML?: (input: string) => string }) => {
      expect(name).toBe(OAT_SANDBOX_SRCDOC_POLICY_NAME);
      return { createHTML: options.createHTML ?? createHTML };
    });
    // @ts-expect-error test-only global stub
    globalThis.trustedTypes = { createPolicy };

    const result = toTrustedSrcdoc('<p>hi</p>');

    expect(createPolicy).toHaveBeenCalledOnce();
    expect(result).toBe('<p>hi</p>'); // this module's own policy passes content through unchanged
  });

  it('reuses the same policy across multiple calls rather than recreating it', () => {
    const createPolicy = vi.fn((_name: string, options: { createHTML?: (input: string) => string }) => ({
      createHTML: options.createHTML!
    }));
    // @ts-expect-error test-only global stub
    globalThis.trustedTypes = { createPolicy };

    toTrustedSrcdoc('<p>one</p>');
    toTrustedSrcdoc('<p>two</p>');

    expect(createPolicy).toHaveBeenCalledOnce();
  });

  it('falls back to the raw string when policy creation throws', () => {
    // @ts-expect-error test-only global stub
    globalThis.trustedTypes = {
      createPolicy: () => {
        throw new Error('policy name already registered');
      }
    };

    expect(toTrustedSrcdoc('<p>hi</p>')).toBe('<p>hi</p>');
  });
});
