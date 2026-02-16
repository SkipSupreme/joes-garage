/**
 * Lightweight Lexical editor state → HTML converter.
 *
 * Payload CMS 3.x stores rich text as Lexical JSON. This converts the
 * common node types to HTML for use in waiver PDF generation.
 *
 * Mirrors packages/frontend/src/lib/lexical-html.ts
 */

interface LexicalNode {
  type: string;
  children?: LexicalNode[];
  text?: string;
  format?: number | string;
  tag?: string;
  url?: string;
  newTab?: boolean;
  listType?: string;
  value?: number;
  direction?: string;
  indent?: number;
  [key: string]: unknown;
}

interface LexicalRoot {
  root: LexicalNode;
}

// Lexical text format bitmask
const IS_BOLD = 1;
const IS_ITALIC = 2;
const IS_STRIKETHROUGH = 4;
const IS_UNDERLINE = 8;
const IS_CODE = 16;
const IS_SUBSCRIPT = 32;
const IS_SUPERSCRIPT = 64;

function formatText(text: string, format: number): string {
  let result = text;
  if (format & IS_CODE) result = `<code>${result}</code>`;
  if (format & IS_BOLD) result = `<strong>${result}</strong>`;
  if (format & IS_ITALIC) result = `<em>${result}</em>`;
  if (format & IS_UNDERLINE) result = `<u>${result}</u>`;
  if (format & IS_STRIKETHROUGH) result = `<s>${result}</s>`;
  if (format & IS_SUBSCRIPT) result = `<sub>${result}</sub>`;
  if (format & IS_SUPERSCRIPT) result = `<sup>${result}</sup>`;
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNode(node: LexicalNode): string {
  if (node.type === 'text') {
    const text = escapeHtml(node.text || '');
    return typeof node.format === 'number' ? formatText(text, node.format) : text;
  }

  if (node.type === 'linebreak') {
    return '<br/>';
  }

  const children = (node.children || []).map(renderNode).join('');

  switch (node.type) {
    case 'root':
      return children;

    case 'paragraph':
      return `<p>${children}</p>`;

    case 'heading': {
      const tag = node.tag || 'h2';
      return `<${tag}>${children}</${tag}>`;
    }

    case 'quote':
      return `<blockquote>${children}</blockquote>`;

    case 'list': {
      const tag = node.listType === 'number' ? 'ol' : 'ul';
      return `<${tag}>${children}</${tag}>`;
    }

    case 'listitem':
      return `<li>${children}</li>`;

    case 'link':
    case 'autolink': {
      const url = (node.fields as any)?.url || node.url || '#';
      const target = (node.fields as any)?.newTab || node.newTab ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${escapeHtml(url)}"${target}>${children}</a>`;
    }

    case 'horizontalrule':
      return '<hr/>';

    default:
      return children;
  }
}

/**
 * Convert Payload's Lexical rich text JSON to HTML.
 * Returns empty string for null/undefined/non-object input.
 */
export function lexicalToHtml(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  if (typeof data === 'string') return data;

  const lexical = data as LexicalRoot;
  if (!lexical.root) return '';

  return renderNode(lexical.root);
}
