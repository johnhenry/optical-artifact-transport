import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../src/sanitizer.js';

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
