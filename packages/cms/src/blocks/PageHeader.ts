import type { Block } from 'payload';

export const PageHeaderBlock: Block = {
  slug: 'pageHeader',
  labels: {
    singular: 'Page Header',
    plural: 'Page Headers',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Eyebrow Text',
      admin: {
        description: 'Small text above the heading (e.g., "Repair Services")',
      },
    },
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'headingAccent',
      type: 'text',
      label: 'Heading Accent',
      admin: {
        description: 'Colored accent word/phrase (e.g., "Properly." in red)',
      },
    },
    {
      name: 'subtitle',
      type: 'textarea',
    },
  ],
};
