const allowedTags = new Set([
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
]);

const dropTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'meta', 'link']);

const isSafeHref = (href: string) => {
  const normalized = href.trim().toLowerCase();
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('#') ||
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:')
  );
};

const sanitizeNode = (node: Element): void => {
  const children = Array.from(node.children);

  for (const child of children) {
    if (!allowedTags.has(child.tagName.toLowerCase())) {
      if (dropTags.has(child.tagName.toLowerCase())) {
        child.remove();
      } else {
        child.replaceWith(...Array.from(child.childNodes));
      }
      continue;
    }

    Array.from(child.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        child.removeAttribute(attribute.name);
        return;
      }

      if (child.tagName.toLowerCase() === 'a' && name === 'href' && !isSafeHref(attribute.value)) {
        child.removeAttribute(attribute.name);
      }
    });

    sanitizeNode(child);
  }
};

export const sanitizeRichTextHtml = (html?: string | null) => {
  if (!html) return '';

  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, '');
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(html, 'text/html');

  Array.from(document.body.children).forEach((child) => {
    if (!allowedTags.has(child.tagName.toLowerCase())) {
      if (dropTags.has(child.tagName.toLowerCase())) {
        child.remove();
      } else {
        child.replaceWith(...Array.from(child.childNodes));
      }
      return;
    }

    Array.from(child.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        child.removeAttribute(attribute.name);
        return;
      }

      if (child.tagName.toLowerCase() === 'a' && name === 'href' && !isSafeHref(attribute.value)) {
        child.removeAttribute(attribute.name);
      }
    });

    sanitizeNode(child);
  });

  return document.body.innerHTML;
};
