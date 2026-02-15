import type { Block } from 'payload';

export const ContactSectionBlock: Block = {
  slug: 'contactSection',
  labels: {
    singular: 'Contact Section',
    plural: 'Contact Sections',
  },
  fields: [
    {
      name: 'showForm',
      type: 'checkbox',
      defaultValue: true,
      label: 'Show Contact Form',
    },
    {
      name: 'infoItems',
      type: 'array',
      label: 'Contact Info Items',
      fields: [
        {
          name: 'icon',
          type: 'select',
          required: true,
          options: [
            { label: 'Map Pin', value: 'mapPin' },
            { label: 'Phone', value: 'phone' },
            { label: 'Email', value: 'email' },
          ],
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          admin: {
            description: 'Display text (e.g., "335 8 St SW")',
          },
        },
        {
          name: 'sublabel',
          type: 'text',
          admin: {
            description: 'Secondary text (e.g., "Calgary, AB")',
          },
        },
        {
          name: 'href',
          type: 'text',
          admin: {
            description: 'Link URL (e.g., "tel:+14038748189")',
          },
        },
      ],
    },
    {
      name: 'hours',
      type: 'array',
      label: 'Shop Hours',
      fields: [
        {
          name: 'days',
          type: 'text',
          required: true,
          admin: {
            description: 'e.g., "Monday – Friday"',
          },
        },
        {
          name: 'hours',
          type: 'text',
          required: true,
          admin: {
            description: 'e.g., "10:00 AM – 6:00 PM" or "Closed"',
          },
        },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      label: 'Social Media Links',
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          options: [
            { label: 'Facebook', value: 'facebook' },
            { label: 'Instagram', value: 'instagram' },
          ],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
      ],
    },
  ],
};
