// Fix useCases.categories order to match ro.json in all language files
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../src/i18n');
const ro = JSON.parse(fs.readFileSync(path.join(dir, 'ro.json'), 'utf8'));
const roIcons = ro.useCases.categories.map(c => c.icon);
console.log('RO icon order:', roIcons.join(', '));

const langs = ['en','de','fr','es','it','pl','pt','hu','cs','sk','bg','hr','lt','lv','et','mt','sl','sv','da','nl','el','fi','ga'];

for (const lang of langs) {
  const filePath = path.join(dir, lang + '.json');
  const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!d.useCases || !d.useCases.categories) {
    console.log(lang + ': no useCases.categories, skipping');
    continue;
  }
  const langIcons = d.useCases.categories.map(c => c.icon);
  const langIconStr = langIcons.join(',');
  const roIconStr = roIcons.join(',');
  if (langIconStr === roIconStr) {
    console.log(lang + ': order OK');
    continue;
  }
  // Reorder lang categories to match ro order
  const reordered = roIcons.map(icon => {
    const found = d.useCases.categories.find(c => c.icon === icon);
    if (!found) {
      // Missing category - use ro's as fallback
      const roFallback = ro.useCases.categories.find(c => c.icon === icon);
      console.log(lang + ': missing category ' + icon + ', using ro fallback');
      return roFallback;
    }
    return found;
  });
  // Also append any extra categories in lang that aren't in ro
  for (const cat of d.useCases.categories) {
    if (!roIcons.includes(cat.icon)) {
      reordered.push(cat);
      console.log(lang + ': appending extra category ' + cat.icon);
    }
  }
  d.useCases.categories = reordered;
  fs.writeFileSync(filePath, JSON.stringify(d, null, 2) + '\n', 'utf8');
  console.log(lang + ': FIXED order to ' + reordered.map(c => c.icon).join(','));
}
console.log('Done!');
