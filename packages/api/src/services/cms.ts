/**
 * Fetch content from the Payload CMS REST API.
 *
 * Used to pull editable content (like the waiver text) from the CMS
 * so shop owners can update it from the admin panel without touching code.
 */

import { lexicalToHtml } from './lexical-html.js';

const CMS_URL = process.env.CMS_URL || 'http://localhost:3003';

/** In-memory cache with TTL to avoid hitting the CMS on every request. */
let cachedWaiverHtml: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch the waiver text from Site Settings and convert Lexical JSON to HTML.
 * Returns null if the field is empty (caller should fall back to default text).
 * Caches the result for 5 minutes.
 */
export async function getWaiverTextFromCMS(): Promise<string | null> {
  const now = Date.now();
  if (cachedWaiverHtml !== null && now < cacheExpiry) {
    return cachedWaiverHtml;
  }

  try {
    const res = await fetch(`${CMS_URL}/api/globals/site-settings?depth=0`);
    if (!res.ok) {
      console.error(`CMS fetch failed: ${res.status} ${res.statusText}`);
      return cachedWaiverHtml; // return stale cache on error
    }

    const settings = await res.json();

    if (settings.waiverText && typeof settings.waiverText === 'object' && settings.waiverText.root) {
      const html = lexicalToHtml(settings.waiverText);
      // Only use CMS text if it has actual content (not just empty paragraphs)
      if (html.replace(/<[^>]*>/g, '').trim().length > 0) {
        cachedWaiverHtml = html;
        cacheExpiry = now + CACHE_TTL_MS;
        return cachedWaiverHtml;
      }
    }

    // Field is empty — cache the null result too so we don't keep fetching
    cachedWaiverHtml = null;
    cacheExpiry = now + CACHE_TTL_MS;
    return null;
  } catch (err) {
    console.error('Failed to fetch waiver text from CMS:', err);
    return cachedWaiverHtml; // return stale cache on network error
  }
}
