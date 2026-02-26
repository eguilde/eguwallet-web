// Add missing `integrate` key to all language files that lack it
// Uses English content as the base (pages already marked as machine-translated)
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../src/i18n');
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
const enIntegrate = en.integrate;

const langs = ['de','fr','es','it','pl','pt','hu','cs','sk','bg','hr','lt','lv','et','mt','sl','sv','da','nl','el','fi','ga'];

for (const lang of langs) {
  const filePath = path.join(dir, lang + '.json');
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (d.integrate) {
    console.log(lang + ': already has integrate, skipping');
    continue;
  }
  // Insert integrate after usedToday key or before verifier key
  // We'll just assign it — JSON.stringify will put it at end, then we fix ordering via key insertion
  const keys = Object.keys(d);
  const verifierIdx = keys.indexOf('verifier');
  const newObj = {};
  for (let i = 0; i < keys.length; i++) {
    if (i === verifierIdx) {
      newObj['integrate'] = { ...enIntegrate, ctaUrl: `/${lang}/contact/` };
    }
    newObj[keys[i]] = d[keys[i]];
  }
  if (!newObj.integrate) newObj.integrate = { ...enIntegrate, ctaUrl: `/${lang}/contact/` };

  fs.writeFileSync(filePath, JSON.stringify(newObj, null, 2) + '\n', 'utf8');
  console.log(lang + ': added integrate key');
}
console.log('Done!');
