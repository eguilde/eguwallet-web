import type ro from './ro.json';
import roData from './ro.json';
import enData from './en.json';

export type Translations = typeof ro;

// Lazy-load all 22 other EU official languages
async function loadLang(lang: string): Promise<Translations | null> {
  try {
    const mod = await import(`./${lang}.json`);
    return mod.default as Translations;
  } catch {
    return null;
  }
}

const cache: Record<string, Translations> = {
  ro: roData,
  en: enData,
};

export async function getTranslations(lang: string): Promise<Translations> {
  if (cache[lang]) return cache[lang];
  const loaded = await loadLang(lang);
  if (loaded) {
    cache[lang] = loaded;
    return loaded;
  }
  // Fallback to English for any unsupported language
  return enData;
}
