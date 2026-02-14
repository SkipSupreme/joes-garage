import type { Block } from 'payload';

export const CTABlock: Block = {
  slug: 'cta',
  labels: {
    singular: 'Call to Action',
    plural: 'Call to Action Sections',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'content',
      type: 'richText',
    },
    {
      name: 'buttonText',
      type: 'text',
      required: true,
    },
    {
      name: 'buttonLink',
      type: 'text',
      required: true,
    },
  ],
};
