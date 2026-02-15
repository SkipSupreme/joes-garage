import type { Block } from 'payload';

export const StatsBlock: Block = {
  slug: 'stats',
  labels: {
    singular: 'Stats Section',
    plural: 'Stats Sections',
  },
  fields: [
    {
      name: 'stats',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 6,
      fields: [
        {
          name: 'value',
          type: 'text',
          required: true,
          admin: {
            description: 'The number or value (e.g., "2007", "30")',
          },
        },
        {
          name: 'suffix',
          type: 'text',
          admin: {
            description: 'Accent suffix (e.g., "+", "★")',
          },
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          admin: {
            description: 'Description below the number (e.g., "Years wrenching")',
          },
        },
      ],
    },
  ],
};
