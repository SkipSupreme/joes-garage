/**
 * Lightweight HTML sanitizer for server-side use in Astro pages.
 *
 * Strips dangerous tags (script, iframe, object, etc.) and event handler
 * attributes (on*) from HTML strings before rendering via set:html.
 *
 * This is defense-in-depth — our lexicalToHtml() converter already escapes
 * text, but this protects against direct database tampering or future bugs.
 */

const DANGEROUS_ATTR_RE = /\s+on\w+\s*=/gi;
const DANGEROUS_TAGS_RE = /<\/?(?:script|iframe|object|embed|form|input|textarea|button|select|style|link|meta|base|applet|svg|math)\b[^>]*>/gi;

export function sanitizeHtml(html: string): string {
  if (!html) return '';

  // Strip dangerous tags entirely
  let clean = html.replace(DANGEROUS_TAGS_RE, '');

  // Strip event handler attributes (onclick, onload, onerror, etc.)
  clean = clean.replace(DANGEROUS_ATTR_RE, ' ');

  // Strip javascript: and data: URLs from href/src attributes
  clean = clean.replace(/(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript)\s*:/gi, 'href="');

  return clean;
}
