import type { CollectionConfig } from 'payload';

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
  },
  upload: {
    mimeTypes: ['image/*'],

    // Auto-generate optimized sizes on upload
    imageSizes: [
      {
        name: 'thumbnail',
        width: 200,
        height: undefined,
        position: 'centre',
      },
      {
        name: 'medium',
        width: 400,
        height: undefined,
        position: 'centre',
      },
      {
        name: 'large',
        width: 1280,
        height: undefined,
        position: 'centre',
      },
    ],
    adminThumbnail: 'thumbnail',

    // Convert all uploads to WebP
    formatOptions: {
      format: 'webp',
      options: { quality: 80 },
    },

    // Cap original at 2000px to avoid storing huge files
    resizeOptions: {
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    },
  },
  admin: {
    useAsTitle: 'alt',
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
  ],
};
