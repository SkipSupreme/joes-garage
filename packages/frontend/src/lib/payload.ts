/**
 * Build-time helpers for fetching content from Payload CMS REST API.
 * Used in Astro page frontmatter during static site generation.
 *
 * depth=2 ensures media inside blocks are fully populated with URLs.
 * Rich text (Lexical JSON) is converted to HTML before returning.
 */

import { lexicalToHtml } from './lexical-html';

const PAYLOAD_URL = import.meta.env.PAYLOAD_URL || 'http://localhost:3000';

async function payloadFetch<T>(endpoint: string): Promise<T> {
  const url = `${PAYLOAD_URL}/api${endpoint}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Payload API error: ${res.status} ${res.statusText} for ${endpoint}`);
  }
  return res.json();
}

/**
 * Walk page blocks and convert all rich text Lexical JSON to HTML strings.
 * Also normalizes media URLs to be absolute (prepend CMS URL if relative).
 */
function processBlocks(blocks: any[]): any[] {
  if (!Array.isArray(blocks)) return [];

  return blocks.map((block) => {
    const processed = { ...block };

    // Convert richText fields (content, description, etc.)
    for (const key of ['content', 'description', 'waiverText']) {
      if (processed[key] && typeof processed[key] === 'object' && processed[key].root) {
        processed[key] = lexicalToHtml(processed[key]);
      }
    }

    // Normalize media URLs
    if (processed.backgroundImage?.url && processed.backgroundImage.url.startsWith('/')) {
      processed.backgroundImage = {
        ...processed.backgroundImage,
        url: `${PAYLOAD_URL}${processed.backgroundImage.url}`,
      };
    }
    if (processed.image?.url && processed.image.url.startsWith('/')) {
      processed.image = {
        ...processed.image,
        url: `${PAYLOAD_URL}${processed.image.url}`,
      };
    }

    // Gallery images array
    if (Array.isArray(processed.images)) {
      processed.images = processed.images.map((img: any) => ({
        ...img,
        image: img.image?.url?.startsWith('/')
          ? { ...img.image, url: `${PAYLOAD_URL}${img.image.url}` }
          : img.image,
      }));
    }

    // Testimonials relationship — already populated at depth=2
    if (Array.isArray(processed.testimonials)) {
      processed.testimonials = processed.testimonials.map((t: any) => ({
        ...t,
        photo: t.photo?.url?.startsWith('/')
          ? { ...t.photo, url: `${PAYLOAD_URL}${t.photo.url}` }
          : t.photo,
      }));
    }

    return processed;
  });
}

/** Prepend CMS URL to relative media paths. */
function normalizeMediaUrl(doc: any): any {
  if (!doc) return doc;
  if (doc.photo?.url?.startsWith('/')) {
    doc.photo = { ...doc.photo, url: `${PAYLOAD_URL}${doc.photo.url}` };
  }
  if (doc.url?.startsWith('/')) {
    doc.url = `${PAYLOAD_URL}${doc.url}`;
  }
  return doc;
}

// --- Pages ---

export async function getPages() {
  const data = await payloadFetch<{ docs: any[] }>('/pages?limit=100&depth=2');
  return data.docs.map((page) => ({
    ...page,
    layout: processBlocks(page.layout),
    meta: page.meta
      ? {
          ...page.meta,
          ogImage: page.meta.ogImage?.url?.startsWith('/')
            ? { ...page.meta.ogImage, url: `${PAYLOAD_URL}${page.meta.ogImage.url}` }
            : page.meta.ogImage,
        }
      : page.meta,
  }));
}

export async function getPage(slug: string) {
  const data = await payloadFetch<{ docs: any[] }>(
    `/pages?where[slug][equals]=${encodeURIComponent(slug)}&limit=1&depth=2`,
  );
  const page = data.docs[0];
  if (!page) return null;
  return {
    ...page,
    layout: processBlocks(page.layout),
    meta: page.meta
      ? {
          ...page.meta,
          ogImage: page.meta.ogImage?.url?.startsWith('/')
            ? { ...page.meta.ogImage, url: `${PAYLOAD_URL}${page.meta.ogImage.url}` }
            : page.meta.ogImage,
        }
      : page.meta,
  };
}

// --- Collections ---

export async function getBikes() {
  const data = await payloadFetch<{ docs: any[] }>(
    '/bikes?where[status][equals]=available&limit=100&depth=1',
  );
  return data.docs.map((bike) => {
    const b = normalizeMediaUrl(bike);
    // Convert richText description
    if (b.description && typeof b.description === 'object' && b.description.root) {
      b.description = lexicalToHtml(b.description);
    }
    return b;
  });
}

export async function getServices() {
  const data = await payloadFetch<{ docs: any[] }>('/services?limit=100&depth=1');
  return data.docs.map((service) => {
    const s = normalizeMediaUrl(service);
    if (s.description && typeof s.description === 'object' && s.description.root) {
      s.description = lexicalToHtml(s.description);
    }
    return s;
  });
}

export async function getTestimonials() {
  const data = await payloadFetch<{ docs: any[] }>('/testimonials?limit=100&depth=1');
  return data.docs.map(normalizeMediaUrl);
}

// --- Globals ---

export async function getSiteSettings() {
  const settings = await payloadFetch<any>('/globals/site-settings?depth=1');
  // Convert waiver rich text
  if (settings.waiverText && typeof settings.waiverText === 'object' && settings.waiverText.root) {
    settings.waiverText = lexicalToHtml(settings.waiverText);
  }
  // Normalize logo
  if (settings.logo?.url?.startsWith('/')) {
    settings.logo = { ...settings.logo, url: `${PAYLOAD_URL}${settings.logo.url}` };
  }
  return settings;
}
