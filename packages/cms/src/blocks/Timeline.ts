import type { Block } from 'payload';

export const TimelineBlock: Block = {
  slug: 'timeline',
  labels: {
    singular: 'Timeline Section',
    plural: 'Timeline Sections',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'milestones',
      type: 'array',
      required: true,
      minRows: 2,
      maxRows: 8,
      fields: [
        {
          name: 'year',
          type: 'text',
          required: true,
          admin: {
            description: 'Year or period (e.g., "2007", "2010s", "Today")',
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        {
          name: 'description',
          type: 'textarea',
          required: true,
        },
        {
          name: 'highlighted',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: 'Highlight this milestone with an accent color',
          },
        },
      ],
    },
  ],
};
