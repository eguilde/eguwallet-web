# EguWallet Web Landing Site — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a production-grade, SEO-optimised, mobile-first static landing site for EguWallet — a EUDI Wallet compliant with eIDAS 2.0 — in all 24 official EU languages, hosted at eguwallet.eu.

**Architecture:** Astro 5 with built-in i18n routing generates one complete static HTML file per language (`/ro/`, `/en/`, `/de/` …). TailwindCSS v4 via `@tailwindcss/vite` handles all styling with a CSS custom-property design token system derived exactly from the Android app `colors.xml`. Dark/light mode uses `data-theme` attribute set by an inline `<script>` in `<head>` (zero FOUC). GitHub Actions builds and rsyncs `dist/` to `egucluster1` on every push to `main`.

**Tech Stack:** Astro 5, TailwindCSS 4 (`@tailwindcss/vite`), `@astrojs/sitemap`, `astro-og-canvas`, TypeScript, nginx on egucluster1 (Debian, already has wildcard SSL for `*.eguwallet.eu`).

**Brand source of truth:** `/c/dev/eguwallet-android/app/src/main/res/values/colors.xml` and `drawable/ic_eguwallet_shield.xml` — all colors and SVG paths are transcribed exactly from those files.

**New repo:** `github.com/eguilde/eguwallet-web` — created in Task 1. Local clone at `/c/dev/eguwallet-web`.

---

## Content Writing Guidelines (Apply to All Sections)

Every piece of text on this site must follow these rules. Requirements in this document are structural hints — the writer/implementer must craft proper, polished citizen-facing copy:

1. **Short paragraphs** — max 3 sentences per paragraph. Citizens lose interest after 4 lines.
2. **Plain language** — no technical jargon without a plain-language explanation in the same sentence. "SD-JWT (a technology that lets you share only the specific data you choose)" not just "SD-JWT".
3. **Active voice** — "Your wallet sends only your name" not "Only your name is sent by the wallet".
4. **Benefits first** — lead with what the citizen gains, not how it works.
5. **Emotional anchors** — use concrete real-life scenarios ("at the pharmacy", "at a traffic stop", "renting a car abroad") to make abstract concepts tangible.
6. **Section length** — each section should be completable in under 90 seconds of reading. If it takes longer, split or cut.
7. **Headings as promises** — every H2 and H3 should promise something useful to the reader, not describe the content ("Stop carrying your driving licence" not "Driving Licence Section").
8. **EU legal references** — cite regulations by number and short name (e.g., "Reg. (EU) 2024/1183 — eIDAS 2.0") but always follow with a one-line plain-language summary of what it means for the citizen.

---

## Task 1: Create GitHub repo + Astro project

**Files:**
- Create: `/c/dev/eguwallet-web/` (entire project)
- Create: `astro.config.mjs`
- Create: `package.json` (via Astro installer)
- Create: `.github/workflows/deploy.yml`

**Step 1: Create the GitHub repo**

```bash
gh repo create eguilde/eguwallet-web --public --description "EguWallet — EUDI Wallet eIDAS 2.0 information site" --clone --clone-path /c/dev/eguwallet-web
cd /c/dev/eguwallet-web
```

**Step 2: Scaffold Astro project (minimal, no sample pages)**

```bash
npm create astro@latest . -- --template minimal --typescript strict --no-install --no-git
npm install
```

**Step 3: Install all dependencies**

```bash
npm install @astrojs/sitemap astro-og-canvas
npm install -D tailwindcss @tailwindcss/vite
```

**Step 4: Write `astro.config.mjs`**

```js
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
```

**Step 5: Write `src/styles/global.css`**

```css
@import "tailwindcss";

/* ─── EguWallet Design Tokens (exact match to Android colors.xml) ─── */
@theme {
  --color-primary:             #C41E3A;
  --color-on-primary:          #FFFFFF;
  --color-primary-container:   #FFDAD6;
  --color-secondary:           #1976D2;
  --color-on-secondary:        #FFFFFF;
  --color-secondary-container: #D1E4FF;
  --color-tertiary:            #B8860B;
  --color-tertiary-container:  #FFF8DC;
  --color-eu-blue:             #003399;
  --color-eu-gold:             #FFCC00;
  --color-crimson:             #C41E3A;
  --color-background:          #FFFBFF;
  --color-on-background:       #1D1B20;
  --color-surface:             #FFFBFF;
  --color-on-surface:          #1D1B20;
  --color-surface-variant:     #F4DDDB;
  --color-on-surface-variant:  #534341;
  --color-surface-low:         #FFF1EF;
  --color-surface-high:        #F6E4E2;
  --color-outline:             #857371;
  --color-outline-variant:     #D8C2BF;
  --color-loa-high:            #2E7D32;
  --color-loa-substantial:     #E65100;
}

/* ─── CSS custom properties for dark/light switching ─── */
:root {
  --bg:           #FFFBFF;
  --fg:           #1D1B20;
  --surface:      #FCEAE8;
  --surface-low:  #FFF1EF;
  --surface-high: #F6E4E2;
  --on-variant:   #534341;
  --outline:      #857371;
  --outline-var:  #D8C2BF;
  --primary:      #C41E3A;
  --secondary:    #1976D2;
  --tertiary:     #B8860B;
}

[data-theme="dark"] {
  --bg:           #141218;
  --fg:           #E6E0E9;
  --surface:      #211F22;
  --surface-low:  #1D1B1E;
  --surface-high: #2C2A2C;
  --on-variant:   #D8C2BF;
  --outline:      #A08C89;
  --outline-var:  #534341;
  --primary:      #FFB4AB;
  --secondary:    #9ECAFF;
  --tertiary:     #FFD54F;
}

html { color-scheme: light; }
[data-theme="dark"] html { color-scheme: dark; }

body {
  background-color: var(--bg);
  color: var(--fg);
  font-family: 'Segoe UI', 'Roboto', system-ui, -apple-system, sans-serif;
  transition: background-color 0.2s, color 0.2s;
}

/* ─── Smooth scroll ─── */
html { scroll-behavior: smooth; }

/* ─── Focus visible outline ─── */
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
```

**Step 6: Write `public/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://eguwallet.eu/sitemap-index.xml
```

**Step 7: Commit**

```bash
git add .
git commit -m "feat: init Astro 5 project with i18n, Tailwind v4, sitemap, design tokens"
git push origin main
```

---

## Task 2: Base Layout Component

**Files:**
- Create: `src/layouts/Base.astro`
- Create: `src/components/JsonLd.astro`
- Create: `src/components/Hreflang.astro`

**Step 1: Write `src/components/Hreflang.astro`**

Generates all 24 `<link rel="alternate" hreflang="...">` tags plus `x-default`.

```astro
---
const LOCALES: Record<string, string> = {
  ro:'ro-RO', en:'en-EU', de:'de-DE', fr:'fr-FR', es:'es-ES',
  it:'it-IT', pl:'pl-PL', pt:'pt-PT', hu:'hu-HU', cs:'cs-CZ',
  sk:'sk-SK', bg:'bg-BG', hr:'hr-HR', lt:'lt-LT', lv:'lv-LV',
  et:'et-EE', mt:'mt-MT', sl:'sl-SI', sv:'sv-SE', da:'da-DK',
  nl:'nl-NL', el:'el-GR', fi:'fi-FI', ga:'ga-IE',
};
const SITE = 'https://eguwallet.eu';
---
{Object.entries(LOCALES).map(([loc, hl]) => (
  <link rel="alternate" hreflang={hl} href={`${SITE}/${loc}/`} />
))}
<link rel="alternate" hreflang="x-default" href={`${SITE}/ro/`} />
```

**Step 2: Write `src/components/JsonLd.astro`**

Four JSON-LD schemas: SoftwareApplication, Organization, WebSite, FAQPage.

```astro
---
interface Props { lang: string; faqItems: {q:string; a:string}[]; }
const { lang, faqItems } = Astro.props;
const SITE = 'https://eguwallet.eu';

const softwareApp = {
  "@context":"https://schema.org",
  "@type":"SoftwareApplication",
  "name":"EguWallet",
  "operatingSystem":"Android",
  "applicationCategory":"UtilitiesApplication",
  "offers":{"@type":"Offer","price":"0","priceCurrency":"EUR"},
  "description":"EUDI Wallet conform eIDAS 2.0 — identitate digitală europeană",
  "url":SITE,
  "downloadUrl":"https://play.google.com/store/apps/details?id=com.eguwallet.wallet",
  "author":{"@type":"Organization","name":"IT Eguilde SRL"},
};

const organization = {
  "@context":"https://schema.org",
  "@type":"Organization",
  "name":"IT Eguilde SRL",
  "url":SITE,
  "logo":`${SITE}/assets/logo-shield.svg`,
  "sameAs":["https://github.com/eguilde"],
};

const website = {
  "@context":"https://schema.org",
  "@type":"WebSite",
  "name":"EguWallet",
  "url":SITE,
  "inLanguage": lang,
};

const faqPage = {
  "@context":"https://schema.org",
  "@type":"FAQPage",
  "mainEntity": faqItems.map(({q,a}) => ({
    "@type":"Question",
    "name": q,
    "acceptedAnswer":{"@type":"Answer","text": a},
  })),
};
---
<script type="application/ld+json" set:html={JSON.stringify(softwareApp)} />
<script type="application/ld+json" set:html={JSON.stringify(organization)} />
<script type="application/ld+json" set:html={JSON.stringify(website)} />
<script type="application/ld+json" set:html={JSON.stringify(faqPage)} />
```

**Step 3: Write `src/layouts/Base.astro`**

Full SEO head: charset, viewport, title, description, canonical, hreflang, OG, Twitter, theme-color, preload shield, inline dark-mode script.

```astro
---
import '../styles/global.css';
import Hreflang from '../components/Hreflang.astro';
import JsonLd from '../components/JsonLd.astro';

interface Props {
  lang: string;
  title: string;
  description: string;
  ogImage?: string;
  faqItems: {q:string; a:string}[];
}
const { lang, title, description, faqItems } = Astro.props;
const SITE = 'https://eguwallet.eu';
const ogImage = Astro.props.ogImage ?? `${SITE}/assets/og/og-${lang}.png`;
const canonical = `${SITE}/${lang}/`;
---
<!doctype html>
<html lang={lang} data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <!-- Theme detection: MUST be inline and before first paint to prevent FOUC -->
  <script is:inline>
    (function(){
      var t=localStorage.getItem('egu-theme')||
        (window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
      document.documentElement.setAttribute('data-theme',t);
    })();
  </script>

  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonical} />

  <!-- hreflang for all 24 EU languages -->
  <Hreflang />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content={canonical} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content={lang} />
  <meta property="og:site_name" content="EguWallet" />

  <!-- Twitter / X -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImage} />

  <!-- Performance -->
  <link rel="preload" as="image" href="/assets/logo-shield.svg" />
  <meta name="theme-color" content="#C41E3A" />
  <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />

  <!-- JSON-LD -->
  <JsonLd lang={lang} faqItems={faqItems} />
</head>
<body>
  <slot />
</body>
</html>
```

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: base layout with full SEO head, hreflang, JSON-LD, no-FOUC dark mode"
```

---

## Task 3: SVG Brand Components

The shield and EU flag SVG paths are transcribed exactly from the Android XML drawables in `eguwallet-android/app/src/main/res/drawable/`.

**Files:**
- Create: `src/components/ShieldLogo.astro`
- Create: `src/components/EuFlag.astro`
- Create: `public/assets/favicon.svg`
- Create: `public/assets/logo-shield.svg`

**Step 1: Write `src/components/ShieldLogo.astro`**

Paths are exact transcriptions of `ic_eguwallet_shield.xml` (viewport 108×108). Background gradient from `ic_eguwallet_bg.xml` (#D4213F → #8B0010 radial).

```astro
---
interface Props { size?: number; showBg?: boolean; class?: string; }
const { size = 64, showBg = true, class: cls = '' } = Astro.props;
---
<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 108 108"
  width={size}
  height={size}
  class={cls}
  aria-label="EguWallet shield logo"
  role="img"
>
  <defs>
    <radialGradient id="egu-bg" cx="50%" cy="40%" r="76%">
      <stop offset="0%" stop-color="#D4213F"/>
      <stop offset="100%" stop-color="#8B0010"/>
    </radialGradient>
  </defs>
  {showBg && <circle cx="54" cy="54" r="54" fill="url(#egu-bg)"/>}
  <!-- Shield body — white, from ic_eguwallet_shield.xml -->
  <path fill="#FFFFFF" d="M54,22 C54,22 28,22 28,22 L28,60 Q28,78 54,88 Q80,78 80,60 L80,22 Z"/>
  <!-- Rounded top corners overlay -->
  <path fill="#FFFFFF" d="M30,22 Q28,22 28,24 L28,28 Q42,26 54,26 Q66,26 80,28 L80,24 Q80,22 78,22 Z"/>
  <!-- EU Blue W lettermark — #003399 -->
  <path fill="#003399" d="M34,34 L40,58 L47,43 L54,58 L61,43 L68,58 L74,34 L70,34 L64,53 L57,38 L54,46 L51,38 L44,53 L38,34 Z"/>
  <!-- 5 gold EU stars arcing above shield — #FFCC00 -->
  <path fill="#FFCC00" d="M38,17 L39,20 L42,20 L39.5,22 L40.5,25 L38,23 L35.5,25 L36.5,22 L34,20 L37,20 Z"/>
  <path fill="#FFCC00" d="M46,14 L47,17 L50,17 L47.5,19 L48.5,22 L46,20 L43.5,22 L44.5,19 L42,17 L45,17 Z"/>
  <path fill="#FFCC00" d="M54,12 L55,15 L58,15 L55.5,17 L56.5,20 L54,18 L51.5,20 L52.5,17 L50,15 L53,15 Z"/>
  <path fill="#FFCC00" d="M62,14 L63,17 L66,17 L63.5,19 L64.5,22 L62,20 L59.5,22 L60.5,19 L58,17 L61,17 Z"/>
  <path fill="#FFCC00" d="M70,17 L71,20 L74,20 L71.5,22 L72.5,25 L70,23 L67.5,25 L68.5,22 L66,20 L69,20 Z"/>
</svg>
```

**Step 2: Write `src/components/EuFlag.astro`**

Exact transcription of `ic_eu_flag.xml` (viewport 32×32, 12 gold stars).

```astro
---
interface Props { size?: number; class?: string; }
const { size = 32, class: cls = '' } = Astro.props;
---
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 28"
  width={size} height={Math.round(size * 0.875)}
  class={cls} aria-label="EU flag" role="img">
  <!-- EU Blue disc — from ic_eu_flag.xml -->
  <path fill="#003399" d="M16,1 C8.82,1 3,6.82 3,14 C3,21.18 8.82,27 16,27 C23.18,27 29,21.18 29,14 C29,6.82 23.18,1 16,1 Z"/>
  <!-- 12 gold stars at radius 8 from centre (16,14) — exact paths from ic_eu_flag.xml -->
  <path fill="#FFCC00" d="M16,4.5 L16.4,5.7 L17.7,5.7 L16.65,6.5 L17.05,7.7 L16,6.9 L14.95,7.7 L15.35,6.5 L14.3,5.7 L15.6,5.7 Z"/>
  <path fill="#FFCC00" d="M20,5.6 L20.4,6.8 L21.7,6.8 L20.65,7.6 L21.05,8.8 L20,8.0 L18.95,8.8 L19.35,7.6 L18.3,6.8 L19.6,6.8 Z"/>
  <path fill="#FFCC00" d="M23,8.6 L23.4,9.8 L24.7,9.8 L23.65,10.6 L24.05,11.8 L23,11.0 L21.95,11.8 L22.35,10.6 L21.3,9.8 L22.6,9.8 Z"/>
  <path fill="#FFCC00" d="M24,12.5 L24.4,13.7 L25.7,13.7 L24.65,14.5 L25.05,15.7 L24,14.9 L22.95,15.7 L23.35,14.5 L22.3,13.7 L23.6,13.7 Z"/>
  <path fill="#FFCC00" d="M23,16.5 L23.4,17.7 L24.7,17.7 L23.65,18.5 L24.05,19.7 L23,18.9 L21.95,19.7 L22.35,18.5 L21.3,17.7 L22.6,17.7 Z"/>
  <path fill="#FFCC00" d="M20,19.5 L20.4,20.7 L21.7,20.7 L20.65,21.5 L21.05,22.7 L20,21.9 L18.95,22.7 L19.35,21.5 L18.3,20.7 L19.6,20.7 Z"/>
  <path fill="#FFCC00" d="M16,20.5 L16.4,21.7 L17.7,21.7 L16.65,22.5 L17.05,23.7 L16,22.9 L14.95,23.7 L15.35,22.5 L14.3,21.7 L15.6,21.7 Z"/>
  <path fill="#FFCC00" d="M12,19.5 L12.4,20.7 L13.7,20.7 L12.65,21.5 L13.05,22.7 L12,21.9 L10.95,22.7 L11.35,21.5 L10.3,20.7 L11.6,20.7 Z"/>
  <path fill="#FFCC00" d="M9,16.5 L9.4,17.7 L10.7,17.7 L9.65,18.5 L10.05,19.7 L9,18.9 L7.95,19.7 L8.35,18.5 L7.3,17.7 L8.6,17.7 Z"/>
  <path fill="#FFCC00" d="M8,12.5 L8.4,13.7 L9.7,13.7 L8.65,14.5 L9.05,15.7 L8,14.9 L6.95,15.7 L7.35,14.5 L6.3,13.7 L7.6,13.7 Z"/>
  <path fill="#FFCC00" d="M9,8.6 L9.4,9.8 L10.7,9.8 L9.65,10.6 L10.05,11.8 L9,11.0 L7.95,11.8 L8.35,10.6 L7.3,9.8 L8.6,9.8 Z"/>
  <path fill="#FFCC00" d="M12,5.6 L12.4,6.8 L13.7,6.8 L12.65,7.6 L13.05,8.8 L12,8.0 L10.95,8.8 L11.35,7.6 L10.3,6.8 L11.6,6.8 Z"/>
</svg>
```

**Step 3: Create `public/assets/favicon.svg`**

Shield on crimson circle, scaled to 32×32.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="76%">
      <stop offset="0%" stop-color="#D4213F"/><stop offset="100%" stop-color="#8B0010"/>
    </radialGradient>
  </defs>
  <circle cx="54" cy="54" r="54" fill="url(#bg)"/>
  <path fill="#FFF" d="M54,22 C54,22 28,22 28,22 L28,60 Q28,78 54,88 Q80,78 80,60 L80,22 Z"/>
  <path fill="#FFF" d="M30,22 Q28,22 28,24 L28,28 Q42,26 54,26 Q66,26 80,28 L80,24 Q80,22 78,22 Z"/>
  <path fill="#003399" d="M34,34 L40,58 L47,43 L54,58 L61,43 L68,58 L74,34 L70,34 L64,53 L57,38 L54,46 L51,38 L44,53 L38,34 Z"/>
  <path fill="#FFCC00" d="M38,17 L39,20 L42,20 L39.5,22 L40.5,25 L38,23 L35.5,25 L36.5,22 L34,20 L37,20 Z"/>
  <path fill="#FFCC00" d="M46,14 L47,17 L50,17 L47.5,19 L48.5,22 L46,20 L43.5,22 L44.5,19 L42,17 L45,17 Z"/>
  <path fill="#FFCC00" d="M54,12 L55,15 L58,15 L55.5,17 L56.5,20 L54,18 L51.5,20 L52.5,17 L50,15 L53,15 Z"/>
  <path fill="#FFCC00" d="M62,14 L63,17 L66,17 L63.5,19 L64.5,22 L62,20 L59.5,22 L60.5,19 L58,17 L61,17 Z"/>
  <path fill="#FFCC00" d="M70,17 L71,20 L74,20 L71.5,22 L72.5,25 L70,23 L67.5,25 L68.5,22 L66,20 L69,20 Z"/>
</svg>
```

Also copy this file as `public/assets/logo-shield.svg`.

**Step 4: Commit**

```bash
git add src/components/ShieldLogo.astro src/components/EuFlag.astro public/assets/
git commit -m "feat(brand): shield logo + EU flag SVG components, exact paths from Android XML"
```

---

## Task 4: Translation System (i18n JSON)

**Files:**
- Create: `src/i18n/ro.json` (Romanian — default, hand-written)
- Create: `src/i18n/en.json` (English — hand-written)
- Create: `src/i18n/index.ts` (typed loader)
- Create: `src/i18n/[de|fr|es|it|pl|pt|hu|cs|sk|bg|hr|lt|lv|et|mt|sl|sv|da|nl|el|fi|ga].json` (22 machine-translated stubs)

**Step 1: Write `src/i18n/ro.json`**

All string keys for every section. Romanian is the authoritative source.

```json
{
  "lang": "ro",
  "langName": "Română",
  "isMachineTranslated": false,
  "nav": {
    "what": "Ce este",
    "privacy": "Confidențialitate",
    "documents": "Documente",
    "usedToday": "Unde funcționează",
    "future": "Viitor",
    "howItWorks": "Cum funcționează",
    "faq": "Întrebări frecvente",
    "download": "Descarcă"
  },
  "hero": {
    "title": "Identitatea ta digitală — sigură, privată, mereu la tine",
    "subtitle": "EguWallet este portofelul digital european certificat eIDAS 2.0 care înlocuiește documentele fizice cu echivalente digitale verificabile, recunoscute în toate statele membre UE.",
    "badge1": "eIDAS 2.0 Conform",
    "badge2": "EUDI Wallet Certificat",
    "badge3": "Gratuit",
    "downloadAndroid": "Disponibil pe Google Play",
    "downloadIos": "Disponibil curând pe App Store",
    "downloadIosComingSoon": "În curând"
  },
  "what": {
    "heading": "Ce este EguWallet?",
    "card1Title": "Reglementat de Legea UE",
    "card1Body": "EguWallet este construit pe Regulamentul (UE) 2024/1183 — revizuirea eIDAS — care garantează fiecărui cetățean european dreptul la un portofel digital gratuit, recunoscut în toate cele 27 de state membre.",
    "card2Title": "Ce este un EUDI Wallet?",
    "card2Body": "Un Portofel European de Identitate Digitală (EUDI) este o aplicație sigură care stochează documente de identitate digitale verificabile: buletin, pașaport, permis auto, documente de vehicul și multe altele — toate sub controlul tău exclusiv.",
    "card3Title": "Cine furnizează EguWallet?",
    "card3Body": "EguWallet este dezvoltat de IT Eguilde SRL, furnizor autorizat de identitate digitală. Aplicația respectă integral Arhitectura de Referință EUDI (ARF 2.5+), standardele OpenID4VCI și OpenID4VP."
  },
  "privacy": {
    "heading": "Datele tale, controlul tău",
    "subheading": "Dezvăluire selectivă — numai ce este necesar, numai când ești de acord",
    "body": "EguWallet utilizează SD-JWT (Selective Disclosure JWT) și mDoc/ISO 18013-5 pentru a permite dezvăluirea selectivă a datelor. Când un comerciant sau o instituție îți solicită verificarea identității, tu alegi exact ce date sunt transmise. Nimic mai mult.",
    "example1Title": "Verificare vârstă 18+",
    "example1Step1": "Comerciantul scanează codul QR",
    "example1Step2": "Portofelul tău primește cererea",
    "example1Step3": "Tu aprobi: transmite DOAR «vârstă ≥ 18: DA»",
    "example1Step4": "Comerciantul nu primește: nume, CNP, adresă, fotografie",
    "legalTitle": "Baza juridică",
    "legal1": "GDPR Art. 5(1)(c) — principiul minimizării datelor: prelucrarea datelor se limitează la strictul necesar.",
    "legal2": "Reg. (UE) 2024/1183 — prezentarea selectivă este un drept al cetățeanului, nu o opțiune opțională.",
    "legal3": "Nicio prezentare nu este stocată de portofel sau de parte terță — fiecare dezvăluire este efemeră."
  },
  "documents": {
    "heading": "Documentele din portofelul tău",
    "subheading": "Toate documentele tale importante — digitale, verificabile, mereu la îndemână",
    "items": [
      { "icon": "🪪", "title": "Carte de identitate (PID)", "body": "Documentul principal de identitate digitală conform eIDAS 2.0. Recunoscut în toate statele membre UE.", "status": "available" },
      { "icon": "🛂", "title": "Pașaport", "body": "Versiunea digitală a pașaportului tău, verificabilă instantaneu de autorități și servicii.", "status": "available" },
      { "icon": "🚗", "title": "Permis de conducere", "body": "Permisul auto digital conform mDoc/ISO 18013-5. Verificabil fără contact, inclusiv de Poliția Rutieră.", "status": "available" },
      { "icon": "📋", "title": "Certificat de înmatriculare", "body": "Talonul vehiculului în format digital. Nu mai cărați hârtii.", "status": "available" },
      { "icon": "🛡️", "title": "Asigurare RCA", "body": "Polița de asigurare auto obligatorie, verificabilă în timp real.", "status": "available" },
      { "icon": "🔧", "title": "ITP / RAR (Carte auto)", "body": "Inspecția tehnică periodică și datele RAR ale vehiculului — certificate digitale verificabile.", "status": "available" },
      { "icon": "🏢", "title": "Documente firmă", "body": "Certificat de înregistrare ONRC, împuterniciri și documente corporative. Semnați digital cu portofelul.", "status": "soon" },
      { "icon": "🏠", "title": "Documente de proprietate", "body": "Extrase de carte funciară și documente de proprietate imobiliară în format digital verificabil.", "status": "soon" }
    ],
    "statusAvailable": "Disponibil",
    "statusSoon": "În curând"
  },
  "usedToday": {
    "heading": "Unde funcționează EguWallet astăzi",
    "subheading": "Aplicații de producție care folosesc deja EguWallet pentru autentificare și verificare",
    "app1Name": "Consiliul Județean Ilfov",
    "app1Url": "https://ilfov.net",
    "app1Body": "Servicii publice digitale pentru cetățenii județului Ilfov — autentificare cu EguWallet pentru acces la portalul e-guvernare, depunere cereri, verificare documente.",
    "app2Name": "Primăria Sectorului 2 București",
    "app2Url": "https://sector2.eu",
    "app2Body": "Servicii municipale digitale pentru locuitorii Sectorului 2 — autentificare rapidă și sigură cu portofelul digital pentru toate serviciile online ale primăriei.",
    "badgeText": "Autentifică-te cu EguWallet"
  },
  "future": {
    "heading": "Ce urmează — viitorul identității digitale",
    "subheading": "EguWallet se extinde continuu cu noi cazuri de utilizare care fac viața mai ușoară",
    "items": [
      {
        "icon": "📡",
        "title": "Verificare dispozitiv la dispozitiv (Bluetooth)",
        "body": "Ca plata NFC contactless — ofițerul de poliție sau comerciantul apropie telefonul de al tău și primește instantaneu datele autorizate de tine. Fără internet, fără server intermediar."
      },
      {
        "icon": "🚔",
        "title": "Control de identitate de către autorități",
        "body": "Similar cu plata contactless modernă: ofițerul de ordine publică verifică identitatea prin NFC/Bluetooth. Tu controlezi ce date sunt transmise. Rapid, sigur, fără fotocopii."
      },
      {
        "icon": "🍺",
        "title": "Verificare vârstă 18+ (în curând)",
        "body": "Implementare iminentă cu un important retailer român pentru controlul vârstei la vânzarea de alcool. Comerciantul primește doar răspunsul DA/NU — nicio altă dată personală nu este dezvăluită."
      },
      {
        "icon": "🚌",
        "title": "Abonamente și bilete transport public",
        "body": "Elevi și studenți cu drept la transport gratuit își dovedesc statutul prin EguWallet. Călătorii obișnuiți cumpără și prezintă biletele digital — fără hârtie, fără validatoare cu contact."
      },
      {
        "icon": "📍",
        "title": "Adresa pe noul buletin românesc",
        "body": "Noul buletin român nu mai conține adresa pe cip. EguWallet rezolvă această problemă: adresa ta de domiciliu, certificată de registrul oficial, poate fi dezvăluită selectiv când este necesar."
      },
      {
        "icon": "✍️",
        "title": "Semnătură digitală calificată",
        "body": "EguWallet va funcționa ca dispozitiv de semnătură digitală calificată (QES — Qualified Electronic Signature) conform eIDAS 2.0. Semnează documente cu valoare juridică deplină, recunoscute în toate statele membre UE — de pe telefonul tău."
      }
    ]
  },
  "howItWorks": {
    "heading": "Cum funcționează",
    "step1Title": "1. Descarcă aplicația",
    "step1Body": "Instalează EguWallet gratuit din Google Play Store. Disponibil în curând și pe Apple App Store.",
    "step2Title": "2. Activează portofelul",
    "step2Body": "Verifică numărul de telefon, creează un PIN securizat și conectează-te la portalul județului sau orașului tău pentru a-ți înregistra documentele digitale.",
    "step3Title": "3. Prezintă cu control total",
    "step3Body": "Scanezi un cod QR, atingi un terminal NFC sau partajezi un link securizat. Tu alegi exact ce date sunt transmise — niciodată mai mult decât este necesar."
  },
  "faq": {
    "heading": "Întrebări frecvente",
    "items": [
      { "q": "Ce este EguWallet?", "a": "EguWallet este un portofel digital european certificat eIDAS 2.0, dezvoltat de IT Eguilde SRL. Vă permite să stocați și să prezentați documente de identitate digitale (buletin, pașaport, permis auto etc.) în mod securizat, pe telefonul dvs., cu control total asupra datelor personale." },
      { "q": "Ce documente pot stoca în EguWallet?", "a": "Momentan: carte de identitate (PID), pașaport, permis de conducere, certificat de înmatriculare, asigurare RCA și carte auto (ITP/RAR). În curând: documente de firmă și documente de proprietate." },
      { "q": "Datele mele personale sunt în siguranță?", "a": "Da. EguWallet folosește SD-JWT și mDoc/ISO 18013-5 pentru dezvăluire selectivă — transmiteți doar datele pe care le aprobați explicit. Nicio prezentare nu este stocată. Baza juridică: GDPR Art. 5(1)(c) și Regulamentul (UE) 2024/1183." },
      { "q": "Unde pot folosi EguWallet?", "a": "Astăzi: la serviciile digitale ale Consiliului Județean Ilfov (ilfov.net) și Primăriei Sectorului 2 (sector2.eu). Urmează extinderea la alte instituții publice și retaileri privați din România și UE." },
      { "q": "Ce este eIDAS 2.0?", "a": "eIDAS 2.0 este Regulamentul (UE) 2024/1183 care amendează regulamentul eIDAS original. Garantează fiecărui cetățean european dreptul la un portofel digital gratuit (EUDI Wallet), recunoscut în toate cele 27 de state membre." },
      { "q": "Cum funcționează dezvăluirea selectivă?", "a": "Când un serviciu solicită verificarea identității, portofelul dvs. vă arată exact ce date sunt cerute. Aprobați sau respingeți fiecare câmp. De exemplu, pentru verificarea vârstei la 18 ani, comerciantul primește doar răspunsul DA/NU — nu vă vede numele, CNP-ul sau adresa." },
      { "q": "Este EguWallet gratuit?", "a": "Da, complet gratuit pentru cetățeni. Descărcarea, înregistrarea și utilizarea sunt fără cost." },
      { "q": "Cum îmi activez portofelul digital?", "a": "Descărcați aplicația din Google Play, verificați numărul de telefon, creați un PIN, apoi conectați-vă la portalul județului sau orașului dvs. pentru înregistrarea documentelor. Procesul durează aproximativ 5 minute." }
    ]
  },
  "footer": {
    "provider": "Furnizat de IT Eguilde SRL",
    "tagline": "Portofel Digital European — eIDAS 2.0 Conform",
    "privacy": "Politica de confidențialitate",
    "legal": "Termeni și condiții",
    "contact": "Contact",
    "euCompliance": "eIDAS 2.0 Conform",
    "machineTranslatedNotice": "Această traducere a fost generată automat. Pentru versiunea autoritativă, consultați textul în română sau engleză.",
    "rights": "© 2026 IT Eguilde SRL. Toate drepturile rezervate."
  }
}
```

**Step 2: Write `src/i18n/en.json`**

Complete English translation (hand-written). Same keys as `ro.json`, values in English.

```json
{
  "lang": "en",
  "langName": "English",
  "isMachineTranslated": false,
  "nav": {
    "what": "What is it",
    "privacy": "Privacy",
    "documents": "Documents",
    "usedToday": "Where it works",
    "future": "Future",
    "howItWorks": "How it works",
    "faq": "FAQ",
    "download": "Download"
  },
  "hero": {
    "title": "Your digital identity — secure, private, always with you",
    "subtitle": "EguWallet is a European eIDAS 2.0 certified digital wallet that replaces physical documents with verifiable digital equivalents, recognised across all EU member states.",
    "badge1": "eIDAS 2.0 Compliant",
    "badge2": "Certified EUDI Wallet",
    "badge3": "Free",
    "downloadAndroid": "Get it on Google Play",
    "downloadIos": "Available soon on App Store",
    "downloadIosComingSoon": "Coming Soon"
  },
  "what": {
    "heading": "What is EguWallet?",
    "card1Title": "Regulated by EU Law",
    "card1Body": "EguWallet is built on Regulation (EU) 2024/1183 — the eIDAS revision — which guarantees every European citizen the right to a free digital wallet, recognised across all 27 member states.",
    "card2Title": "What is a EUDI Wallet?",
    "card2Body": "A European Digital Identity Wallet (EUDI) is a secure app that stores verifiable digital identity documents: ID card, passport, driving licence, vehicle documents and more — all under your exclusive control.",
    "card3Title": "Who provides EguWallet?",
    "card3Body": "EguWallet is developed by IT Eguilde SRL, an authorised digital identity provider. The app fully complies with the EUDI Architecture Reference Framework (ARF 2.5+), OpenID4VCI and OpenID4VP standards."
  },
  "privacy": {
    "heading": "Your data, your control",
    "subheading": "Selective disclosure — only what is needed, only when you agree",
    "body": "EguWallet uses SD-JWT (Selective Disclosure JWT) and mDoc/ISO 18013-5 to enable selective data disclosure. When a merchant or institution requests identity verification, you choose exactly which data is transmitted. Nothing more.",
    "example1Title": "Age 18+ verification",
    "example1Step1": "Merchant scans QR code",
    "example1Step2": "Your wallet receives the request",
    "example1Step3": "You approve: transmit ONLY «age ≥ 18: YES»",
    "example1Step4": "Merchant does NOT receive: name, ID number, address, photo",
    "legalTitle": "Legal basis",
    "legal1": "GDPR Art. 5(1)(c) — data minimisation principle: processing is limited to what is strictly necessary.",
    "legal2": "Reg. (EU) 2024/1183 — selective presentation is a citizen right, not an optional feature.",
    "legal3": "No presentation is stored by the wallet or any third party — every disclosure is ephemeral."
  },
  "documents": {
    "heading": "Documents in your wallet",
    "subheading": "All your important documents — digital, verifiable, always at hand",
    "items": [
      { "icon": "🪪", "title": "Identity Card (PID)", "body": "The primary digital identity document compliant with eIDAS 2.0. Recognised across all EU member states.", "status": "available" },
      { "icon": "🛂", "title": "Passport", "body": "The digital version of your passport, instantly verifiable by authorities and services.", "status": "available" },
      { "icon": "🚗", "title": "Driving Licence", "body": "Digital driving licence compliant with mDoc/ISO 18013-5. Contactlessly verifiable, including by traffic police.", "status": "available" },
      { "icon": "📋", "title": "Vehicle Registration", "body": "Your vehicle registration document in digital format. No more carrying paper documents.", "status": "available" },
      { "icon": "🛡️", "title": "Vehicle Insurance (RCA)", "body": "Mandatory vehicle insurance policy, verifiable in real time.", "status": "available" },
      { "icon": "🔧", "title": "Technical Inspection / RAR", "body": "Periodic technical inspection (ITP) and RAR vehicle data — verifiable digital certificates.", "status": "available" },
      { "icon": "🏢", "title": "Company Documents", "body": "Company registration certificate, powers of attorney and corporate documents. Sign digitally with your wallet.", "status": "soon" },
      { "icon": "🏠", "title": "Property Documents", "body": "Land registry extracts and real estate ownership documents in verifiable digital format.", "status": "soon" }
    ],
    "statusAvailable": "Available",
    "statusSoon": "Coming Soon"
  },
  "usedToday": {
    "heading": "Where EguWallet works today",
    "subheading": "Production applications already using EguWallet for authentication and verification",
    "app1Name": "Ilfov County Council",
    "app1Url": "https://ilfov.net",
    "app1Body": "Digital public services for Ilfov County citizens — EguWallet authentication for e-government portal access, application submission, and document verification.",
    "app2Name": "Sector 2 Bucharest City Hall",
    "app2Url": "https://sector2.eu",
    "app2Body": "Digital municipal services for Sector 2 residents — fast and secure authentication with the digital wallet for all online city hall services.",
    "badgeText": "Sign in with EguWallet"
  },
  "future": {
    "heading": "What's next — the future of digital identity",
    "subheading": "EguWallet continuously expands with new use cases that make life easier",
    "items": [
      {
        "icon": "📡",
        "title": "Device-to-Device Verification (Bluetooth)",
        "body": "Like contactless NFC payment — a police officer or merchant brings their phone near yours and instantly receives only the data you have authorised. No internet, no intermediate server."
      },
      {
        "icon": "🚔",
        "title": "Law Enforcement Identity Check",
        "body": "Similar to modern contactless payment: a law enforcement officer verifies identity via NFC/Bluetooth. You control what data is transmitted. Fast, secure, no photocopies needed."
      },
      {
        "icon": "🍺",
        "title": "Age 18+ Verification (Coming Soon)",
        "body": "Imminent deployment with a major Romanian retailer for age control on alcohol sales. The merchant receives only a YES/NO answer — no other personal data is disclosed."
      },
      {
        "icon": "🚌",
        "title": "Public Transport Tickets & Passes",
        "body": "Students entitled to free travel prove their status via EguWallet. Regular passengers purchase and present tickets digitally — no paper, no contact validators."
      },
      {
        "icon": "📍",
        "title": "Address on the New Romanian ID Card",
        "body": "The new Romanian ID card no longer contains an address on the chip. EguWallet solves this: your registered address, certified by the official registry, can be selectively disclosed when required."
      },
      {
        "icon": "✍️",
        "title": "Qualified Digital Signature",
        "body": "EguWallet will function as a Qualified Electronic Signature (QES) device compliant with eIDAS 2.0. Sign documents with full legal force, recognised across all EU member states — directly from your phone."
      }
    ]
  },
  "howItWorks": {
    "heading": "How it works",
    "step1Title": "1. Download the app",
    "step1Body": "Install EguWallet for free from the Google Play Store. Coming soon on Apple App Store.",
    "step2Title": "2. Activate your wallet",
    "step2Body": "Verify your phone number, create a secure PIN, and connect to your county or city portal to register your digital documents.",
    "step3Title": "3. Present with full control",
    "step3Body": "Scan a QR code, tap an NFC terminal or share a secure link. You choose exactly what data is transmitted — never more than is necessary."
  },
  "faq": {
    "heading": "Frequently asked questions",
    "items": [
      { "q": "What is EguWallet?", "a": "EguWallet is a European eIDAS 2.0 certified digital wallet developed by IT Eguilde SRL. It allows you to store and present digital identity documents (ID card, passport, driving licence etc.) securely on your phone, with full control over your personal data." },
      { "q": "What documents can I store in EguWallet?", "a": "Currently: identity card (PID), passport, driving licence, vehicle registration, RCA insurance and vehicle inspection certificate (ITP/RAR). Coming soon: company documents and property documents." },
      { "q": "Is my personal data secure?", "a": "Yes. EguWallet uses SD-JWT and mDoc/ISO 18013-5 for selective disclosure — you only transmit data you explicitly approve. No presentation is stored. Legal basis: GDPR Art. 5(1)(c) and Regulation (EU) 2024/1183." },
      { "q": "Where can I use EguWallet?", "a": "Today: Ilfov County Council digital services (ilfov.net) and Sector 2 City Hall (sector2.eu). Expansion to other public institutions and private retailers in Romania and the EU is ongoing." },
      { "q": "What is eIDAS 2.0?", "a": "eIDAS 2.0 is Regulation (EU) 2024/1183 amending the original eIDAS regulation. It guarantees every European citizen the right to a free digital wallet (EUDI Wallet), recognised across all 27 member states." },
      { "q": "How does selective disclosure work?", "a": "When a service requests identity verification, your wallet shows you exactly what data is being requested. You approve or reject each field. For example, for age-18 verification, the merchant receives only a YES/NO — they never see your name, national ID number or address." },
      { "q": "Is EguWallet free?", "a": "Yes, completely free for citizens. Download, registration and use are all without cost." },
      { "q": "How do I activate my digital wallet?", "a": "Download the app from Google Play, verify your phone number, create a PIN, then connect to your county or city portal to register your documents. The process takes approximately 5 minutes." }
    ]
  },
  "footer": {
    "provider": "Provided by IT Eguilde SRL",
    "tagline": "European Digital Wallet — eIDAS 2.0 Compliant",
    "privacy": "Privacy Policy",
    "legal": "Terms & Conditions",
    "contact": "Contact",
    "euCompliance": "eIDAS 2.0 Compliant",
    "machineTranslatedNotice": "This translation was automatically generated. For the authoritative version, please refer to the Romanian or English text.",
    "rights": "© 2026 IT Eguilde SRL. All rights reserved."
  }
}
```

**Step 3: Write `src/i18n/index.ts`**

Typed loader for translations — loads the correct JSON by locale, with English fallback.

```typescript
import type ro from './ro.json';

export type Translations = typeof ro;

const cache: Partial<Record<string, Translations>> = {};

export async function getTranslations(lang: string): Promise<Translations> {
  if (cache[lang]) return cache[lang]!;
  try {
    const mod = await import(`./${lang}.json`);
    cache[lang] = mod.default as Translations;
    return cache[lang]!;
  } catch {
    // Fallback to English
    const mod = await import('./en.json');
    cache[lang] = mod.default as Translations;
    return cache[lang]!;
  }
}
```

**Step 4: Create stub files for 22 machine-translated languages**

These are minimal JSON stubs that inherit English content with a flag. Create one file per locale using the `en.json` as source, changing only `lang`, `langName`, and `isMachineTranslated: true`. The exact languages and their native names:

| Locale | langName |
|--------|----------|
| de | Deutsch |
| fr | Français |
| es | Español |
| it | Italiano |
| pl | Polski |
| pt | Português |
| hu | Magyar |
| cs | Čeština |
| sk | Slovenčina |
| bg | Български |
| hr | Hrvatski |
| lt | Lietuvių |
| lv | Latviešu |
| et | Eesti |
| mt | Malti |
| sl | Slovenščina |
| sv | Svenska |
| da | Dansk |
| nl | Nederlands |
| el | Ελληνικά |
| fi | Suomi |
| ga | Gaeilge |

For each, copy `en.json`, set `"lang": "<locale>"`, `"langName": "<native>"`, `"isMachineTranslated": true`. The actual text content for these 22 files will be machine-translated in Task 10.

**Step 5: Commit**

```bash
git add src/i18n/
git commit -m "feat(i18n): RO + EN hand-written translations, 22 MT stubs, typed loader"
```

---

## Task 5: Navbar Component (Mobile-First)

**Files:**
- Create: `src/components/Navbar.astro`
- Create: `src/components/ThemeToggle.astro`
- Create: `src/components/LanguageSelector.astro`

**Step 1: Write `src/components/ThemeToggle.astro`**

```astro
---
---
<button
  id="theme-toggle"
  aria-label="Toggle dark/light mode"
  class="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full
         bg-[var(--surface)] hover:bg-[var(--surface-high)] transition-colors
         border border-[var(--outline-var)]"
>
  <span class="theme-light text-xl">☀️</span>
  <span class="theme-dark  text-xl hidden">🌙</span>
</button>

<style>
  [data-theme="dark"] .theme-light { display: none; }
  [data-theme="dark"] .theme-dark  { display: inline; }
</style>

<script>
  const btn = document.getElementById('theme-toggle');
  btn?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('egu-theme', next);
  });
</script>
```

**Step 2: Write `src/components/LanguageSelector.astro`**

Flag emoji + native language name dropdown. 24 locales. Navigates to `/{locale}/` on change.

```astro
---
interface Props { currentLang: string; }
const { currentLang } = Astro.props;

const LANGS: [string, string, string][] = [
  ['ro','🇷🇴','Română'],   ['en','🇬🇧','English'],  ['de','🇩🇪','Deutsch'],
  ['fr','🇫🇷','Français'], ['es','🇪🇸','Español'],  ['it','🇮🇹','Italiano'],
  ['pl','🇵🇱','Polski'],   ['pt','🇵🇹','Português'],['hu','🇭🇺','Magyar'],
  ['cs','🇨🇿','Čeština'],  ['sk','🇸🇰','Slovenčina'],['bg','🇧🇬','Български'],
  ['hr','🇭🇷','Hrvatski'], ['lt','🇱🇹','Lietuvių'], ['lv','🇱🇻','Latviešu'],
  ['et','🇪🇪','Eesti'],    ['mt','🇲🇹','Malti'],    ['sl','🇸🇮','Slovenščina'],
  ['sv','🇸🇪','Svenska'],  ['da','🇩🇰','Dansk'],    ['nl','🇳🇱','Nederlands'],
  ['el','🇬🇷','Ελληνικά'], ['fi','🇫🇮','Suomi'],    ['ga','🇮🇪','Gaeilge'],
];

const current = LANGS.find(([l]) => l === currentLang);
---
<div class="relative" id="lang-selector">
  <button
    aria-haspopup="listbox"
    aria-expanded="false"
    id="lang-btn"
    class="flex items-center gap-2 min-h-[48px] px-3 rounded-lg
           bg-[var(--surface)] hover:bg-[var(--surface-high)] transition-colors
           border border-[var(--outline-var)] text-sm font-medium"
  >
    <span class="text-lg">{current?.[1]}</span>
    <span class="hidden sm:inline">{current?.[2]}</span>
    <span class="text-xs opacity-60">▾</span>
  </button>

  <ul
    id="lang-menu"
    role="listbox"
    aria-label="Select language"
    class="absolute right-0 top-full mt-2 z-50 hidden
           bg-[var(--surface)] border border-[var(--outline-var)] rounded-xl shadow-xl
           w-52 max-h-80 overflow-y-auto py-1"
  >
    {LANGS.map(([loc, flag, name]) => (
      <li role="option" aria-selected={loc === currentLang}>
        <a
          href={`/${loc}/`}
          class={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  hover:bg-[var(--surface-high)] min-h-[44px]
                  ${loc === currentLang ? 'font-semibold text-[var(--primary)]' : ''}`}
        >
          <span class="text-xl">{flag}</span>
          <span>{name}</span>
        </a>
      </li>
    ))}
  </ul>
</div>

<script>
  const btn = document.getElementById('lang-btn');
  const menu = document.getElementById('lang-menu');
  btn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu?.classList.toggle('hidden') === false;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => {
    menu?.classList.add('hidden');
    btn?.setAttribute('aria-expanded', 'false');
  });
</script>
```

**Step 3: Write `src/components/Navbar.astro`**

Sticky navbar with: logo, nav links (hidden on mobile, shown in hamburger menu), language selector, theme toggle, download CTA.

```astro
---
import ShieldLogo from './ShieldLogo.astro';
import ThemeToggle from './ThemeToggle.astro';
import LanguageSelector from './LanguageSelector.astro';
import type { Translations } from '../i18n/index';

interface Props { t: Translations; lang: string; }
const { t, lang } = Astro.props;

const navLinks = [
  { href: '#what',      label: t.nav.what },
  { href: '#privacy',   label: t.nav.privacy },
  { href: '#documents', label: t.nav.documents },
  { href: '#used-today',label: t.nav.usedToday },
  { href: '#future',    label: t.nav.future },
  { href: '#how',       label: t.nav.howItWorks },
  { href: '#faq',       label: t.nav.faq },
];
---
<header class="sticky top-0 z-50 bg-[var(--bg)]/95 backdrop-blur-sm
               border-b border-[var(--outline-var)] shadow-sm">
  <nav class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8
              flex items-center justify-between h-16 gap-4">

    <!-- Logo + Wordmark -->
    <a href={`/${lang}/`} class="flex items-center gap-3 flex-shrink-0 min-w-0">
      <ShieldLogo size={40} />
      <div class="hidden sm:flex flex-col leading-tight">
        <span class="font-bold text-lg tracking-tight text-[var(--primary)]">EguWallet</span>
        <span class="text-xs text-[var(--on-variant)]">powered by EguildE</span>
      </div>
    </a>

    <!-- Desktop nav links -->
    <ul class="hidden lg:flex items-center gap-1 flex-1 justify-center">
      {navLinks.map(({ href, label }) => (
        <li>
          <a href={href}
             class="px-3 py-2 rounded-lg text-sm font-medium text-[var(--fg)]
                    hover:bg-[var(--surface)] hover:text-[var(--primary)]
                    transition-colors whitespace-nowrap">
            {label}
          </a>
        </li>
      ))}
    </ul>

    <!-- Right cluster: lang + theme + download + hamburger -->
    <div class="flex items-center gap-2 flex-shrink-0">
      <LanguageSelector currentLang={lang} />
      <ThemeToggle />

      <!-- Download CTA button (desktop only) -->
      <a href="https://play.google.com/store/apps/details?id=com.eguwallet.wallet"
         target="_blank" rel="noopener noreferrer"
         class="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-lg
                bg-[var(--primary)] text-white font-semibold text-sm
                hover:opacity-90 transition-opacity min-h-[48px]">
        {t.nav.download}
      </a>

      <!-- Hamburger (mobile + tablet) -->
      <button id="hamburger" aria-label="Open menu" aria-expanded="false"
              class="lg:hidden min-h-[48px] min-w-[48px] flex items-center justify-center
                     rounded-lg bg-[var(--surface)] border border-[var(--outline-var)]">
        <svg class="ham-open w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
        <svg class="ham-close hidden w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </nav>

  <!-- Mobile menu -->
  <div id="mobile-menu" class="hidden lg:hidden border-t border-[var(--outline-var)]
                                bg-[var(--bg)] px-4 pb-4">
    <ul class="flex flex-col gap-1 pt-3">
      {navLinks.map(({ href, label }) => (
        <li>
          <a href={href} data-mobile-link
             class="flex items-center min-h-[48px] px-3 rounded-lg text-sm font-medium
                    hover:bg-[var(--surface)] transition-colors">
            {label}
          </a>
        </li>
      ))}
      <li class="pt-2">
        <a href="https://play.google.com/store/apps/details?id=com.eguwallet.wallet"
           target="_blank" rel="noopener noreferrer"
           class="flex items-center justify-center min-h-[48px] rounded-lg
                  bg-[var(--primary)] text-white font-semibold text-sm">
          {t.nav.download}
        </a>
      </li>
    </ul>
  </div>
</header>

<script>
  const ham = document.getElementById('hamburger');
  const menu = document.getElementById('mobile-menu');
  ham?.addEventListener('click', () => {
    const open = menu?.classList.toggle('hidden') === false;
    ham.setAttribute('aria-expanded', String(open));
    ham.querySelector('.ham-open')?.classList.toggle('hidden', open);
    ham.querySelector('.ham-close')?.classList.toggle('hidden', !open);
  });
  // Close on link click
  document.querySelectorAll('[data-mobile-link]').forEach(link => {
    link.addEventListener('click', () => {
      menu?.classList.add('hidden');
      ham?.setAttribute('aria-expanded','false');
    });
  });
</script>
```

**Step 4: Commit**

```bash
git add src/components/Navbar.astro src/components/ThemeToggle.astro src/components/LanguageSelector.astro
git commit -m "feat(nav): mobile-first sticky navbar with hamburger, lang selector, theme toggle"
```

---

## Task 6: Hero Section

**Files:**
- Create: `src/components/Hero.astro`
- Create: `public/assets/google-play-badge.svg`
- Create: `public/assets/app-store-badge.svg`

**Step 1: Download official badge SVGs into `public/assets/`**

Google Play badge: download from https://play.google.com/intl/en_us/badges/ (en_badge_web_generic.png). For the plan, use an inline SVG representation with the correct branding colours.

Create `public/assets/google-play-badge.svg` — standard Google Play badge (black background, white text, Play Store triangle). Create `public/assets/app-store-badge.svg` — standard Apple App Store badge (black background, white Apple logo).

**Step 2: Write `src/components/Hero.astro`**

Mobile: stacked (text top, phone SVG bottom). Desktop: side-by-side.

```astro
---
import ShieldLogo from './ShieldLogo.astro';
import EuFlag from './EuFlag.astro';
import type { Translations } from '../i18n/index';

interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="hero"
  class="relative overflow-hidden
         bg-gradient-to-br from-[#8B0010] via-[#C41E3A] to-[#D4213F]
         dark:[data-theme=dark]:from-[#1a0005] dark:[data-theme=dark]:via-[#3d0010] dark:[data-theme=dark]:to-[#5a0015]">

  <!-- EU Stars decorative background -->
  <div class="absolute inset-0 opacity-10 pointer-events-none select-none
              flex items-center justify-center text-[#FFCC00] text-8xl">
    ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★ ★
  </div>

  <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8
              py-16 sm:py-20 lg:py-28
              flex flex-col lg:flex-row items-center gap-10 lg:gap-16">

    <!-- Text column -->
    <div class="flex-1 text-center lg:text-left text-white">
      <!-- EU Digital Identity Wallet badge row -->
      <div class="flex flex-wrap items-center justify-center lg:justify-start gap-2 mb-6">
        <EuFlag size={28} />
        <span class="text-xs font-semibold tracking-wider uppercase opacity-90 bg-white/15 px-3 py-1 rounded-full">
          EU Digital Identity Wallet
        </span>
      </div>

      <h1 class="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight mb-6">
        {t.hero.title}
      </h1>

      <p class="text-base sm:text-lg lg:text-xl opacity-90 leading-relaxed mb-8 max-w-2xl mx-auto lg:mx-0">
        {t.hero.subtitle}
      </p>

      <!-- Trust badges -->
      <div class="flex flex-wrap justify-center lg:justify-start gap-2 mb-8">
        {[t.hero.badge1, t.hero.badge2, t.hero.badge3].map((badge) => (
          <span class="flex items-center gap-1.5 bg-white/20 border border-white/30
                       text-white text-xs font-semibold px-3 py-1.5 rounded-full">
            <span class="text-[#FFCC00]">✓</span> {badge}
          </span>
        ))}
      </div>

      <!-- Download badges -->
      <div class="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
        <!-- Google Play (active) -->
        <a href="https://play.google.com/store/apps/details?id=com.eguwallet.wallet"
           target="_blank" rel="noopener noreferrer"
           aria-label={t.hero.downloadAndroid}
           class="transition-transform hover:scale-105 active:scale-95">
          <img src="/assets/google-play-badge.svg"
               alt={t.hero.downloadAndroid}
               width="180" height="54"
               loading="eager" />
        </a>

        <!-- App Store (coming soon, greyed) -->
        <div class="relative opacity-60 cursor-not-allowed" title={t.hero.downloadIosComingSoon}>
          <img src="/assets/app-store-badge.svg"
               alt={t.hero.downloadIos}
               width="160" height="54"
               loading="eager"
               class="pointer-events-none" />
          <span class="absolute -top-2 -right-2 bg-[#FFCC00] text-black
                        text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
            {t.hero.downloadIosComingSoon}
          </span>
        </div>
      </div>
    </div>

    <!-- Phone mockup (CSS/SVG — no external image) -->
    <div class="flex-shrink-0 w-64 sm:w-72 lg:w-80">
      <div class="relative mx-auto w-56 sm:w-64
                  bg-[#141218] rounded-[2.5rem] shadow-2xl
                  border-4 border-white/20 overflow-hidden aspect-[9/19]">
        <!-- Phone notch -->
        <div class="absolute top-3 left-1/2 -translate-x-1/2 w-20 h-5
                    bg-black rounded-full z-10"></div>
        <!-- Screen content — wallet card preview -->
        <div class="h-full flex flex-col bg-gradient-to-b from-[#141218] to-[#211F22]
                    pt-12 px-4 pb-4 gap-3">
          <!-- Mini top bar -->
          <div class="flex items-center gap-2">
            <ShieldLogo size={24} />
            <span class="text-white text-xs font-bold">EguWallet</span>
          </div>
          <!-- PID Card mockup -->
          <div class="rounded-2xl bg-gradient-to-br from-[#003399] to-[#1976D2] p-3 shadow-lg">
            <div class="flex justify-between items-start mb-3">
              <div class="flex gap-1">
                {Array(5).fill(0).map(() => <span class="text-[#FFCC00] text-[8px]">★</span>)}
              </div>
              <span class="bg-white/20 text-white text-[7px] font-bold px-1.5 py-0.5 rounded">RO</span>
            </div>
            <div class="bg-white/10 rounded w-full h-px mb-2"></div>
            <div class="text-white text-[9px] opacity-70">EUROPEAN DIGITAL IDENTITY</div>
            <div class="text-white text-xs font-bold mt-1">POPESCU ION</div>
            <div class="flex justify-between mt-2">
              <span class="text-white/60 text-[8px]">PID · eIDAS 2.0</span>
              <span class="bg-green-500/80 text-white text-[7px] px-1.5 py-0.5 rounded font-bold">LoA HIGH</span>
            </div>
          </div>
          <!-- Second mini card -->
          <div class="rounded-xl bg-[var(--surface)]/20 p-2.5 flex items-center gap-2">
            <span class="text-lg">🚗</span>
            <div>
              <div class="text-white/80 text-[9px] font-semibold">Permis de conducere</div>
              <div class="text-white/50 text-[8px]">B · Valabil</div>
            </div>
          </div>
        </div>
        <!-- Home bar -->
        <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-1
                    bg-white/40 rounded-full"></div>
      </div>
    </div>

  </div>
</section>
```

**Step 3: Commit**

```bash
git add src/components/Hero.astro public/assets/
git commit -m "feat(hero): mobile-first hero with phone mockup, EU badge, download CTAs"
```

---

## Task 7: Content Sections (What, Privacy, Documents, Used Today)

**Files:**
- Create: `src/components/WhatIsSection.astro`
- Create: `src/components/PrivacySection.astro`
- Create: `src/components/DocumentsSection.astro`
- Create: `src/components/UsedTodaySection.astro`

**Step 1: Write `src/components/WhatIsSection.astro`**

3 cards explaining eIDAS 2.0 law, EUDI concept, and provider.

```astro
---
import EuFlag from './EuFlag.astro';
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="what" class="py-16 sm:py-20 bg-[var(--bg)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.what.heading}
      </h2>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
      <!-- Card 1: EU Law -->
      <div class="rounded-2xl bg-[var(--surface)] border border-[var(--outline-var)]
                  p-6 lg:p-8 flex flex-col gap-4 hover:shadow-lg transition-shadow">
        <div class="w-12 h-12 rounded-xl bg-[#003399]/10 flex items-center justify-center">
          <EuFlag size={28} />
        </div>
        <h3 class="text-lg font-semibold text-[var(--fg)]">{t.what.card1Title}</h3>
        <p class="text-[var(--on-variant)] leading-relaxed text-sm sm:text-base">{t.what.card1Body}</p>
      </div>
      <!-- Card 2: EUDI concept -->
      <div class="rounded-2xl bg-[var(--surface)] border border-[var(--outline-var)]
                  p-6 lg:p-8 flex flex-col gap-4 hover:shadow-lg transition-shadow">
        <div class="w-12 h-12 rounded-xl bg-[#C41E3A]/10 flex items-center justify-center
                    text-2xl">🪪</div>
        <h3 class="text-lg font-semibold text-[var(--fg)]">{t.what.card2Title}</h3>
        <p class="text-[var(--on-variant)] leading-relaxed text-sm sm:text-base">{t.what.card2Body}</p>
      </div>
      <!-- Card 3: Provider -->
      <div class="rounded-2xl bg-[var(--surface)] border border-[var(--outline-var)]
                  p-6 lg:p-8 flex flex-col gap-4 hover:shadow-lg transition-shadow">
        <div class="w-12 h-12 rounded-xl bg-[#B8860B]/10 flex items-center justify-center
                    text-2xl">🏛️</div>
        <h3 class="text-lg font-semibold text-[var(--fg)]">{t.what.card3Title}</h3>
        <p class="text-[var(--on-variant)] leading-relaxed text-sm sm:text-base">{t.what.card3Body}</p>
      </div>
    </div>
  </div>
</section>
```

**Step 2: Write `src/components/PrivacySection.astro`**

Visual selective disclosure diagram + GDPR legal basis cards.

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="privacy" class="py-16 sm:py-20 bg-[var(--surface-low)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.privacy.heading}
      </h2>
      <p class="text-lg text-[var(--on-variant)] max-w-2xl mx-auto">{t.privacy.subheading}</p>
    </div>

    <!-- Selective disclosure visual diagram -->
    <div class="max-w-3xl mx-auto mb-12">
      <div class="rounded-2xl bg-[var(--bg)] border-2 border-[var(--primary)]/20 p-6 sm:p-8">
        <h3 class="text-base font-semibold text-[var(--fg)] mb-6 text-center">
          {t.privacy.example1Title}
        </h3>
        <div class="flex flex-col sm:flex-row items-stretch gap-4">
          <!-- Step column -->
          <div class="flex-1 flex flex-col gap-3">
            {[
              { step: t.privacy.example1Step1, icon: '📱', color: 'bg-blue-500/10 border-blue-500/20' },
              { step: t.privacy.example1Step2, icon: '🔐', color: 'bg-[var(--primary)]/10 border-[var(--primary)]/20' },
              { step: t.privacy.example1Step3, icon: '✅', color: 'bg-green-500/10 border-green-500/20 font-medium' },
              { step: t.privacy.example1Step4, icon: '🚫', color: 'bg-red-500/10 border-red-500/20' },
            ].map(({ step, icon, color }) => (
              <div class={`flex items-start gap-3 rounded-xl border p-3 text-sm ${color}`}>
                <span class="text-xl flex-shrink-0">{icon}</span>
                <span class="text-[var(--fg)]">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    <!-- Body text -->
    <div class="max-w-3xl mx-auto mb-10">
      <p class="text-[var(--on-variant)] leading-relaxed text-base sm:text-lg text-center">
        {t.privacy.body}
      </p>
    </div>

    <!-- Legal basis cards -->
    <div class="max-w-3xl mx-auto">
      <h3 class="text-base font-semibold text-[var(--fg)] mb-4">{t.privacy.legalTitle}</h3>
      <div class="flex flex-col gap-3">
        {[t.privacy.legal1, t.privacy.legal2, t.privacy.legal3].map((text) => (
          <div class="flex items-start gap-3 rounded-xl bg-[var(--bg)]
                      border border-[var(--outline-var)] p-4 text-sm text-[var(--on-variant)]">
            <span class="text-[#003399] font-bold text-base flex-shrink-0">§</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
</section>
```

**Step 3: Write `src/components/DocumentsSection.astro`**

Responsive grid: 1 col mobile, 2 col tablet, 4 col desktop. Available/Soon badges.

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="documents" class="py-16 sm:py-20 bg-[var(--bg)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.documents.heading}
      </h2>
      <p class="text-[var(--on-variant)] max-w-2xl mx-auto">{t.documents.subheading}</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
      {t.documents.items.map((item) => (
        <div class={`rounded-2xl border p-5 flex flex-col gap-3 transition-all hover:shadow-md
          ${item.status === 'available'
            ? 'bg-[var(--surface)] border-[var(--outline-var)]'
            : 'bg-[var(--surface-low)] border-[var(--outline-var)] opacity-75'}`}
        >
          <div class="flex items-center justify-between">
            <span class="text-3xl">{item.icon}</span>
            <span class={`text-xs font-semibold px-2.5 py-1 rounded-full
              ${item.status === 'available'
                ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                : 'bg-[#FFCC00]/20 text-[#B8860B]'}`}>
              {item.status === 'available' ? t.documents.statusAvailable : t.documents.statusSoon}
            </span>
          </div>
          <h3 class="font-semibold text-[var(--fg)] text-sm sm:text-base leading-snug">{item.title}</h3>
          <p class="text-[var(--on-variant)] text-xs sm:text-sm leading-relaxed flex-1">{item.body}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 4: Write `src/components/UsedTodaySection.astro`**

Two production app cards with logos and "Sign in with EguWallet" badge.

```astro
---
import ShieldLogo from './ShieldLogo.astro';
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="used-today" class="py-16 sm:py-20 bg-[var(--surface-low)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.usedToday.heading}
      </h2>
      <p class="text-[var(--on-variant)] max-w-2xl mx-auto">{t.usedToday.subheading}</p>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 max-w-4xl mx-auto">
      {[
        { name: t.usedToday.app1Name, url: t.usedToday.app1Url, body: t.usedToday.app1Body, flag: '🏛️' },
        { name: t.usedToday.app2Name, url: t.usedToday.app2Url, body: t.usedToday.app2Body, flag: '🏢' },
      ].map(({ name, url, body, flag }) => (
        <div class="rounded-2xl bg-[var(--bg)] border border-[var(--outline-var)]
                    p-6 lg:p-8 flex flex-col gap-5 hover:shadow-lg transition-shadow">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 rounded-2xl bg-[#003399]/10 flex items-center
                        justify-center text-3xl flex-shrink-0">{flag}</div>
            <div>
              <h3 class="font-bold text-[var(--fg)] text-base">{name}</h3>
              <a href={url} target="_blank" rel="noopener noreferrer"
                 class="text-[var(--secondary)] text-sm hover:underline">{url}</a>
            </div>
          </div>
          <p class="text-[var(--on-variant)] text-sm leading-relaxed">{body}</p>
          <!-- Sign in with EguWallet badge -->
          <div class="inline-flex items-center gap-2 bg-[var(--primary)] text-white
                      rounded-xl px-4 py-2.5 text-sm font-semibold self-start">
            <ShieldLogo size={20} showBg={false} />
            {t.usedToday.badgeText}
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 5: Commit**

```bash
git add src/components/WhatIsSection.astro src/components/PrivacySection.astro \
        src/components/DocumentsSection.astro src/components/UsedTodaySection.astro
git commit -m "feat(sections): What/Privacy/Documents/UsedToday sections"
```

---

## Task 8: Future, How It Works, FAQ, Footer Sections

**Files:**
- Create: `src/components/FutureSection.astro`
- Create: `src/components/HowItWorksSection.astro`
- Create: `src/components/FaqSection.astro`
- Create: `src/components/Footer.astro`

**Step 1: Write `src/components/FutureSection.astro`**

6 future use-case cards (BT, law enforcement, 18+ age, bus tickets, address fix, qualified signature).

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="future" class="py-16 sm:py-20 bg-[var(--bg)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.future.heading}
      </h2>
      <p class="text-[var(--on-variant)] max-w-2xl mx-auto">{t.future.subheading}</p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
      {t.future.items.map((item) => (
        <div class="rounded-2xl bg-[var(--surface)] border border-[var(--outline-var)]
                    p-6 flex flex-col gap-4 hover:shadow-md hover:-translate-y-0.5
                    transition-all duration-200">
          <div class="w-12 h-12 rounded-xl bg-[var(--primary)]/10 flex items-center
                      justify-center text-2xl flex-shrink-0">
            {item.icon}
          </div>
          <h3 class="font-semibold text-[var(--fg)] text-base leading-snug">{item.title}</h3>
          <p class="text-[var(--on-variant)] text-sm leading-relaxed">{item.body}</p>
          <div class="flex items-center gap-1.5 mt-auto">
            <span class="w-2 h-2 rounded-full bg-[#FFCC00] flex-shrink-0"></span>
            <span class="text-xs text-[var(--on-variant)] font-medium">Coming Soon</span>
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 2: Write `src/components/HowItWorksSection.astro`**

3-step horizontal/vertical process with numbered circles.

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="how" class="py-16 sm:py-20 bg-[var(--surface-low)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)]">
        {t.howItWorks.heading}
      </h2>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
      {[
        { title: t.howItWorks.step1Title, body: t.howItWorks.step1Body, icon: '📲', num: '1' },
        { title: t.howItWorks.step2Title, body: t.howItWorks.step2Body, icon: '🔐', num: '2' },
        { title: t.howItWorks.step3Title, body: t.howItWorks.step3Body, icon: '✅', num: '3' },
      ].map(({ title, body, icon, num }) => (
        <div class="flex flex-col items-center text-center gap-4">
          <div class="relative">
            <div class="w-16 h-16 rounded-full bg-[var(--primary)] flex items-center
                        justify-center text-2xl shadow-lg">
              {icon}
            </div>
            <span class="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-[#FFCC00]
                         text-black text-xs font-bold flex items-center justify-center">
              {num}
            </span>
          </div>
          <h3 class="font-bold text-[var(--fg)] text-base">{title}</h3>
          <p class="text-[var(--on-variant)] text-sm leading-relaxed">{body}</p>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 3: Write `src/components/FaqSection.astro`**

Accordion FAQ. Each item expands on click. Also outputs JSON-LD FAQPage data (consumed by Base.astro via props).

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="faq" class="py-16 sm:py-20 bg-[var(--bg)]">
  <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)]">
        {t.faq.heading}
      </h2>
    </div>
    <div class="flex flex-col gap-3" id="faq-list">
      {t.faq.items.map((item, i) => (
        <div class="rounded-2xl border border-[var(--outline-var)] bg-[var(--surface)] overflow-hidden">
          <button
            class="w-full flex items-center justify-between gap-4
                   px-5 py-4 text-left font-semibold text-[var(--fg)]
                   text-sm sm:text-base min-h-[56px] hover:bg-[var(--surface-high)]
                   transition-colors"
            aria-expanded="false"
            data-faq-btn
          >
            <span>{item.q}</span>
            <span class="faq-chevron text-[var(--on-variant)] flex-shrink-0 transition-transform">▾</span>
          </button>
          <div class="faq-body hidden px-5 pb-5 text-[var(--on-variant)] text-sm leading-relaxed">
            {item.a}
          </div>
        </div>
      ))}
    </div>
  </div>
</section>

<script>
  document.querySelectorAll('[data-faq-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      const body = btn.nextElementSibling as HTMLElement;
      body?.classList.toggle('hidden', expanded);
      btn.querySelector('.faq-chevron')?.classList.toggle('rotate-180', !expanded);
    });
  });
</script>
```

**Step 4: Write `src/components/Footer.astro`**

Footer with eIDAS compliance badge, legal links, IT Eguilde SRL branding.

```astro
---
import ShieldLogo from './ShieldLogo.astro';
import EuFlag from './EuFlag.astro';
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<footer class="bg-[#141218] text-white/80">
  <!-- Machine-translated disclaimer (shown only for MT languages) -->
  {t.isMachineTranslated && (
    <div class="bg-[#FFCC00]/15 border-b border-[#FFCC00]/20 px-4 py-3 text-center text-xs text-[#FFCC00]">
      ⚠️ {t.footer.machineTranslatedNotice}
    </div>
  )}

  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
      <!-- Brand -->
      <div class="sm:col-span-2 lg:col-span-2">
        <div class="flex items-center gap-3 mb-4">
          <ShieldLogo size={48} />
          <div>
            <div class="font-bold text-white text-xl">EguWallet</div>
            <div class="text-white/50 text-xs">{t.footer.tagline}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 mt-4">
          <EuFlag size={24} />
          <span class="text-xs bg-white/10 px-2 py-1 rounded-full font-medium">
            {t.footer.euCompliance}
          </span>
        </div>
        <p class="text-white/50 text-xs mt-4">{t.footer.provider}</p>
      </div>

      <!-- Links -->
      <div>
        <nav class="flex flex-col gap-3">
          <a href="#" class="text-sm hover:text-white transition-colors">{t.footer.privacy}</a>
          <a href="#" class="text-sm hover:text-white transition-colors">{t.footer.legal}</a>
          <a href="mailto:contact@eguilde.ro" class="text-sm hover:text-white transition-colors">{t.footer.contact}</a>
        </nav>
      </div>

      <!-- Download -->
      <div class="flex flex-col gap-3">
        <a href="https://play.google.com/store/apps/details?id=com.eguwallet.wallet"
           target="_blank" rel="noopener noreferrer"
           class="flex items-center gap-2 bg-white/10 hover:bg-white/20
                  transition-colors rounded-xl px-4 py-3 text-sm font-medium min-h-[48px]">
          ▶ Google Play
        </a>
        <div class="flex items-center gap-2 bg-white/5 rounded-xl px-4 py-3
                    text-sm text-white/40 cursor-not-allowed min-h-[48px]">
           Apple Store <span class="ml-auto text-[#FFCC00] text-xs">{t.hero.downloadIosComingSoon}</span>
        </div>
      </div>
    </div>

    <div class="border-t border-white/10 pt-6 text-center text-xs text-white/40">
      {t.footer.rights}
    </div>
  </div>
</footer>
```

**Step 5: Commit**

```bash
git add src/components/FutureSection.astro src/components/HowItWorksSection.astro \
        src/components/FaqSection.astro src/components/Footer.astro
git commit -m "feat(sections): Future/HowItWorks/FAQ/Footer sections"
```

---

## Task 9: Main Page Route

**Files:**
- Create: `src/pages/index.astro` (redirects to `/ro/`)
- Create: `src/pages/[lang]/index.astro` (the actual page — rendered for all 24 locales)

**Step 1: Write `src/pages/index.astro`**

Browser-language-aware redirect. Tries to match `navigator.language` to supported locales, falls back to `/ro/`.

```astro
---
// Server-side: redirect to /ro/ (nginx also handles this)
return Astro.redirect('/ro/', 302);
---
```

Actually, for static output use meta refresh + JS redirect:

```astro
<!doctype html>
<html>
<head>
  <meta http-equiv="refresh" content="0; url=/ro/" />
  <script>
    const lang = navigator.language?.slice(0,2).toLowerCase();
    const supported = ['ro','en','de','fr','es','it','pl','pt','hu','cs','sk','bg','hr','lt','lv','et','mt','sl','sv','da','nl','el','fi','ga'];
    const target = supported.includes(lang) ? lang : 'ro';
    window.location.replace('/' + target + '/');
  </script>
</head>
<body><a href="/ro/">EguWallet</a></body>
</html>
```

**Step 2: Write `src/pages/[lang]/index.astro`**

The main page. Imports all section components, loads translations, passes to Base layout.

```astro
---
import Base from '../../layouts/Base.astro';
import Navbar from '../../components/Navbar.astro';
import Hero from '../../components/Hero.astro';
import WhatIsSection from '../../components/WhatIsSection.astro';
import PrivacySection from '../../components/PrivacySection.astro';
import DocumentsSection from '../../components/DocumentsSection.astro';
import UsedTodaySection from '../../components/UsedTodaySection.astro';
import FutureSection from '../../components/FutureSection.astro';
import HowItWorksSection from '../../components/HowItWorksSection.astro';
import FaqSection from '../../components/FaqSection.astro';
import Footer from '../../components/Footer.astro';
import { getTranslations } from '../../i18n/index';

export async function getStaticPaths() {
  const locales = ['ro','en','de','fr','es','it','pl','pt','hu','cs','sk','bg',
                   'hr','lt','lv','et','mt','sl','sv','da','nl','el','fi','ga'];
  return locales.map(lang => ({ params: { lang } }));
}

const { lang } = Astro.params;
const t = await getTranslations(lang);

const title = lang === 'ro'
  ? 'EguWallet — Portofelul tău digital eIDAS 2.0 | Identitate Digitală Europeană'
  : 'EguWallet — Your eIDAS 2.0 Digital Wallet | European Digital Identity';

const description = lang === 'ro'
  ? 'EguWallet este portofelul digital european certificat eIDAS 2.0. Stochează buletinul, pașaportul, permisul auto și alte documente digitale. Gratuit, sigur, recunoscut în toată UE.'
  : 'EguWallet is a certified eIDAS 2.0 European Digital Identity Wallet. Store your ID, passport, driving licence and more. Free, secure, recognised across the EU.';
---
<Base lang={lang} title={title} description={description} faqItems={t.faq.items}>
  <Navbar t={t} lang={lang} />
  <main>
    <Hero t={t} />
    <WhatIsSection t={t} />
    <PrivacySection t={t} />
    <DocumentsSection t={t} />
    <UsedTodaySection t={t} />
    <FutureSection t={t} />
    <HowItWorksSection t={t} />
    <FaqSection t={t} />
  </main>
  <Footer t={t} />
</Base>
```

**Step 3: Run dev server and verify**

```bash
npm run dev
```

Open http://localhost:4200/ro/ — should render full page in Romanian.
Open http://localhost:4200/en/ — should render full page in English.
Open http://localhost:4200/de/ — should render with English fallback content + MT disclaimer banner.

**Step 4: Run production build**

```bash
npm run build
```

Expected: `dist/` directory with 24 subdirectories (ro/, en/, de/, …), each containing `index.html`.

Verify file count:
```bash
ls dist/*/index.html | wc -l
# Expected: 24
```

**Step 5: Commit**

```bash
git add src/pages/
git commit -m "feat(pages): static page routes for all 24 EU locales"
```

---

## Task 10: Machine-Translate 22 Languages

**Files:**
- Modify: `src/i18n/[de|fr|es|it|pl|pt|hu|cs|sk|bg|hr|lt|lv|et|mt|sl|sv|da|nl|el|fi|ga].json`

**Step 1: Use Claude (via claude.ai) or DeepL API to translate `en.json`**

For each of the 22 languages, translate all string values from `en.json`. Key names must remain identical. Set `"isMachineTranslated": true` in each file.

**Recommended approach:** Use DeepL Free API (500,000 chars/month free tier):

```bash
# Install DeepL CLI or use their API
# Translate the entire en.json for each language
# Verify that JSON structure is intact after translation
```

Alternatively, use Claude API to translate in batches of 5 languages at a time.

**Step 2: Validate JSON structure**

```bash
for f in src/i18n/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f OK" || echo "$f FAILED"
done
```

Expected: all 24 files print "OK".

**Step 3: Rebuild and spot-check**

```bash
npm run build
# Open dist/de/index.html — verify German content renders
# Open dist/fr/index.html — verify French content renders
```

**Step 4: Commit**

```bash
git add src/i18n/
git commit -m "feat(i18n): machine-translated content for 22 EU languages"
```

---

## Task 11: OG Images (Per Language)

**Files:**
- Create: `src/pages/og/[lang].png.ts` (generates 24 OG images at build time)

**Step 1: Write the OG image generator**

Uses `astro-og-canvas` to render a branded 1200×630 image for each language.

```typescript
// src/pages/og/[lang].png.ts
import { OGImageRoute } from 'astro-og-canvas';

const pages: Record<string, { title: string; description: string }> = {
  ro: { title: 'EguWallet — Portofelul tău digital eIDAS 2.0', description: 'Identitate digitală europeană · Certificat eIDAS 2.0 · Gratuit' },
  en: { title: 'EguWallet — Your eIDAS 2.0 Digital Wallet', description: 'European Digital Identity · eIDAS 2.0 Certified · Free' },
  de: { title: 'EguWallet — Ihr eIDAS 2.0 Digital Wallet', description: 'Europäische Digitale Identität · eIDAS 2.0 zertifiziert · Kostenlos' },
  fr: { title: 'EguWallet — Votre portefeuille numérique eIDAS 2.0', description: 'Identité numérique européenne · Certifié eIDAS 2.0 · Gratuit' },
  // … add all 24 languages …
};

export const { getStaticPaths, GET } = OGImageRoute({
  pages,
  param: 'lang',
  getImageOptions: (_, page) => ({
    title: (page as any).title,
    description: (page as any).description,
    logo: { path: './public/assets/logo-shield.svg' },
    bgGradient: [[196, 30, 58], [139, 0, 16]],
    font: { title: { color: [255, 255, 255], weight: 'Bold' } },
    border: { color: [255, 204, 0], width: 8, side: 'inline-start' },
  }),
});
```

**Step 2: Build and verify**

```bash
npm run build
ls dist/og/*.png | wc -l
# Expected: 24
```

**Step 3: Commit**

```bash
git add src/pages/og/
git commit -m "feat(og): per-language Open Graph images via astro-og-canvas"
```

---

## Task 12: nginx Configuration on egucluster1

**Files:**
- Create: `/etc/nginx/sites-enabled/eguwallet.eu.conf` (on egucluster1 via SSH)

**Step 1: SSH to egucluster1**

```bash
ssh eguilde@egucluster1.eguilde.cloud
```

**Step 2: Write nginx vhost**

```bash
sudo tee /etc/nginx/sites-enabled/eguwallet.eu.conf << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name eguwallet.eu www.eguwallet.eu;
    return 301 https://eguwallet.eu$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name eguwallet.eu www.eguwallet.eu;

    ssl_certificate     /etc/letsencrypt/live/eguwallet.eu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eguwallet.eu/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options    "nosniff" always;
    add_header X-Frame-Options           "SAMEORIGIN" always;
    add_header Referrer-Policy           "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy        "geolocation=(), microphone=(), camera=()" always;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/json
               application/javascript image/svg+xml;
    gzip_min_length 1000;

    root /var/www/eguwallet.eu;
    index index.html;

    # Root → redirect to /ro/ with browser-language detection via JS (index.html handles it)
    location = / {
        try_files /index.html =404;
    }

    # Static assets: 1 year immutable cache
    location ~* \.(js|css|svg|png|jpg|webp|woff2|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # HTML: no cache (always fresh)
    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # All other requests
    location / {
        try_files $uri $uri/ $uri.html =404;
    }

    # Deny dotfiles
    location ~ /\. { deny all; }
}
EOF
```

**Step 3: Create webroot and test config**

```bash
sudo mkdir -p /var/www/eguwallet.eu
sudo nginx -t
```

Expected output: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

**Step 4: Reload nginx**

```bash
sudo systemctl reload nginx
```

**Step 5: Exit SSH (no commit needed — server config)**

---

## Task 13: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Write the workflow**

```yaml
# .github/workflows/deploy.yml
name: Build and Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to egucluster1
        uses: appleboy/scp-action@master
        with:
          host: egucluster1.eguilde.cloud
          username: eguilde
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          source: "dist/"
          target: "/var/www/eguwallet.eu"
          strip_components: 1

      - name: Reload nginx
        uses: appleboy/ssh-action@master
        with:
          host: egucluster1.eguilde.cloud
          username: eguilde
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: sudo systemctl reload nginx
```

**Step 2: Add GitHub Actions secret**

In the GitHub repo settings (`github.com/eguilde/eguwallet-web/settings/secrets`), add:
- `DEPLOY_SSH_KEY` — the private SSH key for `eguilde@egucluster1.eguilde.cloud`

**Step 3: Grant eguilde sudo for nginx reload without password**

On egucluster1:
```bash
echo "eguilde ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx" | sudo tee /etc/sudoers.d/eguilde-nginx
```

**Step 4: Commit and trigger first deploy**

```bash
git add .github/
git commit -m "ci: GitHub Actions build + deploy to egucluster1 on push to main"
git push origin main
```

Expected: GitHub Actions builds successfully, `dist/` rsyncs to egucluster1, nginx reloads.

**Step 5: Verify live site**

```bash
curl -I https://eguwallet.eu/ro/
# Expected: HTTP/2 200
curl https://eguwallet.eu/sitemap-index.xml | head -5
# Expected: <?xml version="1.0" ...
```

---

## Task 14: Final SEO Verification

**Step 1: Test hreflang**

```bash
curl -s https://eguwallet.eu/ro/ | grep hreflang | wc -l
# Expected: 25 (24 languages + x-default)
```

**Step 2: Test JSON-LD**

```bash
curl -s https://eguwallet.eu/ro/ | python3 -c "
import sys, re, json
html = sys.stdin.read()
scripts = re.findall(r'<script type=\"application/ld\+json\">(.*?)</script>', html, re.DOTALL)
print(f'Found {len(scripts)} JSON-LD blocks')
for s in scripts:
    d = json.loads(s)
    print(f'  @type: {d[\"@type\"]}')
"
# Expected: 4 JSON-LD blocks (SoftwareApplication, Organization, WebSite, FAQPage)
```

**Step 3: Validate with Google Rich Results Test**

Go to https://search.google.com/test/rich-results — enter `https://eguwallet.eu/ro/`

Expected: FAQPage and SoftwareApplication rich result previews shown.

**Step 4: Test Core Web Vitals with Lighthouse**

```bash
npx lighthouse https://eguwallet.eu/ro/ --output json --output-path lighthouse.json
node -e "const r=require('./lighthouse.json').categories; console.log('Performance:',r.performance.score*100, 'SEO:',r.seo.score*100, 'A11y:',r.accessibility.score*100)"
```

Target scores: Performance ≥ 90, SEO = 100, Accessibility ≥ 90.

**Step 5: Submit sitemap to Google Search Console**

1. Add property `https://eguwallet.eu` in Google Search Console
2. Submit `https://eguwallet.eu/sitemap-index.xml`

**Step 6: Commit final state**

```bash
git add .
git commit -m "feat: eguwallet.eu landing site — production ready, all 24 EU languages, full SEO"
git push origin main
```

---

## Task 15: Romania & eIDAS 2.0 Standards Section

**Files:**
- Create: `src/components/StandardsSection.astro`
- Modify: `src/i18n/ro.json` and `src/i18n/en.json` — add `"standards"` key
- Modify: `src/pages/[lang]/index.astro` — add `<StandardsSection>` between UsedToday and Future

**Step 1: Add `"standards"` key to `ro.json` and `en.json`**

Add to `ro.json`:
```json
"standards": {
  "heading": "O infrastructură completă acolo unde România nu are încă nimic",
  "subheading": "EguWallet nu este doar o aplicație — este un ecosistem complet de identitate digitală, construit pe toate standardele europene obligatorii ale eIDAS 2.0, funcțional astăzi.",
  "romaniaContext": "România nu dispune în prezent de un nod național EUDI sau de un organism de certificare pentru portofele digitale. IT Eguilde SRL a construit infrastructura completă necesară, anticipând momentul în care statul român va implementa aceste sisteme. Când nodul național va fi disponibil, EguWallet va migra automat — fiecare standard folosit este deja conform cu cerințele viitoare ale statului.",
  "switchNote": "Standardele utilizate de EguWallet sunt complet interoperabile cu viitoarea infrastructură națională. Tranziția va fi transparentă pentru utilizatori.",
  "nodeTitle": "Nod de țară complet implementat",
  "nodeBody": "EguWallet operează un nod de țară eIDAS 2.0 propriu, incluzând: furnizor de portofel (Wallet Provider), organism de certificare (QTSP), registru de încredere (LoTL) și serviciu de verificare (Verifier) — toate componentele arhitecturii de referință EUDI (ARF 2.5+).",
  "standardsTitle": "Toate standardele eIDAS 2.0 implementate",
  "items": [
    { "code": "eIDAS 2.0", "name": "Regulamentul (UE) 2024/1183", "desc": "Baza juridică a portofelelor digitale europene. Dreptul fiecărui cetățean la un EUDI Wallet gratuit." },
    { "code": "ARF 2.5+", "name": "Architecture Reference Framework", "desc": "Specificațiile tehnice EUDI publicate de Comisia Europeană. EguWallet implementează toate cerințele obligatorii." },
    { "code": "OpenID4VCI", "name": "OpenID for Verifiable Credential Issuance", "desc": "Protocolul standard pentru emiterea documentelor digitale verificabile în portofel." },
    { "code": "OpenID4VP", "name": "OpenID for Verifiable Presentations", "desc": "Protocolul standard pentru prezentarea documentelor digitale la un serviciu sau comerciant." },
    { "code": "SD-JWT", "name": "Selective Disclosure JWT (IETF RFC 7519 ext.)", "desc": "Tehnologia care permite dezvăluirea selectivă — transmiți doar câmpurile pe care le aprobi explicit." },
    { "code": "ISO 18013-5", "name": "mDoc / Mobile Driving Licence", "desc": "Standardul ISO pentru permise auto digitale și documente de identitate mobile (mDL)." },
    { "code": "W3C VC", "name": "Verifiable Credentials Data Model 2.0", "desc": "Modelul de date W3C pentru credențiale digitale verificabile, interoperabil la nivel global." },
    { "code": "EUDI Trust", "name": "European Digital Identity Trust Framework", "desc": "Cadrul de încredere european: lista de încredere (LOTL), certificate calificate, atestare portofel." },
    { "code": "RFC 9101", "name": "JWT-Secured Authorization Requests (JAR)", "desc": "Securizarea cererilor de autorizare cu JWT semnat — prevenire manipulare cereri." },
    { "code": "RFC 9449", "name": "DPoP — Demonstrating Proof of Possession", "desc": "Legarea token-urilor OAuth 2.0 de dispozitivul utilizatorului — prevenire furt token." },
    { "code": "FIDO2 / WebAuthn", "name": "W3C Web Authentication", "desc": "Autentificare biometrică (amprenta, Face ID) pentru deblocarea portofelului — fără parole." },
    { "code": "ISO/IEC 18045", "name": "Common Criteria Evaluation", "desc": "Metodologia de evaluare a securității. EguWallet urmărește certificare EAL conform cerințelor ARF." }
  ]
}
```

Add equivalent to `en.json` with English text (same structure, translated values).

**Step 2: Write `src/components/StandardsSection.astro`**

Two sub-sections: (1) Romania context card + node description, (2) standards grid.

```astro
---
import type { Translations } from '../i18n/index';
interface Props { t: Translations; }
const { t } = Astro.props;
---
<section id="standards" class="py-16 sm:py-20 bg-[var(--surface-low)]">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

    <!-- Section header -->
    <div class="text-center mb-12">
      <h2 class="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--fg)] mb-4">
        {t.standards.heading}
      </h2>
      <p class="text-[var(--on-variant)] max-w-3xl mx-auto text-base sm:text-lg leading-relaxed">
        {t.standards.subheading}
      </p>
    </div>

    <!-- Romania context + node card -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
      <!-- Romania context -->
      <div class="rounded-2xl bg-[#003399]/10 border border-[#003399]/20 p-6 lg:p-8">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-3xl">🇷🇴</span>
          <h3 class="font-bold text-[var(--fg)] text-base sm:text-lg">România & eIDAS 2.0</h3>
        </div>
        <p class="text-[var(--on-variant)] text-sm sm:text-base leading-relaxed mb-4">
          {t.standards.romaniaContext}
        </p>
        <div class="flex items-start gap-2 bg-[#FFCC00]/10 border border-[#FFCC00]/30 rounded-xl p-3">
          <span class="text-[#FFCC00] text-lg flex-shrink-0">⚡</span>
          <p class="text-[var(--on-variant)] text-xs sm:text-sm leading-relaxed">
            {t.standards.switchNote}
          </p>
        </div>
      </div>

      <!-- Complete node card -->
      <div class="rounded-2xl bg-[var(--primary)]/10 border border-[var(--primary)]/20 p-6 lg:p-8">
        <div class="flex items-center gap-3 mb-4">
          <span class="text-3xl">🏛️</span>
          <h3 class="font-bold text-[var(--fg)] text-base sm:text-lg">{t.standards.nodeTitle}</h3>
        </div>
        <p class="text-[var(--on-variant)] text-sm sm:text-base leading-relaxed">
          {t.standards.nodeBody}
        </p>
        <!-- Component badges -->
        <div class="flex flex-wrap gap-2 mt-4">
          {['Wallet Provider','QTSP','LoTL Registry','Verifier','PID Issuer'].map(c => (
            <span class="bg-[var(--primary)]/15 text-[var(--primary)] text-xs font-semibold
                          px-2.5 py-1 rounded-full border border-[var(--primary)]/20">{c}</span>
          ))}
        </div>
      </div>
    </div>

    <!-- Standards grid -->
    <h3 class="text-lg sm:text-xl font-bold text-[var(--fg)] mb-6 text-center">
      {t.standards.standardsTitle}
    </h3>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {t.standards.items.map((item) => (
        <div class="rounded-xl bg-[var(--bg)] border border-[var(--outline-var)]
                    p-4 flex gap-3 hover:shadow-sm transition-shadow">
          <span class="text-xs font-bold text-[var(--primary)] bg-[var(--primary)]/10
                        px-2 py-1 rounded-lg flex-shrink-0 h-fit whitespace-nowrap">
            {item.code}
          </span>
          <div class="min-w-0">
            <div class="font-semibold text-[var(--fg)] text-xs sm:text-sm leading-snug mb-1">
              {item.name}
            </div>
            <div class="text-[var(--on-variant)] text-xs leading-relaxed">{item.desc}</div>
          </div>
        </div>
      ))}
    </div>
  </div>
</section>
```

**Step 3: Add `<StandardsSection>` to `src/pages/[lang]/index.astro`**

After `<UsedTodaySection>` and before `<FutureSection>`:
```astro
<StandardsSection t={t} />
```

**Step 4: Commit**

```bash
git add src/components/StandardsSection.astro src/pages/ src/i18n/ro.json src/i18n/en.json
git commit -m "feat(standards): Romania context + complete eIDAS 2.0 standards grid section"
```

---

## Task 16: Enhanced Footer with EU/RO Institutions + Accessibility

**Files:**
- Create: `src/pages/[lang]/accessibility.astro`
- Modify: `src/components/Footer.astro` — full institutional links
- Modify: `src/i18n/ro.json` and `en.json` — add `"footer.institutions"` and `"accessibility"` keys

**Step 1: Add institution links and accessibility keys to `ro.json` and `en.json`**

Add to `ro.json` (inside `"footer"` key):
```json
"institutions": {
  "euHeading": "Instituții europene",
  "roHeading": "Instituții române",
  "docsHeading": "Documentație",
  "eu": [
    { "name": "Comisia Europeană — eIDAS", "url": "https://digital-strategy.ec.europa.eu/en/policies/eudi-wallet" },
    { "name": "ENISA — Securitate EUDI", "url": "https://www.enisa.europa.eu/topics/eid" },
    { "name": "Comitetul European pentru Standardizare (CEN)", "url": "https://www.cen.eu" },
    { "name": "ETSI — Standarde telecomunicații", "url": "https://www.etsi.org" },
    { "name": "Consiliul UE — eIDAS 2.0", "url": "https://www.consilium.europa.eu/en/policies/eu-digital-identity-wallet/" }
  ],
  "ro": [
    { "name": "ADR — Autoritatea pentru Digitalizarea României", "url": "https://adr.gov.ro" },
    { "name": "ANPC — Autoritatea Națională pentru Protecția Consumatorilor", "url": "https://anpc.ro" },
    { "name": "ANSPDCP — Protecția Datelor", "url": "https://www.dataprotection.ro" },
    { "name": "MCID — Ministerul Cercetării, Inovării și Digitalizării", "url": "https://mci.gov.ro" },
    { "name": "CERT-RO — Securitate Cibernetică", "url": "https://www.cert.ro" }
  ],
  "docs": [
    { "name": "Reg. (UE) 2024/1183 — eIDAS 2.0 (text complet)", "url": "https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX%3A32024R1183" },
    { "name": "ARF — Architecture Reference Framework", "url": "https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/" },
    { "name": "GitHub EUDI — Specificații tehnice", "url": "https://github.com/eu-digital-identity-wallet" },
    { "name": "OpenID Foundation — OpenID4VCI", "url": "https://openid.net/specs/openid-4-verifiable-credential-issuance-1_0.html" },
    { "name": "IETF — SD-JWT Draft", "url": "https://datatracker.ietf.org/doc/draft-ietf-oauth-selective-disclosure-jwt/" }
  ]
}
```

Add accessibility key to both `ro.json` and `en.json`:
```json
"accessibility": {
  "statement": "Declarație de accesibilitate",
  "pageTitle": "Declarație de accesibilitate — EguWallet",
  "standard": "WCAG 2.1 nivel AA",
  "directive": "Directiva UE 2016/2102",
  "conformance": "Parțial conform",
  "description": "eguwallet.eu depune eforturi pentru a respecta nivelul AA al Ghidului pentru Accesibilitatea Conținutului Web (WCAG) 2.1, conform Directivei (UE) 2016/2102 privind accesibilitatea site-urilor web ale organismelor din sectorul public.",
  "contact": "Dacă întâmpinați dificultăți de accesibilitate, contactați-ne la: contact@eguilde.ro",
  "lastReviewed": "Ultima revizuire: 22 februarie 2026"
}
```

**Step 2: Rewrite `src/components/Footer.astro` with institutional links**

Replace the existing Footer.astro with a full 5-column footer:

```astro
---
import ShieldLogo from './ShieldLogo.astro';
import EuFlag from './EuFlag.astro';
import type { Translations } from '../i18n/index';
interface Props { t: Translations; lang: string; }
const { t, lang } = Astro.props;
---
<footer class="bg-[#141218] text-white/80">
  {t.isMachineTranslated && (
    <div class="bg-[#FFCC00]/15 border-b border-[#FFCC00]/20 px-4 py-3 text-center text-xs text-[#FFCC00]">
      ⚠️ {t.footer.machineTranslatedNotice}
    </div>
  )}

  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-8 mb-12">

      <!-- Brand column (spans 2 on lg) -->
      <div class="sm:col-span-2 lg:col-span-1">
        <div class="flex items-center gap-3 mb-4">
          <ShieldLogo size={44} />
          <div>
            <div class="font-bold text-white text-lg">EguWallet</div>
            <div class="text-white/50 text-xs leading-snug">{t.footer.tagline}</div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-4">
          <div class="flex items-center gap-1.5 bg-white/10 px-2.5 py-1.5 rounded-lg text-xs">
            <EuFlag size={16} />
            <span>{t.footer.euCompliance}</span>
          </div>
          <a href={`/${lang}/accessibility/`}
             class="flex items-center gap-1 bg-white/10 hover:bg-white/20 transition-colors
                    px-2.5 py-1.5 rounded-lg text-xs">
            ♿ {t.accessibility.statement}
          </a>
        </div>
        <p class="text-white/40 text-xs mt-4">{t.footer.provider}</p>
        <div class="flex gap-3 mt-4">
          <a href="https://play.google.com/store/apps/details?id=com.eguwallet.wallet"
             target="_blank" rel="noopener noreferrer"
             class="text-white/60 hover:text-white transition-colors text-xs underline">
            Google Play
          </a>
          <span class="text-white/20">·</span>
          <span class="text-white/30 text-xs">{t.hero.downloadIosComingSoon}</span>
        </div>
      </div>

      <!-- EU Institutions -->
      <div>
        <h4 class="text-white/90 font-semibold text-sm mb-3 flex items-center gap-2">
          <EuFlag size={16} /> {t.footer.institutions.euHeading}
        </h4>
        <ul class="flex flex-col gap-2">
          {t.footer.institutions.eu.map(({ name, url }) => (
            <li>
              <a href={url} target="_blank" rel="noopener noreferrer"
                 class="text-white/55 hover:text-white transition-colors text-xs leading-relaxed">
                {name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <!-- Romanian Institutions -->
      <div>
        <h4 class="text-white/90 font-semibold text-sm mb-3 flex items-center gap-2">
          🇷🇴 {t.footer.institutions.roHeading}
        </h4>
        <ul class="flex flex-col gap-2">
          {t.footer.institutions.ro.map(({ name, url }) => (
            <li>
              <a href={url} target="_blank" rel="noopener noreferrer"
                 class="text-white/55 hover:text-white transition-colors text-xs leading-relaxed">
                {name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <!-- Documentation links -->
      <div>
        <h4 class="text-white/90 font-semibold text-sm mb-3">📄 {t.footer.institutions.docsHeading}</h4>
        <ul class="flex flex-col gap-2">
          {t.footer.institutions.docs.map(({ name, url }) => (
            <li>
              <a href={url} target="_blank" rel="noopener noreferrer"
                 class="text-white/55 hover:text-white transition-colors text-xs leading-relaxed">
                {name}
              </a>
            </li>
          ))}
        </ul>
      </div>

      <!-- Legal + accessibility -->
      <div>
        <h4 class="text-white/90 font-semibold text-sm mb-3">⚖️ Legal</h4>
        <ul class="flex flex-col gap-2">
          <li><a href="#" class="text-white/55 hover:text-white transition-colors text-xs">{t.footer.privacy}</a></li>
          <li><a href="#" class="text-white/55 hover:text-white transition-colors text-xs">{t.footer.legal}</a></li>
          <li><a href={`/${lang}/accessibility/`} class="text-white/55 hover:text-white transition-colors text-xs">
            {t.accessibility.statement}
          </a></li>
          <li><a href="mailto:contact@eguilde.ro" class="text-white/55 hover:text-white transition-colors text-xs">
            {t.footer.contact}
          </a></li>
        </ul>

        <!-- Compliance badges -->
        <div class="flex flex-col gap-2 mt-5">
          <div class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/50">
            ✓ {t.accessibility.standard}
          </div>
          <div class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/50">
            ✓ {t.accessibility.directive}
          </div>
          <div class="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/50">
            ✓ GDPR Art. 5(1)(c)
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-white/10 pt-6 text-center text-xs text-white/35">
      {t.footer.rights}
    </div>
  </div>
</footer>
```

**Step 3: Create `src/pages/[lang]/accessibility.astro`**

Full accessibility statement page per EU Directive 2016/2102 requirements.

```astro
---
import Base from '../../layouts/Base.astro';
import Navbar from '../../components/Navbar.astro';
import Footer from '../../components/Footer.astro';
import { getTranslations } from '../../i18n/index';

export async function getStaticPaths() {
  const locales = ['ro','en','de','fr','es','it','pl','pt','hu','cs','sk','bg',
                   'hr','lt','lv','et','mt','sl','sv','da','nl','el','fi','ga'];
  return locales.map(lang => ({ params: { lang } }));
}

const { lang } = Astro.params;
const t = await getTranslations(lang);
---
<Base lang={lang} title={t.accessibility.pageTitle}
      description={t.accessibility.description} faqItems={[]}>
  <Navbar t={t} lang={lang} />
  <main class="max-w-3xl mx-auto px-4 sm:px-6 py-16">
    <h1 class="text-3xl font-bold text-[var(--fg)] mb-8">{t.accessibility.statement}</h1>

    <div class="flex flex-col gap-6 text-[var(--on-variant)] leading-relaxed">
      <div class="rounded-xl bg-[var(--surface)] border border-[var(--outline-var)] p-5">
        <p class="font-semibold text-[var(--fg)] mb-2">{t.accessibility.standard} · {t.accessibility.directive}</p>
        <p class="text-sm">{t.accessibility.conformance}</p>
      </div>
      <p>{t.accessibility.description}</p>
      <p>{t.accessibility.contact}</p>
      <p class="text-sm text-[var(--outline)]">{t.accessibility.lastReviewed}</p>
    </div>
  </main>
  <Footer t={t} lang={lang} />
</Base>
```

**Step 4: Add ARIA labels and roles throughout all section components**

For every interactive element verify:
- `<button>` elements have `aria-label` when icon-only
- `<a>` elements have descriptive text or `aria-label`
- `<section>` elements have `aria-labelledby` pointing to their `<h2>` id
- Images have `alt` text (SVG components already have `aria-label` + `role="img"`)
- Color is never the only means of conveying information (status badges use text + color)
- Focus order is logical (DOM order matches visual order)
- Minimum touch target: `min-h-[48px]` already applied to all interactive elements

**Step 5: Add `lang` prop to Footer in `src/pages/[lang]/index.astro`**

```astro
<Footer t={t} lang={lang} />
```

**Step 6: Commit**

```bash
git add src/components/Footer.astro src/components/StandardsSection.astro \
        src/pages/[lang]/accessibility.astro src/i18n/ro.json src/i18n/en.json
git commit -m "feat(footer): EU/RO institution links, docs, compliance badges, accessibility statement"
```

---

## Summary

| Task | What it builds |
|------|----------------|
| 1 | GitHub repo + Astro 5 project + Tailwind v4 + sitemap + design tokens |
| 2 | Base layout: full SEO head, hreflang ×24, JSON-LD ×4, no-FOUC dark mode |
| 3 | ShieldLogo SVG + EuFlag SVG (exact paths from Android XML) + favicon |
| 4 | i18n JSON (RO + EN hand-written, 22 stubs + typed loader) |
| 5 | Navbar: mobile hamburger + desktop nav + lang selector + theme toggle |
| 6 | Hero: crimson gradient, phone mockup, download badges |
| 7 | What/Privacy/Documents/UsedToday sections |
| 8 | Future/HowItWorks/FAQ/Footer sections |
| 9 | Page routes for all 24 locales + root browser-language redirect |
| 10 | Machine-translate 22 languages |
| 11 | Per-language OG images (1200×630) via astro-og-canvas |
| 12 | nginx vhost on egucluster1 with security headers + gzip |
| 13 | GitHub Actions: build → rsync → nginx reload |
| 14 | SEO verification: hreflang, JSON-LD, Lighthouse, Search Console |
| 15 | Romania context + complete eIDAS 2.0 standards section (12 standards) |
| 16 | Enhanced footer: EU/RO institution links + docs + accessibility statement page + WCAG 2.1 AA compliance badges |
