import type ro from './ro.json';
import roData from './ro.json';
import enData from './en.json';
import deData from './de.json';
import frData from './fr.json';
import esData from './es.json';
import itData from './it.json';
import plData from './pl.json';
import ptData from './pt.json';
import huData from './hu.json';
import csData from './cs.json';
import skData from './sk.json';
import bgData from './bg.json';
import hrData from './hr.json';
import ltData from './lt.json';
import lvData from './lv.json';
import etData from './et.json';
import mtData from './mt.json';
import slData from './sl.json';
import svData from './sv.json';
import daData from './da.json';
import nlData from './nl.json';
import elData from './el.json';
import fiData from './fi.json';
import gaData from './ga.json';

export type Translations = typeof ro;

// Deep merge: target fills any gaps from source (source = fallback)
function deepMerge<T extends object>(target: Partial<T>, source: T): T {
  const result = { ...source } as T;
  for (const key in target) {
    const tv = target[key];
    const sv = source[key];
    if (tv !== undefined && tv !== null) {
      if (typeof tv === 'object' && !Array.isArray(tv) && typeof sv === 'object' && sv !== null && !Array.isArray(sv)) {
        (result as Record<string, unknown>)[key] = deepMerge(tv as object, sv as object);
      } else if (Array.isArray(tv) && Array.isArray(sv)) {
        // Merge arrays element-by-element so longer RO arrays fill missing entries
        const merged = sv.map((item: unknown, i: number) =>
          i < tv.length
            ? (typeof item === 'object' && item !== null && typeof tv[i] === 'object' && tv[i] !== null
                ? deepMerge(tv[i] as object, item as object)
                : tv[i])
            : item
        );
        // If target has more items than source, append them
        if (tv.length > sv.length) merged.push(...tv.slice(sv.length));
        (result as Record<string, unknown>)[key] = merged;
      } else {
        (result as Record<string, unknown>)[key] = tv;
      }
    }
  }
  return result;
}

const raw: Record<string, object> = {
  ro: roData, en: enData, de: deData, fr: frData, es: esData,
  it: itData, pl: plData, pt: ptData, hu: huData, cs: csData,
  sk: skData, bg: bgData, hr: hrData, lt: ltData, lv: lvData,
  et: etData, mt: mtData, sl: slData, sv: svData, da: daData,
  nl: nlData, el: elData, fi: fiData, ga: gaData,
};

const cache: Record<string, Translations> = {};

export async function getTranslations(lang: string): Promise<Translations> {
  if (cache[lang]) return cache[lang];
  const data = raw[lang] ?? enData;
  // Deep-merge with RO as the authoritative fallback (RO is always complete)
  const merged = deepMerge(data as Partial<Translations>, roData as Translations);
  cache[lang] = merged;
  return merged;
}
