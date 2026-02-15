import { buildConfig } from 'payload';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

import { Users } from './collections/Users';
import { Media } from './collections/Media';
import { Pages } from './collections/Pages';
import { Bikes } from './collections/Bikes';
import { Services } from './collections/Services';
import { Testimonials } from './collections/Testimonials';
import { Messages } from './collections/Messages';
import { SiteSettings } from './globals/SiteSettings';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default buildConfig({
  admin: {
    user: Users.slug,
    meta: {
      titleSuffix: " — Joe's Garage CMS",
      icons: [{ url: '/logo.webp' }],
    },
    components: {
      graphics: {
        Logo: '/src/components/admin/Logo',
        Icon: '/src/components/admin/Icon',
      },
      beforeLogin: ['/src/components/admin/BeforeLogin'],
      providers: ['/src/components/admin/DarkThemeProvider', '/src/components/admin/FileUploadFix'],
    },
  },

  collections: [Users, Media, Pages, Bikes, Services, Testimonials, Messages],

  globals: [SiteSettings],

  editor: lexicalEditor(),

  secret: process.env.PAYLOAD_SECRET || 'CHANGE-ME-IN-PRODUCTION',

  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5434/joes_garage',
    },
  }),

  sharp,

  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  cors: [
    process.env.FRONTEND_URL || 'http://localhost:4321',
    process.env.API_URL || 'http://localhost:3001',
  ],
});
