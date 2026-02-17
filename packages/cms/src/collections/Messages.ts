import type { CollectionConfig } from 'payload';

export const Messages: CollectionConfig = {
  slug: 'messages',
  access: {
    // Public contact form can create via API
    create: () => true,
    // Only logged-in admins can read/update/delete
    read: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user),
    delete: ({ req: { user } }) => Boolean(user),
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'subject', 'email', 'read', 'createdAt'],
    hideAPIURL: true,
    components: {
      beforeListTable: ['/src/components/admin/MessagesInbox'],
    },
  },
  defaultSort: '-createdAt',
  fields: [
    // Custom message view — replaces the default form fields with a clean card
    {
      name: 'messageView',
      type: 'ui',
      admin: {
        components: {
          Field: '/src/components/admin/MessageDetail',
        },
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'email',
      type: 'email',
      required: true,
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'phone',
      type: 'text',
      admin: { readOnly: true, hidden: true },
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
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'message',
      type: 'textarea',
      required: true,
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'read',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description: 'Check this when you\'ve read the message',
      },
    },
  ],
};
