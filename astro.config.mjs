import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://eguwallet.eu',
  output: 'static',
  vite: {
    plugins: [tailwind()],
  },
  i18n: {
    defaultLocale: 'ro',
    locales: [
      'ro','en','de','fr','es','it','pl','pt','hu','cs',
      'sk','bg','hr','lt','lv','et','mt','sl','sv','da',
      'nl','el','fi','ga'
    ],
    routing: { prefixDefaultLocale: true },
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'ro',
        locales: {
          ro:'ro-RO', en:'en-EU', de:'de-DE', fr:'fr-FR', es:'es-ES',
          it:'it-IT', pl:'pl-PL', pt:'pt-PT', hu:'hu-HU', cs:'cs-CZ',
          sk:'sk-SK', bg:'bg-BG', hr:'hr-HR', lt:'lt-LT', lv:'lv-LV',
          et:'et-EE', mt:'mt-MT', sl:'sl-SI', sv:'sv-SE', da:'da-DK',
          nl:'nl-NL', el:'el-GR', fi:'fi-FI', ga:'ga-IE',
        },
      },
    }),
  ],
});
