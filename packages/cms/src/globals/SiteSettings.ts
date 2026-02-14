import type { GlobalConfig } from 'payload';
import { rebuildFrontend } from '../hooks/rebuildFrontend';

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site Settings',
  access: {
    read: () => true,
  },
  hooks: {
    afterChange: [rebuildFrontend],
  },
  fields: [
    {
      name: 'shopName',
      type: 'text',
      required: true,
      defaultValue: "Joe's Garage",
    },
    {
      name: 'logo',
      type: 'upload',
      relationTo: 'media',
    },
    {
      name: 'address',
      type: 'text',
    },
    {
      name: 'phone',
      type: 'text',
    },
    {
      name: 'email',
      type: 'email',
    },
    {
      name: 'hours',
      type: 'array',
      label: 'Business Hours',
      fields: [
        {
          name: 'day',
          type: 'select',
          required: true,
          options: [
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
            'Sunday',
          ],
        },
        {
          name: 'open',
          type: 'text',
          required: true,
          admin: { description: 'e.g., "9:00 AM"' },
        },
        {
          name: 'close',
          type: 'text',
          required: true,
          admin: { description: 'e.g., "6:00 PM"' },
        },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      label: 'Social Media',
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          options: ['Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok'],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'waiverText',
      type: 'richText',
      label: 'Rental Waiver Text',
      admin: {
        description: 'The waiver content that customers must agree to before renting. Edit this to update the legal text.',
      },
    },
  ],
};
