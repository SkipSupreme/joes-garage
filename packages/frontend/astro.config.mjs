import { defineConfig } from 'astro/config';
import alpinejs from '@astrojs/alpinejs';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://joes-garage.ca',
  output: 'server',
  adapter: cloudflare(),
  integrations: [alpinejs({ entrypoint: '/src/alpine.ts' }), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
