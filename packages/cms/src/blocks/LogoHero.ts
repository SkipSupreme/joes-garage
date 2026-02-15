import type { Block } from 'payload';

export const LogoHeroBlock: Block = {
  slug: 'logoHero',
  labels: {
    singular: 'Logo Hero',
    plural: 'Logo Hero Sections',
  },
  fields: [
    {
      name: 'eyebrow',
      type: 'text',
      label: 'Eyebrow Badge Text',
      defaultValue: 'Bow River Pathway — Since 2007',
    },
    {
      name: 'heading',
      type: 'text',
      required: true,
      defaultValue: "Calgary's Shipping Container",
    },
    {
      name: 'headingAccent',
      type: 'text',
      label: 'Heading Accent',
      defaultValue: 'Bike Shop.',
      admin: {
        description: 'Colored line below the main heading',
      },
    },
    {
      name: 'subtitle',
      type: 'textarea',
    },
    {
      name: 'ctaButtons',
      type: 'array',
      label: 'CTA Buttons',
      maxRows: 3,
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
        },
        {
          name: 'link',
          type: 'text',
          required: true,
        },
        {
          name: 'style',
          type: 'select',
          defaultValue: 'primary',
          options: [
            { label: 'Primary (filled)', value: 'primary' },
            { label: 'Secondary (outline)', value: 'secondary' },
          ],
        },
      ],
    },
    {
      name: 'trustIndicators',
      type: 'array',
      label: 'Trust Indicators',
      maxRows: 4,
      fields: [
        {
          name: 'text',
          type: 'text',
          required: true,
        },
      ],
    },
  ],
};
