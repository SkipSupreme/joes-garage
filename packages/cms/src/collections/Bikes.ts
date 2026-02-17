import type { CollectionConfig } from 'payload';
import { rebuildFrontend } from '../hooks/rebuildFrontend';

export const Bikes: CollectionConfig = {
  slug: 'bikes',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'price2h', 'price4h', 'pricePerDay', 'status'],
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
      index: true,
      options: [
        { label: 'City', value: 'city' },
        { label: 'Cruiser', value: 'cruiser' },
        { label: 'Mountain', value: 'mountain' },
        { label: 'Road', value: 'road' },
        { label: 'Hybrid', value: 'hybrid' },
        { label: 'Coaster', value: 'coaster' },
        { label: 'Kids', value: 'kids' },
        { label: 'Trail-a-Bike', value: 'trail-a-bike' },
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
      name: 'price2h',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: '2-hour rental rate in CAD',
      },
    },
    {
      name: 'price4h',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: '4-hour rental rate in CAD',
      },
    },
    {
      name: 'price8h',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: '8-hour (full day) rental rate in CAD',
      },
    },
    {
      name: 'pricePerDay',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'Multi-day rental rate per day in CAD',
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
      index: true,
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
