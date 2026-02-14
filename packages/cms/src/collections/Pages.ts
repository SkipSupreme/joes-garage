import type { CollectionConfig } from 'payload';
import { HeroBlock } from '../blocks/Hero';
import { TextBlock } from '../blocks/TextBlock';
import { GalleryBlock } from '../blocks/Gallery';
import { SideBySideBlock } from '../blocks/SideBySide';
import { TestimonialsBlock } from '../blocks/Testimonials';
import { CTABlock } from '../blocks/CTA';
import { rebuildFrontend } from '../hooks/rebuildFrontend';

export const Pages: CollectionConfig = {
  slug: 'pages',
  access: {
    read: () => true,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'updatedAt'],
  },
  hooks: {
    afterChange: [rebuildFrontend],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      admin: {
        position: 'sidebar',
      },
      hooks: {
        beforeValidate: [
          ({ data, value }) => {
            if (!value && data?.title) {
              return data.title
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-|-$/g, '');
            }
            return value;
          },
        ],
      },
    },
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        HeroBlock,
        TextBlock,
        GalleryBlock,
        SideBySideBlock,
        TestimonialsBlock,
        CTABlock,
      ],
    },
    {
      name: 'meta',
      type: 'group',
      label: 'SEO',
      admin: {
        position: 'sidebar',
      },
      fields: [
        {
          name: 'title',
          type: 'text',
          label: 'Meta Title',
        },
        {
          name: 'description',
          type: 'textarea',
          label: 'Meta Description',
        },
        {
          name: 'ogImage',
          type: 'upload',
          relationTo: 'media',
          label: 'Open Graph Image',
        },
      ],
    },
  ],
};
