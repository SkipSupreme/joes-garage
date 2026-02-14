import type { Block } from 'payload';

export const HeroBlock: Block = {
  slug: 'hero',
  labels: {
    singular: 'Hero Section',
    plural: 'Hero Sections',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'subheading',
      type: 'text',
    },
    {
      name: 'backgroundImage',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'ctaText',
      type: 'text',
      label: 'Button Text',
    },
    {
      name: 'ctaLink',
      type: 'text',
      label: 'Button Link',
    },
  ],
};
