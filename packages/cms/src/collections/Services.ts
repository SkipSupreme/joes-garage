import type { CollectionConfig } from 'payload';
import { rebuildFrontend } from '../hooks/rebuildFrontend';

export const Services: CollectionConfig = {
  slug: 'services',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'price', 'estimatedTime'],
  },
  hooks: {
    afterChange: [rebuildFrontend],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'price',
      type: 'number',
      min: 0,
      admin: {
        description: 'Price in CAD',
      },
    },
    {
      name: 'estimatedTime',
      type: 'text',
      admin: {
        description: 'e.g., "30 min", "2-3 days"',
      },
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
    },
  ],
};
