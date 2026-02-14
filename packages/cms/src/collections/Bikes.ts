import type { CollectionConfig } from 'payload';
import { rebuildFrontend } from '../hooks/rebuildFrontend';

export const Bikes: CollectionConfig = {
  slug: 'bikes',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'pricePerDay', 'status'],
  },
  hooks: {
    afterChange: [rebuildFrontend],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: 'Mountain', value: 'mountain' },
        { label: 'Road', value: 'road' },
        { label: 'Hybrid', value: 'hybrid' },
        { label: 'Cruiser', value: 'cruiser' },
        { label: 'E-Bike', value: 'e-bike' },
        { label: 'Kids', value: 'kids' },
      ],
    },
    {
      name: 'size',
      type: 'select',
      options: [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
        { label: 'Kids', value: 'kids' },
      ],
    },
    {
      name: 'pricePerDay',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Daily rental rate in CAD',
      },
    },
    {
      name: 'depositAmount',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Pre-authorization deposit in CAD',
      },
    },
    {
      name: 'photo',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
    {
      name: 'description',
      type: 'richText',
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'available',
      options: [
        { label: 'Available', value: 'available' },
        { label: 'In Repair', value: 'in-repair' },
        { label: 'Retired', value: 'retired' },
      ],
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'features',
      type: 'array',
      fields: [
        {
          name: 'feature',
          type: 'text',
          required: true,
        },
      ],
    },
  ],
};
