/**
 * Offline food search and gram resolution. Pure (no network / IndexedDB) so it is unit-testable:
 * call initBundledFoods() with the parsed public/data/foods.json, then search().
 */
import { NUTRIENT_KEYS, type Food, type Nutrients, type Portion } from '../db';
import { ALIASES } from './aliases';
import type { ParsedItem } from './parser';
import { VOLUME_ML, isMassUnit, isVolumeUnit, massToGrams, type VolumeUnit } from './units';

export interface BundledDb {
  version: number;
  source: string;
  nutrients: string[];
  categories: string[];
  foods: [number, string, number, string, (number | null)[], [string, number][]][];
}

interface Indexed { food: Food; tokens: Set<string>; head: string[]; ntok: number; state: FoodState; user: boolean }
export type FoodState = 'cooked' | 'raw' | null;

const STOP = new Set(['of', 'the', 'a', 'an', 'or', 'and', 'with', 'in', 'to', 'for', 'from', 'some', 'my', 'fresh', 'plain', 'regular']);
const COOKED_WORDS = ['cooked', 'roasted', 'broiled', 'grilled', 'baked', 'boiled', 'fried', 'steamed', 'braised', 'stewed', 'toasted', 'microwaved', 'sauteed', 'scrambled', 'poached', 'smoked', 'browned', 'rotisserie', 'heated'];
const RAW_WORDS = ['raw', 'uncooked', 'unprepared', 'dry', 'unheated'];
const STATE_WORDS = new Set([...COOKED_WORDS, ...RAW_WORDS]);
/** What users type -> extra USDA wording that should also count as a match. */
const SYNONYMS: Record<string, string[]> = {
  grilled: ['broiled', 'cooked'], baked: ['roasted', 'cooked'], roasted: ['baked', 'cooked'], sauteed: ['fried', 'cooked'],
  fried: ['cooked'], boiled: ['cooked'], steamed: ['boiled', 'cooked'], broiled: ['grilled', 'cooked'],
  uncooked: ['raw', 'dry'], dry: ['raw', 'uncooked'], raw: ['uncooked', 'unprepared'],
  skim: ['nonfat'], nonfat: ['skim'], lowfat: ['reduced'], wholewheat: ['wheat'],
  garbanzo: ['chickpea'], soda: ['cola'], fries: ['french'], yoghurt: ['yogurt'], prawn: ['shrimp'],
  ketchup: ['catsup'], coke: ['cola'], donut: ['doughnut'], fry: ['french', 'fried'], mayo: ['mayonnaise'], hamburger: ['beef', 'ground'], skinless: ['meat'], boneless: ['meat'],
};
/** Variants nobody means unless they say so. */
const VARIANT_WORDS = new Set(['canned', 'frozen', 'dried', 'dehydrated', 'powder', 'juice', 'flour', 'concentrate', 'syrup',
  'imitation', 'substitute', 'giblet', 'liver', 'skin', 'babyfood', 'infant', 'bran', 'germ', 'sprouted', 'pickled', 'candied',
  'nectar', 'leaf', 'seed', 'mix', 'oil', 'fat', 'restaurant', 'breaded', 'sauce', 'soup', 'chip', 'snack', 'bar', 'spread', 'drink']);
const DEFAULT_COOKED = /Poultry|Beef|Pork|Finfish|Lamb|Cereal Grains|Legumes|Sausages/;
const DEFAULT_RAW = /Fruits|Vegetables|Nut and Seed/;
const PENALIZED_CATEGORY: Record<string, number> = {
  'Baby Foods': 0.3, 'Fast Foods': 0.1, 'Restaurant Foods': 0.1, 'American Indian/Alaska Native Foods': 0.15,
};

export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && /(?:oes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ches|shes|xes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1);
  return w;
}
export function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/whole[- ]wheat/g, 'wholewheat').replace(/['’]/g, '')
    .split(/[^a-z0-9%]+/).filter((t) => t && !STOP.has(t)).map(stem);
}

function stateOf(name: string): FoodState {
  const t = new Set(tokenize(name));
  if (COOKED_WORDS.some((w) => t.has(w))) return 'cooked';
  if (RAW_WORDS.some((w) => t.has(w))) return 'raw';
  return null;
}
/** Human-readable preparation state of a food, used for the cooked/raw note on confirmation cards. */
export function foodState(food: Food): FoodState { return stateOf(food.name); }

function indexFood(food: Food, user: boolean): Indexed {
  const toks = tokenize(food.name + ' ' + (food.brand ?? ''));
  return { food, tokens: new Set(toks), head: tokenize(food.name.split(',')[0]), ntok: toks.length, state: stateOf(food.name), user };
}

let bundled: Indexed[] = [];
let userFoods: Indexed[] = [];
let byId = new Map<string, Food>();
let byName = new Map<string, Food>();
let vocab: string[] = [];

export function toNutrients(arr: (number | null)[], keys: string[]): Nutrients {
  const n: Nutrients = {};
  keys.forEach((k, i) => { if (arr[i] !== null && (NUTRIENT_KEYS as readonly string[]).includes(k)) n[k as keyof Nutrients] = arr[i] as number; });
  return n;
}

export function initBundledFoods(dbJson: BundledDb): void {
  bundled = dbJson.foods.map(([id, name, cat, , n, portions]) => indexFood({
    id: `usda:${id}`, source: 'usda', name, category: dbJson.categories[cat],
    n: toNutrients(n, dbJson.nutrients), portions: portions.map(([label, grams]) => ({ label, grams })),
  }, false));
  rebuild();
}
/** Custom foods and online foods cached in IndexedDB. */
export function setUserFoods(foods: Food[]): void {
  userFoods = foods.map((f) => indexFood(f, true));
  rebuild();
}
function rebuild(): void {
  byId = new Map();
  byName = new Map();
  const v = new Set<string>();
  for (const ix of [...bundled, ...userFoods]) {
    byId.set(ix.food.id, ix.food);
    // Same description can exist in both datasets: keep the one with more portion data.
    const prev = byName.get(ix.food.name);
    if (!prev || ix.food.portions.length > prev.portions.length) byName.set(ix.food.name, ix.food);
    ix.tokens.forEach((t) => v.add(t));
  }
  vocab = [...v];
}
export const bundledCount = (): number => bundled.length;
export const getFood = (id: string): Food | undefined => byId.get(id);
export const getFoodByName = (name: string): Food | undefined => byName.get(name);

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** For one query token: which vocabulary tokens count as a match, and how strongly (0..1). */
function candidates(q: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (t: string, w: number) => { if ((out.get(t) ?? 0) < w) out.set(t, w); };
  put(q, 1);
  for (const s of SYNONYMS[q] ?? []) put(s, s === 'cooked' ? 0.75 : 0.9);
  const exact = vocab.includes(q);
  for (const v of vocab) {
    if (v === q) continue;
    if (q.length >= 3 && v.startsWith(q)) put(v, 0.8);
    else if (v.length >= 4 && q.startsWith(v) && q.length - v.length <= 3) put(v, 0.7);
    else if (!exact && q.length >= 5) {
      const max = q.length >= 8 ? 2 : 1;
      if (editDistance(q, v, max) <= max) put(v, 0.6);
    }
  }
  return out;
}

export interface SearchHit {
  food: Food;
  /** 0..1 overall score. */
  score: number;
  /** Share of the query's words found in the food name (1 = all of them). */
  coverage: number;
  viaAlias?: boolean;
}

export function search(query: string, limit = 12): SearchHit[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];
  const cands = qTokens.map(candidates);
  const weights = qTokens.map((t) => (STATE_WORDS.has(t) ? 0.5 : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const qSet = new Set(qTokens);
  const wantsState: FoodState = qTokens.some((t) => RAW_WORDS.includes(t)) ? 'raw' : qTokens.some((t) => COOKED_WORDS.includes(t)) ? 'cooked' : null;

  const hits: SearchHit[] = [];
  for (const ix of [...userFoods, ...bundled]) {
    let got = 0;
    const matched = new Set<string>();
    for (let i = 0; i < qTokens.length; i++) {
      let best = 0, bestTok = '';
      for (const [tok, w] of cands[i]) if (w > best && ix.tokens.has(tok)) { best = w; bestTok = tok; }
      if (best) matched.add(bestTok);
      got += best * weights[i];
    }
    if (got === 0) continue;
    const coverage = got / totalW;
    const headHit = ix.head.length ? ix.head.filter((t) => matched.has(t)).length / ix.head.length : 0;
    let score = 0.62 * coverage + 0.2 * headHit;
    // Prefer plain entries: every extra, unasked-for word in the name costs a little.
    score += 0.18 * Math.max(0, 1 - (ix.ntok - matched.size) / 8);
    for (const t of ix.tokens) if (VARIANT_WORDS.has(t) && !qSet.has(t) && !matched.has(t)) score -= 0.05;
    if (!wantsState && ix.state) {
      const cat = ix.food.category ?? '';
      const def: FoodState = DEFAULT_COOKED.test(cat) ? 'cooked' : DEFAULT_RAW.test(cat) ? 'raw' : null;
      if (def) score += ix.state === def ? 0.05 : -0.05;
    }
    if (wantsState && ix.state && ix.state !== wantsState) score -= 0.15;
    const pen = PENALIZED_CATEGORY[ix.food.category ?? ''];
    if (pen) score -= pen;
    if (ix.user) score += 0.05;
    hits.push({ food: ix.food, score: Math.max(0, Math.min(1, score)), coverage });
  }
  hits.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);

  // Everyday-name shortcut ("chicken breast" -> the roasted, meat-only entry).
  const coreKey = qTokens.filter((t) => !STATE_WORDS.has(t)).join(' ');
  const aliasName = ALIASES[qTokens.join(' ')] ?? ALIASES[coreKey];
  const aliasFood = aliasName ? byName.get(aliasName) : undefined;
  if (aliasFood) {
    const st = stateOf(aliasFood.name);
    const compatible = !wantsState || !st || st === wantsState || !!ALIASES[qTokens.join(' ')];
    const userExact = hits[0]?.food.source !== 'usda' && hits[0]?.coverage === 1 && hits[0].score > 0.9;
    if (compatible && !userExact) {
      const rest = hits.filter((h) => h.food.id !== aliasFood.id);
      return [{ food: aliasFood, score: 0.97, coverage: 1, viaAlias: true }, ...rest].slice(0, limit);
    }
  }
  return hits.slice(0, limit);
}

/** A match is trusted only if every word was found and the overall score is solid. */
export const CONFIDENT_SCORE = 0.72;
export function isConfident(hit: SearchHit | undefined): boolean {
  return !!hit && hit.coverage >= 0.999 && hit.score >= CONFIDENT_SCORE;
}

/* ---------- nutrients ---------- */
export function scaleNutrients(per100: Nutrients, grams: number): Nutrients {
  const out: Nutrients = {};
  for (const k of NUTRIENT_KEYS) if (per100[k] !== undefined) out[k] = (per100[k] as number) * grams / 100;
  return out;
}
export function sumNutrients(list: Nutrients[]): Nutrients {
  const out: Nutrients = {};
  for (const n of list) for (const k of NUTRIENT_KEYS) if (n[k] !== undefined) out[k] = (out[k] ?? 0) + (n[k] as number);
  return out;
}

/* ---------- quantity -> grams ---------- */
const VOL_START: [RegExp, VolumeUnit][] = [
  [/^cups?\b/, 'cup'], [/^(?:tablespoons?|tbsp)\b/, 'tbsp'], [/^(?:teaspoons?|tsp)\b/, 'tsp'],
  [/^(?:fl\.? ?oz|fluid ounces?)\b/, 'floz'], [/^(?:ml|milliliters?)\b/, 'ml'], [/^(?:liters?|litres?)\b/, 'l'],
];
const VOL_INSIDE = /(\d+(?:\.\d+)?(?:\/\d+)?)\s*(cups?|fl\.? ?oz|tbsp|tablespoons?|tsp|teaspoons?)\b/;
const MASS_LABEL = /^(?:oz|ounces?|lb|pounds?|g|grams?)\b/;

/** Reads a volume out of a USDA portion label: "cup, chopped", "serving 1/2 cup", "drink (16 fl oz)". */
export function volumeOfLabel(label: string): { unit: VolumeUnit; amount: number } | null {
  const l = label.toLowerCase();
  for (const [re, u] of VOL_START) if (re.test(l)) return { unit: u, amount: 1 };
  const m = l.match(VOL_INSIDE);
  if (!m) return null;
  const [a, b] = m[1].split('/').map(Number);
  const amount = b ? a / b : a;
  const w = m[2];
  const unit: VolumeUnit = w.startsWith('cup') ? 'cup' : w.startsWith('fl') ? 'floz' : /^(?:tbsp|tablespoon)/.test(w) ? 'tbsp' : 'tsp';
  return amount > 0 ? { unit, amount } : null;
}
/** Grams per millilitre from a food's own portion data, or null when it has no volume measure. */
export function densityOf(food: Food, prefer?: VolumeUnit): { gPerMl: number; portion: Portion } | null {
  const vols = food.portions.map((p) => ({ p, v: volumeOfLabel(p.label) })).filter((x) => x.v);
  if (!vols.length) return null;
  // "cup, pureed" weighs far more than "cup, sliced": skip compacted forms when there is a choice.
  const loose = vols.filter((x) => !/pureed|mashed|packed|crushed|melted|whipped|ground/.test(x.p.label.toLowerCase()));
  const pool = loose.length ? loose : vols;
  const pick = pool.find((x) => x.v!.unit === prefer) ?? pool[0];
  return { gPerMl: pick.p.grams / (pick.v!.amount * VOLUME_ML[pick.v!.unit]), portion: pick.p };
}
/** Rough weights for informal measures when USDA has no matching portion for the food. */
const GENERIC_COUNT_G: Record<string, number> = { handful: 30, scoop: 30, pinch: 0.4, dash: 0.6, glass: 240, bowl: 300, pat: 5 };
const COUNT_SYNONYMS: Record<string, string[]> = { strip: ['slice'], piece: ['slice'], slice: ['piece'], fillet: ['fillet', 'filet'], can: ['can'], bottle: ['bottle', 'can'] };

export interface GramResult {
  grams: number;
  /** True when a generic assumption was used instead of USDA data for this food. */
  approx: boolean;
  /** How the amount was converted, shown on the confirmation card. */
  note: string;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Pick the portion people mean by "1 banana" / "2 eggs" / "a chicken breast". */
export function defaultCountPortion(food: Food, foodQuery = ''): Portion | null {
  const q = new Set(tokenize(foodQuery));
  let best: Portion | null = null, bestScore = -1;
  for (const p of food.portions) {
    const l = p.label.toLowerCase();
    if (volumeOfLabel(l) || MASS_LABEL.test(l)) continue;
    let s = 0.5;
    const ltok = tokenize(l.replace(/\(.*?\)/g, ''));
    const head = tokenize(food.name.split(',')[0]);
    if (ltok.some((t) => q.has(t) || head.includes(t))) s += 3;
    if (/\bmedium\b/.test(l)) s += /^egg/i.test(food.name) ? 1.5 : 2.5;
    else if (/\blarge\b/.test(l) && !/extra/.test(l)) s += 2;
    else if (/^(?:whole|fruit|each|item|piece|slice|unit|patty|fillet|serving|nlea|link|bar|sandwich)/.test(l)) s += 1;
    else if (/^(?:small|extra|jumbo|mini)/.test(l)) s += 0.2;
    // "1 pizza slice" should never resolve to a whole package.
    if (/^(?:package|container|bunch|head|loaf|pie|box|bag|carton)\b/.test(l)) s -= 3;
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

/**
 * @param siblings other close matches for the same text; their volume data is borrowed
 *   (and flagged approximate) when the chosen food has none.
 */
export function resolveGrams(item: Pick<ParsedItem, 'qty' | 'unit' | 'kind' | 'food' | 'qtyGiven'>, food: Food, siblings: Food[] = []): GramResult {
  const { qty, unit } = item;
  if (unit && isMassUnit(unit)) {
    return { grams: r1(massToGrams(qty, unit)), approx: false, note: unit === 'g' ? '' : `${qty} ${unit} = ${r1(massToGrams(qty, unit))} g` };
  }
  if (unit && isVolumeUnit(unit)) {
    const own = densityOf(food, unit);
    if (own) {
      const grams = r1(qty * VOLUME_ML[unit] * own.gPerMl);
      return { grams, approx: false, note: `${qty} ${unit} = ${grams} g (USDA: ${own.portion.label} = ${own.portion.grams} g)` };
    }
    for (const sib of siblings) {
      const d = densityOf(sib, unit);
      if (!d) continue;
      const grams = r1(qty * VOLUME_ML[unit] * d.gPerMl);
      return { grams, approx: true, note: `No volume data for this exact food, so used the weight of "${sib.name}" (${d.portion.label} = ${d.portion.grams} g): ${grams} g. Check the amount.` };
    }
    const grams = r1(qty * VOLUME_ML[unit]);
    return { grams, approx: true, note: `No volume data for this food, so assumed water density (1 g per ml): ${qty} ${unit} = ${grams} g. Check the amount.` };
  }
  if (unit) {
    const words = [stem(unit), ...(COUNT_SYNONYMS[unit] ?? [])];
    let hit: Portion | undefined;
    for (const u of words) {
      hit = food.portions.find((p) => tokenize(p.label)[0] === u) ?? food.portions.find((p) => tokenize(p.label.replace(/\(.*?\)/g, '')).includes(u));
      if (hit) break;
    }
    if (hit) return { grams: r1(qty * hit.grams), approx: false, note: `${qty} × ${hit.label} (${hit.grams} g each, USDA)` };
  }
  const generic = unit ? GENERIC_COUNT_G[unit] : undefined;
  if (generic) {
    return { grams: r1(qty * generic), approx: true, note: `No "${unit}" weight for this food, so assumed about ${generic} g per ${unit}. Check the amount.` };
  }
  const def = defaultCountPortion(food, item.food);
  if (def) {
    const why = unit ? `No "${unit}" weight for this food, used` : !item.qtyGiven ? 'No amount given, assumed' : 'Used';
    return { grams: r1(qty * def.grams), approx: !!unit || !item.qtyGiven, note: `${why} ${qty} × ${def.label} (${def.grams} g each, USDA)` };
  }
  const any = food.portions[0];
  if (any && !item.qtyGiven) return { grams: r1(any.grams), approx: true, note: `No amount given, assumed 1 ${any.label} (${any.grams} g). Check the amount.` };
  return { grams: r1(qty * 100), approx: true, note: `No portion weight for this food, so assumed 100 g each. Check the amount.` };
}

/** Sentence about cooked vs raw weight for the confirmation card. */
export function stateNote(food: Food, userText: string): string {
  const st = foodState(food);
  if (!st) return '';
  const said = tokenize(userText).some((t) => STATE_WORDS.has(t));
  const what = st === 'cooked' ? 'cooked' : /\bdry\b|uncooked/i.test(food.name) ? 'dry / uncooked' : 'raw';
  return said ? `Using ${what} values, as you described.` : `Assumed ${what} weight (you didn't say). Swap the match if you weighed it ${st === 'cooked' ? 'raw' : 'cooked'}.`;
}

/** Close matches that share the top hit's head word; used to borrow volume data. */
export function siblingsOf(hits: SearchHit[], chosen: Food): Food[] {
  const head = tokenize(chosen.name.split(',')[0])[0];
  return hits.filter((h) => h.food.id !== chosen.id && tokenize(h.food.name.split(',')[0])[0] === head).map((h) => h.food);
}
