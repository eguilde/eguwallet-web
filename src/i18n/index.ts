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

const cache: Record<string, Translations> = {
  ro: roData, en: enData, de: deData, fr: frData, es: esData,
  it: itData, pl: plData, pt: ptData, hu: huData, cs: csData,
  sk: skData, bg: bgData, hr: hrData, lt: ltData, lv: lvData,
  et: etData, mt: mtData, sl: slData, sv: svData, da: daData,
  nl: nlData, el: elData, fi: fiData, ga: gaData,
};

export async function getTranslations(lang: string): Promise<Translations> {
  return cache[lang] ?? enData;
}
