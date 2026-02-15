import type { Block } from 'payload';

export const ValuesGridBlock: Block = {
  slug: 'valuesGrid',
  labels: {
    singular: 'Values Grid',
    plural: 'Values Grid Sections',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      required: true,
    },
    {
      name: 'values',
      type: 'array',
      required: true,
      minRows: 1,
      maxRows: 6,
      fields: [
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
          name: 'icon',
          type: 'select',
          defaultValue: 'shield',
          options: [
            { label: 'Shield / Honesty', value: 'shield' },
            { label: 'Star / Quality', value: 'star' },
            { label: 'People / Community', value: 'people' },
            { label: 'Heart', value: 'heart' },
            { label: 'Wrench / Tools', value: 'wrench' },
            { label: 'Check / Trust', value: 'check' },
          ],
        },
      ],
    },
  ],
};
