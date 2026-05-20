import { describe, expect, it } from 'vitest';
import { sanitizeRichTextHtml } from './htmlSanitizer';

describe('sanitizeRichTextHtml', () => {
  it('removes script tags and event handlers', () => {
    const html = '<p onclick="alert(1)">Hello<script>alert(2)</script></p>';

    expect(sanitizeRichTextHtml(html)).toBe('<p>Hello</p>');
  });

  it('removes unsafe javascript urls from links', () => {
    const html = '<a href="javascript:alert(1)">Link</a>';

    expect(sanitizeRichTextHtml(html)).toBe('<a>Link</a>');
  });
});
