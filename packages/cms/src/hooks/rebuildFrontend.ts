import type { CollectionAfterChangeHook, GlobalAfterChangeHook } from 'payload';

/**
 * Triggers a Cloudflare Pages rebuild when content changes.
 * The deploy hook URL is set via CLOUDFLARE_DEPLOY_HOOK env var.
 * In development, this is a no-op.
 */
export const rebuildFrontend: CollectionAfterChangeHook & GlobalAfterChangeHook = async ({
  doc,
}) => {
  const hookUrl = process.env.CLOUDFLARE_DEPLOY_HOOK;

  if (!hookUrl) {
    return doc;
  }

  try {
    await fetch(hookUrl, { method: 'POST' });
  } catch (error) {
    console.error('Failed to trigger Cloudflare rebuild:', error);
  }

  return doc;
};
