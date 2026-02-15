import type { Block } from 'payload';

export const MapEmbedBlock: Block = {
  slug: 'mapEmbed',
  labels: {
    singular: 'Map Embed',
    plural: 'Map Embeds',
  },
  fields: [
    {
      name: 'embedUrl',
      type: 'text',
      required: true,
      label: 'Google Maps Embed URL',
      admin: {
        description: 'The full iframe src URL from Google Maps',
      },
    },
    {
      name: 'address',
      type: 'text',
      label: 'Address Text',
      admin: {
        description: 'Accessible label for the map (e.g., "335 8 St SW, Calgary, AB")',
      },
    },
    {
      name: 'height',
      type: 'number',
      defaultValue: 450,
      admin: {
        description: 'Map height in pixels',
      },
    },
  ],
};
