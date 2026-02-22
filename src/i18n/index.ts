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
    const mod = await import('./en.json');
    cache[lang] = mod.default as Translations;
    return cache[lang]!;
  }
}
