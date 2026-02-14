import type { Block } from 'payload';

export const SideBySideBlock: Block = {
  slug: 'sideBySide',
  labels: {
    singular: 'Image & Text',
    plural: 'Image & Text Sections',
  },
  fields: [
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
    {
      name: 'imagePosition',
      type: 'select',
      defaultValue: 'left',
      options: [
        { label: 'Image on Left', value: 'left' },
        { label: 'Image on Right', value: 'right' },
      ],
    },
  ],
};
