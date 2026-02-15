import type { Block } from 'payload';

export const ServicesGridBlock: Block = {
  slug: 'servicesGrid',
  labels: {
    singular: 'Services Grid',
    plural: 'Services Grid Sections',
  },
  fields: [
    {
      name: 'heading',
      type: 'text',
      admin: {
        description: 'Optional override heading. If empty, services are shown without a heading.',
      },
    },
    {
      name: 'subtitle',
      type: 'textarea',
    },
    {
      name: 'noteText',
      type: 'textarea',
      label: 'Bottom Note',
      admin: {
        description: 'Disclaimer text below the grid (e.g., "Prices are starting estimates...")',
      },
    },
  ],
};
