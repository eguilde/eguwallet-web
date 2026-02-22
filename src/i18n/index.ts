import type ro from './ro.json';
import roData from './ro.json';
import enData from './en.json';

export type Translations = typeof ro;

const translations: Record<string, Translations> = {
  ro: roData,
  en: enData,
};

export async function getTranslations(lang: string): Promise<Translations> {
  if (translations[lang]) return translations[lang];
  // All other languages fall back to English
  return translations.en;
}
