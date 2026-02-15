import type { CollectionConfig } from 'payload';

export const Messages: CollectionConfig = {
  slug: 'messages',
  access: {
    // Anyone can create (public contact form via API)
    create: () => true,
    // Only logged-in admins can read/update/delete
    read: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'subject', 'email', 'read', 'createdAt'],
    description: 'Messages submitted via the contact form on the website.',
  },
  defaultSort: '-createdAt',
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'email',
      type: 'email',
      required: true,
    },
    {
      name: 'phone',
      type: 'text',
    },
    {
      name: 'subject',
      type: 'select',
      required: true,
      options: [
        { label: 'Repair Quote', value: 'repair' },
        { label: 'Rental Question', value: 'rental' },
        { label: 'General Inquiry', value: 'general' },
        { label: 'Something Else', value: 'other' },
      ],
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
    },
    {
      name: 'read',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'Mark as read after reviewing',
      },
    },
  ],
};
