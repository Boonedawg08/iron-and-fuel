// Builds the offline food database bundled with the app.
//
//   npm run build:foods
//
// Downloads the USDA FoodData Central "Foundation Foods" and "SR Legacy" JSON datasets
// (public domain, https://fdc.nal.usda.gov/download-datasets), keeps only the nutrients
// and portion weights the app uses, and writes a compact file to public/data/foods.json.
// Downloads are cached in .cache/usda so re-runs are fast and work offline.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';

const BASE = 'https://fdc.nal.usda.gov/fdc-datasets/';
const DATASETS = [
  { file: 'FoodData_Central_foundation_food_json_2025-12-18.zip', key: 'FoundationFoods', tag: 'F' },
  { file: 'FoodData_Central_sr_legacy_food_json_2018-04.zip', key: 'SRLegacyFoods', tag: 'S' },
];
const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = ROOT + '.cache/usda/';
const OUT = ROOT + 'public/data/foods.json';

// Output nutrient order. Each entry lists USDA nutrient numbers, first match wins.
// Must stay in sync with NUTRIENT_KEYS in src/db.ts.
const NUTRIENTS = [
  ['kcal', ['208', '958', '957']],
  ['protein', ['203']],
  ['carbs', ['205']],
  ['fat', ['204', '298']],
  ['fiber', ['291']],
  ['sugar', ['269', '269.3']],
  ['sodium', ['307']],
  ['satFat', ['606']],
  ['cholesterol', ['601']],
  ['potassium', ['306']],
  ['calcium', ['301']],
  ['iron', ['303']],
  ['magnesium', ['304']],
  ['zinc', ['309']],
  ['vitC', ['401']],
  ['vitA', ['320']],
  ['vitD', ['328']],
  ['vitB12', ['418']],
];

async function load(ds) {
  mkdirSync(CACHE, { recursive: true });
  const path = CACHE + ds.file;
  if (!existsSync(path)) {
    console.log('downloading', ds.file);
    const res = await fetch(BASE + ds.file);
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${ds.file}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const files = unzipSync(new Uint8Array(readFileSync(path)));
  const name = Object.keys(files).find((n) => n.endsWith('.json'));
  return JSON.parse(strFromU8(files[name]))[ds.key];
}

const sig = (n) => (n === 0 ? 0 : Number(n.toPrecision(4)));

function nutrientsOf(food) {
  const byNum = new Map();
  for (const fn of food.foodNutrients ?? []) {
    if (fn.nutrient?.number != null && typeof fn.amount === 'number') byNum.set(fn.nutrient.number, fn.amount);
  }
  const out = NUTRIENTS.map(([, nums]) => {
    for (const num of nums) if (byNum.has(num)) return sig(byNum.get(num));
    return null;
  });
  // Some Foundation foods have no energy value: derive it with the general Atwater factors.
  if (out[0] === null && out[1] !== null && out[2] !== null && out[3] !== null) {
    out[0] = Math.round(4 * out[1] + 4 * out[2] + 9 * out[3]);
  }
  return out;
}

function portionsOf(food) {
  const seen = new Set();
  const out = [];
  for (const p of food.foodPortions ?? []) {
    const amount = p.amount ?? p.value ?? 1;
    if (!p.gramWeight || !amount) continue;
    const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    if (unit === 'RACC') continue; // regulatory serving size, not a household measure
    const label = [unit, p.modifier].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (!label || /^\d+$/.test(label) || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push([label, sig(p.gramWeight / amount)]);
  }
  return out.slice(0, 10);
}

const cleanName = (d) => d.replace(/\s*\(Includes foods for USDA's Food Distribution Program\)/i, '').replace(/\s+/g, ' ').trim();

const categories = [];
const catIndex = (name) => {
  let i = categories.indexOf(name);
  if (i < 0) i = categories.push(name) - 1;
  return i;
};

const foods = [];
for (const ds of DATASETS) {
  const raw = await load(ds);
  let kept = 0;
  for (const f of raw) {
    const n = nutrientsOf(f);
    if (n[0] === null || n[1] === null || n[2] === null || n[3] === null) continue; // need kcal + macros
    foods.push([f.fdcId, cleanName(f.description), catIndex(f.foodCategory?.description ?? 'Other'), ds.tag, n, portionsOf(f)]);
    kept++;
  }
  console.log(`${ds.key}: ${raw.length} foods, kept ${kept}`);
}

// The same description can appear in both datasets. Keep the newer Foundation entry, but borrow
// household portion weights from its SR Legacy twin when Foundation has none.
const byName = new Map();
for (const f of foods) {
  const prev = byName.get(f[1]);
  if (!prev) { byName.set(f[1], f); continue; }
  if (prev[5].length === 0) prev[5] = f[5];
  f.dup = true;
}
const before = foods.length;
for (let i = foods.length - 1; i >= 0; i--) if (foods[i].dup) foods.splice(i, 1);
console.log(`merged ${before - foods.length} duplicate descriptions`);

const json = JSON.stringify({
  version: 1,
  source: 'USDA FoodData Central: Foundation Foods (2025-12) and SR Legacy (2018-04). Public domain.',
  nutrients: NUTRIENTS.map(([k]) => k),
  categories,
  // [fdcId, description, categoryIndex, dataset (F|S), nutrients per 100 g, [[portionLabel, grams], ...]]
  foods,
});
mkdirSync(ROOT + 'public/data', { recursive: true });
writeFileSync(OUT, json);
console.log(`wrote ${OUT}: ${foods.length} foods, ${(json.length / 1e6).toFixed(2)} MB, ${(gzipSync(json).length / 1e6).toFixed(2)} MB gzipped`);
