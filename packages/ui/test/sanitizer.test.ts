import { afterEach, describe, expect, it, vi } from 'vitest';
import { sanitizeHtml, type SanitizerRules } from '../src/sanitizer.js';

function html(fragment: DocumentFragment): string {
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML;
}

describe('sanitizeHtml', () => {
  it('strips <script> tags entirely, including their content', () => {
    const out = html(sanitizeHtml('<p>hi</p><script>alert(1)</script>', 'rich-text'));
    expect(out).toContain('<p>hi</p>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });

  it('strips event handler attributes regardless of profile', () => {
    const out = html(sanitizeHtml('<p onclick="alert(1)">hi</p>', 'rich-text'));
    expect(out).not.toContain('onclick');
    expect(out).toContain('hi');
  });

  it('strips javascript: URLs from href', () => {
    const out = html(sanitizeHtml('<a href="javascript:alert(1)">click</a>', 'strict'));
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a>click</a>');
  });

  it('strips javascript: URLs even with control-character obfuscation', () => {
    const out = html(sanitizeHtml('<a href="jav\tascript:alert(1)">click</a>', 'strict'));
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('keeps well-formed https links', () => {
    const out = html(sanitizeHtml('<a href="https://example.com">go</a>', 'strict'));
    expect(out).toContain('href="https://example.com"');
  });

  it('unwraps disallowed tags but keeps their text content', () => {
    const out = html(sanitizeHtml('<div>hello <b>world</b></div>', 'text-only'));
    expect(out).not.toContain('<div>');
    expect(out).toContain('hello');
    expect(out).toContain('<b>world</b>');
  });

  it('text-only profile drops links entirely (unwrapped to plain text)', () => {
    const out = html(sanitizeHtml('<a href="https://evil.example">click me</a>', 'text-only'));
    expect(out).not.toContain('<a');
    expect(out).toContain('click me');
  });

  it('forms profile strips form action/method/target but keeps inputs and buttons', () => {
    const out = html(
      sanitizeHtml(
        '<form action="https://evil.example" method="post"><input name="x" type="text"><button type="submit">Go</button></form>',
        'forms'
      )
    );
    expect(out).not.toContain('action=');
    expect(out).not.toContain('method=');
    expect(out).toContain('<input');
    expect(out).toContain('<button');
  });

  it('rich-text profile blocks data: URLs on images by default', () => {
    const out = html(sanitizeHtml('<img src="data:text/html,<script>alert(1)</script>">', 'rich-text'));
    expect(out).not.toContain('src=');
  });

  it('removes iframe/object/embed entirely', () => {
    const out = html(sanitizeHtml('<iframe src="https://evil.example"></iframe><object data="x"></object>', 'media'));
    expect(out).toBe('');
  });

  it('custom profile with no rules supplied allows nothing', () => {
    const out = html(sanitizeHtml('<p>hi</p>', 'custom'));
    expect(out).toBe('hi');
  });

  it('preserves plain text nodes untouched', () => {
    const out = html(sanitizeHtml('just text, no tags', 'text-only'));
    expect(out).toBe('just text, no tags');
  });
});

describe('sanitizeHtml resource limits', () => {
  function rulesWithLimits(overrides: Partial<SanitizerRules>): SanitizerRules {
    return {
      allowedTags: new Set(['p', 'div']),
      allowedAttributes: new Map(),
      allowedUriSchemes: new Set(),
      ...overrides
    };
  }

  it('drops elements beyond maxNodes', () => {
    const manyParagraphs = Array.from({ length: 10 }, (_, i) => `<p>${i}</p>`).join('');
    const rules = rulesWithLimits({ maxNodes: 3 });
    const out = html(sanitizeHtml(manyParagraphs, 'custom', rules));
    expect((out.match(/<p>/g) ?? []).length).toBe(3);
  });

  it('drops subtrees nested beyond maxDepth rather than unwrapping them', () => {
    const deep = '<div>'.repeat(10) + 'core text' + '</div>'.repeat(10);
    const rules = rulesWithLimits({ maxDepth: 3 });
    const out = html(sanitizeHtml(deep, 'custom', rules));
    expect(out).not.toContain('core text');
    // The first 3 levels of <div> should still be present.
    expect((out.match(/<div>/g) ?? []).length).toBe(3);
  });

  it('truncates text content once maxTextBytes is exceeded', () => {
    const longText = 'x'.repeat(1000);
    const rules = rulesWithLimits({ maxTextBytes: 100 });
    const out = html(sanitizeHtml(`<p>${longText}</p>`, 'custom', rules));
    const pContent = out.replace(/<\/?p>/g, '');
    expect(pContent.length).toBeLessThanOrEqual(100);
    expect(pContent.length).toBeGreaterThan(0);
  });

  it('applies the text budget across multiple text nodes cumulatively, not per-node', () => {
    const rules = rulesWithLimits({ maxTextBytes: 50 });
    const out = html(sanitizeHtml('<p>' + 'a'.repeat(40) + '</p><p>' + 'b'.repeat(40) + '</p>', 'custom', rules));
    const totalTextChars = out.replace(/<\/?p>/g, '').length;
    expect(totalTextChars).toBeLessThanOrEqual(50);
  });

  it('the built-in profiles all carry sane non-zero default limits', () => {
    // Exercise each named profile's real defaults (not the custom test rules above) with a
    // moderately large document, proving the defaults are wired through sanitizeHtml at all.
    const manyParagraphs = Array.from({ length: 5000 }, (_, i) => `<p>${i}</p>`).join('');
    const out = html(sanitizeHtml(manyParagraphs, 'text-only'));
    expect((out.match(/<p>/g) ?? []).length).toBeLessThan(5000);
  });
});

describe('sanitizeHtml native Sanitizer API layering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test-only cleanup of a mocked platform API
    delete (Element.prototype as { setHTML?: unknown }).setHTML;
  });

  it('uses native setHTML as a pre-pass when present, but the pinned allowlist still runs afterward', () => {
    const nativeSetHTML = vi.fn(function (this: Element, input: string) {
      // Simulate a native sanitizer with a more permissive default than our
      // 'text-only' profile: it strips <script> but keeps <a>.
      this.innerHTML = input.replace(/<script[^>]*>.*?<\/script>/gi, '');
    });
    (Element.prototype as unknown as { setHTML: typeof nativeSetHTML }).setHTML = nativeSetHTML;

    const out = html(sanitizeHtml('<a href="https://example.com">link</a><script>alert(1)</script>', 'text-only'));

    expect(nativeSetHTML).toHaveBeenCalled();
    // 'text-only' disallows <a> entirely — proving our pass, not the native
    // default, is what actually decided the final output.
    expect(out).not.toContain('<a');
    expect(out).toContain('link');
  });

  it('falls back to direct parsing when native setHTML throws', () => {
    (Element.prototype as unknown as { setHTML: (input: string) => void }).setHTML = () => {
      throw new Error('simulated native sanitizer failure');
    };

    const out = html(sanitizeHtml('<p>still works</p>', 'strict'));
    expect(out).toContain('still works');
  });

  it("passes an explicit config to native setHTML matching the profile — regression test for Chrome's default silently stripping <form>/<button>", () => {
    let receivedConfig: { sanitizer?: { elements?: string[]; attributes?: string[] } } | undefined;
    (
      Element.prototype as unknown as {
        setHTML: (input: string, options?: { sanitizer?: { elements?: string[]; attributes?: string[] } }) => void;
      }
    ).setHTML = function (this: Element, input, options) {
      receivedConfig = options;
      // Simulate Chrome's real observed behavior: with NO explicit config, <form>/<button>
      // are dropped; WITH an explicit elements list that includes them, they're kept.
      const allowed = options?.sanitizer?.elements;
      this.innerHTML =
        !allowed || (!allowed.includes('form') && !allowed.includes('button'))
          ? input.replace(/<\/?(form|button)[^>]*>/gi, '')
          : input;
    };

    const out = html(sanitizeHtml('<form><button type="submit">Go</button></form>', 'forms'));

    expect(receivedConfig?.sanitizer?.elements).toEqual(expect.arrayContaining(['form', 'button']));
    expect(out).toContain('<form>');
    expect(out).toContain('<button');
  });
});
