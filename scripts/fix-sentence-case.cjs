#!/usr/bin/env node
/**
 * Applies sentence case to useCases category titles and scenario names
 * in all language files EXCEPT English (Title Case is valid) and German
 * (all nouns are capitalized in German, so Title Case is grammatically correct).
 *
 * Rule: lowercase all words after the first, EXCEPT:
 *   - ALL-CAPS words (acronyms: KYC, AML, NFC, QR, ONRC, QES, GDPR, etc.)
 *   - "EguWallet" (brand name)
 *   - Single letters (e.g. "B2B")
 */

const fs = require('fs');
const path = require('path');

// Languages to skip (Title Case is correct or intentional)
const SKIP_LANGS = ['en', 'de'];

// Words that should never be lowercased (brand names, acronyms handled separately)
const PRESERVE_WORDS = new Set(['EguWallet']);

function isAcronym(word) {
  // All uppercase, possibly with digits or slashes, at least 2 chars
  return /^[A-ZČŠŽĆĐ0-9+&/()]{2,}$/.test(word);
}

function toSentenceCase(str) {
  if (!str || typeof str !== 'string') return str;

  // Split on em-dash (—) to handle compound titles like "Foo Bar — Baz Qux"
  // After em-dash, the next segment also starts a new "sentence" (lowercase)
  const parts = str.split(' — ');

  const processed = parts.map((part, partIndex) => {
    const words = part.split(' ');
    return words.map((word, wordIndex) => {
      // First word of first part keeps its case (capitalize first letter, rest as-is)
      if (partIndex === 0 && wordIndex === 0) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          // But if original was ALL-CAPS acronym, preserve it
          .replace(/^/, () => isAcronym(word) ? word : '');
      }

      // After em-dash: first word of each subsequent part gets lowercase (sentence continues)
      // But wait — in Romanian "Juridic și notarial — prezența fizică nu mai este necesară"
      // the part after — is also sentence-case (lowercase first word)

      // Preserve ALL-CAPS acronyms
      if (isAcronym(word)) return word;

      // Preserve brand names
      if (PRESERVE_WORDS.has(word)) return word;

      // Preserve words with special chars that are clearly proper: B2B, KYC/AML, etc.
      if (/[0-9+&/]/.test(word) && word === word.toUpperCase()) return word;

      // Lowercase everything else
      return word.charAt(0).toLowerCase() + word.slice(1);
    }).join(' ');
  });

  // Re-join with em-dash, but first word after — should be lowercase
  // (it's a continuation of the title, not a new sentence)
  return processed.map((part, i) => {
    if (i === 0) return part;
    // First word after — should be lowercase (sentence case continuation)
    return part.charAt(0).toLowerCase() + part.slice(1);
  }).join(' — ');
}

// Fields in useCases.categories to apply sentence case to
function processCategories(categories) {
  if (!Array.isArray(categories)) return categories;
  return categories.map(cat => {
    const result = { ...cat };
    if (result.title) result.title = toSentenceCase(result.title);
    if (Array.isArray(result.scenarios)) {
      result.scenarios = result.scenarios.map(sc => ({
        ...sc,
        name: sc.name ? toSentenceCase(sc.name) : sc.name,
      }));
    }
    return result;
  });
}

const i18nDir = path.join(__dirname, '..', 'src', 'i18n');
const files = fs.readdirSync(i18nDir).filter(f => f.endsWith('.json'));

let changed = 0;
for (const file of files) {
  const lang = file.replace('.json', '');
  if (SKIP_LANGS.includes(lang)) {
    console.log(`⏭  Skipping ${lang} (Title Case is correct for this language)`);
    continue;
  }

  const filePath = path.join(i18nDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!data.useCases || !data.useCases.categories) {
    console.log(`⚠  ${lang}: no useCases.categories, skipping`);
    continue;
  }

  const before = JSON.stringify(data.useCases.categories);
  data.useCases.categories = processCategories(data.useCases.categories);
  const after = JSON.stringify(data.useCases.categories);

  if (before === after) {
    console.log(`✓  ${lang}: already sentence case, no changes`);
    continue;
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✅ ${lang}: applied sentence case`);
  changed++;
}

console.log(`\nDone. Updated ${changed} file(s).`);
