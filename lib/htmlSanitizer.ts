import DOMPurify from 'dompurify';

// Battle-tested sanitization via DOMPurify (replaces the previous hand-rolled
// allowlist walker, which was vulnerable to the mutation-XSS tricks that
// custom sanitizers routinely miss). The export and observable behavior are
// kept identical to before so Journal rendering and tests are unaffected.
//
// Allowed output: a small rich-text subset with plain <a href> links only —
// no scripts, event handlers, styles, iframes, data:/javascript: URLs.

const ALLOWED_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'u',
  'ul',
];

const SANITIZE_CONFIG = {
  ALLOWED_TAGS,
  // Only safe attributes survive; DOMPurify additionally rejects any
  // href whose scheme is not in its URI allowlist (http/https/mailto/tel/
  // relative), which covers javascript:/data: URLs.
  ALLOWED_ATTR: ['href', 'target', 'rel'],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// External links must never hand the current tab to a third party and must
// not be able to reach back through window.opener.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A') return;
  const href = node.getAttribute('href');
  if (!href) return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
});

export const sanitizeRichTextHtml = (html?: string | null): string => {
  if (!html) return '';

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    // Non-DOM environments (SSR/tests): strip ALL markup so no tag, event
    // handler, or javascript: URL can survive. Plain text is returned instead
    // of sanitized HTML — safe by construction.
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]*>/g, '');
  }

  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
};
