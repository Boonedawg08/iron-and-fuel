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

export type FoodState = 'cooked' | 'raw' | null;
interface Indexed {
  food: Food;
  /** Each token of the name -> index of the comma-segment it first appears in (brand words count as 0). */
  seg: Map<string, number>;
  /** Tokens of the first comma-segment: the food's main noun ("Rice", "Oil", "Peanut butter"). */
  head1: string[];
  /** When head1 is only a group word ("Fish", "Nuts", "Cheese"): the second segment, which names the food. */
  head2: string[];
  /** Tokens that make this entry a particular variety (everything except USDA boilerplate). */
  distinct: string[];
  state: FoodState;
  user: boolean;
}

const STOP = new Set(['of', 'the', 'a', 'an', 'or', 'and', 'with', 'in', 'to', 'for', 'from', 'some', 'my', 'fresh', 'plain', 'regular']);
const COOKED_WORDS = ['cooked', 'roasted', 'broiled', 'grilled', 'baked', 'boiled', 'fried', 'steamed', 'braised', 'stewed', 'toasted', 'microwaved', 'sauteed', 'scrambled', 'poached', 'smoked', 'browned', 'rotisserie', 'heated'];
const RAW_WORDS = ['raw', 'uncooked', 'unprepared', 'dry', 'unheated'];
const STATE_WORDS = new Set([...COOKED_WORDS, ...RAW_WORDS]);
/** What users type -> USDA wording that means the same thing, with how strongly it counts (0..1). */
const SYNONYMS: Record<string, [string, number][]> = {
  grilled: [['broiled', 0.9], ['cooked', 0.75]], baked: [['roasted', 0.9], ['cooked', 0.75]], roasted: [['baked', 0.9], ['cooked', 0.75]],
  sauteed: [['fried', 0.9], ['cooked', 0.75]], fried: [['cooked', 0.75]], boiled: [['cooked', 0.75]], steamed: [['boiled', 0.9], ['cooked', 0.75]],
  broiled: [['grilled', 0.9], ['cooked', 0.75]], poached: [['boiled', 0.9], ['cooked', 0.75]], toasted: [['cooked', 0.75]],
  uncooked: [['raw', 1], ['dry', 0.9]], dry: [['raw', 0.9], ['uncooked', 1]], raw: [['uncooked', 1], ['unprepared', 0.9]],
  skim: [['nonfat', 1]], nonfat: [['skim', 1]], lowfat: [['reduced', 0.9]], wholewheat: [['wheat', 0.9]],
  garbanzo: [['chickpea', 1]], yoghurt: [['yogurt', 1]], prawn: [['shrimp', 1]], ketchup: [['catsup', 1]],
  coke: [['cola', 1]], soda: [['cola', 0.9]], donut: [['doughnut', 1]], mayo: [['mayonnaise', 1]],
  fry: [['french', 0.9], ['fried', 0.9]], hamburger: [['beef', 0.9], ['ground', 0.9]], skinless: [['meat', 0.9]], boneless: [['meat', 0.9]],
  bbq: [['barbecue', 1]], mac: [['macaroni', 1]], omelette: [['omelet', 1]], flax: [['flaxseed', 1]], chilli: [['chili', 1]],
  aubergine: [['eggplant', 1]], courgette: [['zucchini', 1]], cilantro: [['coriander', 1]], coriander: [['cilantro', 1]],
  soya: [['soy', 1]], filet: [['fillet', 1]], fillet: [['filet', 1]], veggie: [['vegetable', 0.9]],
};
/** Preparation words that can be dropped to find an everyday-name shortcut ("grilled chicken" -> "chicken").
 *  Fried and smoked are left out: they are different foods, not just a way of heating. */
const MILD_STATE = new Set([...STATE_WORDS].filter((w) => w !== 'fried' && w !== 'smoked' && w !== 'browned'));
/** Variants nobody means unless they say so. */
const VARIANT_WORDS = new Set(['canned', 'frozen', 'dried', 'dehydrated', 'powder', 'juice', 'flour', 'concentrate', 'syrup',
  'imitation', 'substitute', 'giblet', 'liver', 'babyfood', 'infant', 'bran', 'germ', 'sprouted', 'pickled', 'candied',
  'nectar', 'leaf', 'mix', 'oil', 'restaurant', 'breaded', 'batter', 'battered', 'fried', 'smoked', 'sauce', 'soup', 'chip',
  'snack', 'bar', 'spread', 'drink']);
/** USDA boilerplate that does not make an entry a different food ("cooked, boiled, drained, without salt"). */
const NEUTRAL_WORDS = new Set([...STATE_WORDS, 'without', 'salt', 'added', 'drained', 'all', 'commercial', 'commercially',
  'variety', 'year', 'round', 'average', 'include', 'enriched', 'unenriched', 'solid', 'mature', 'seed', 'type',
  'style', 'grade', 'trimmed', 'separable', 'lean', 'only', 'meat', 'boneless', 'vitamin', 'd', 'fluid', 'milkfat', 'heat',
  'moist', 'prepared', 'water', 'ready', 'serve', 'made', 'flesh', 'ripe', 'broiler', 'fryer', 'retail', 'choice', 'select',
  'usda', 'commodity', 'fat', 'class', 'mixed', 'specy', 'winter', 'summer', 'home', 'recipe', 'kernel', 'brewed',
  'patty', 'crumble', 'loaf']);
/** USDA group words people don't say: "salmon" should match "Fish, salmon" through its second segment. */
const GROUP_HEADS = new Set(['nut', 'fish', 'crustacean', 'mollusk', 'seed', 'spice', 'cereal', 'ready', 'eat', 'beverage', 'alcoholic', 'snack', 'candy', 'cheese']);
const DEFAULT_COOKED = /Poultry|Beef|Pork|Finfish|Lamb|Cereal Grains|Legumes|Sausages/;
const DEFAULT_RAW = /Fruits|Vegetables|Nut and Seed/;
/** Where "cooked or raw?" is not a meaningful question. */
const NO_STATE_NOTE = /Fruits|Nut and Seed|Beverages|Sweets|Snacks|Baked Products|Fats and Oils|Spices/;
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
  return text.toLowerCase()
    .replace(/whole[- ]wheat/g, 'wholewheat')
    .replace(/\blow[- ]?fat\b/g, 'lowfat')
    .replace(/\b(?:non[- ]?fat|fat[- ]free)\b/g, 'nonfat')
    // "85/15 ground beef" -> "85% 15%", the way USDA writes lean-to-fat ratios
    .replace(/\b(\d{2})\s*\/\s*(\d{1,2})\b/g, (m, a, b) => (Number(a) + Number(b) === 100 ? `${a}% ${b}%` : m))
    .replace(/['’]/g, '')
    .split(/[^a-z0-9%]+/).filter((t) => t && !STOP.has(t)).map(stem);
}
/** Everyday-name shortcuts, keyed by their stemmed words in order ("milk chocolate" is not "chocolate milk")... */
const uniq = (tokens: string[]): string[] => [...new Set(tokens)];
const ALIAS_ORDERED = new Map(Object.entries(ALIASES).map(([k, name]) => [uniq(tokenize(k)).join(' '), name]));
/** ...and in any order ("eggs, scrambled" = "scrambled eggs"), kept only where the reordering is unambiguous. */
const sortedKey = (tokens: string[]): string => [...tokens].sort().join(' ');
const ALIAS_SORTED = new Map<string, string | null>();
for (const [k, name] of Object.entries(ALIASES)) {
  const key = sortedKey(uniq(tokenize(k)));
  ALIAS_SORTED.set(key, ALIAS_SORTED.has(key) && ALIAS_SORTED.get(key) !== name ? null : name);
}
const aliasFor = (tokens: string[]): string | undefined =>
  tokens.length ? ALIAS_ORDERED.get(tokens.join(' ')) ?? ALIAS_SORTED.get(sortedKey(tokens)) ?? undefined : undefined;

function stateOf(name: string): FoodState {
  const t = new Set(tokenize(name));
  if (COOKED_WORDS.some((w) => t.has(w))) return 'cooked';
  if (RAW_WORDS.some((w) => t.has(w))) return 'raw';
  return null;
}
/** Preparation state of a food, used for the cooked/raw note on confirmation cards. */
export function foodState(food: Food): FoodState { return stateOf(food.name); }

function indexFood(food: Food, user: boolean): Indexed {
  const segs = food.name.split(',').map(tokenize).filter((x) => x.length > 0);
  const seg = new Map<string, number>();
  segs.forEach((toks, i) => toks.forEach((t) => { if (!seg.has(t)) seg.set(t, i); }));
  for (const t of tokenize(food.brand ?? '')) if (!seg.has(t)) seg.set(t, 0);
  const head1 = [...new Set(segs[0] ?? [])];
  const group = head1.length > 0 && head1.every((t) => GROUP_HEADS.has(t));
  return {
    food, seg, head1, head2: group ? [...new Set(segs[1] ?? [])] : [],
    distinct: [...seg.keys()].filter((t) => !NEUTRAL_WORDS.has(t) && !GROUP_HEADS.has(t) && !/^\d+%?$/.test(t)),
    state: stateOf(food.name), user,
  };
}

let bundled: Indexed[] = [];
let userFoods: Indexed[] = [];
let byId = new Map<string, Food>();
let byName = new Map<string, Food>();
let vocab: string[] = [];
let vocabSet = new Set<string>();

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
  vocabSet = new Set<string>();
  for (const ix of [...bundled, ...userFoods]) {
    byId.set(ix.food.id, ix.food);
    const prev = byName.get(ix.food.name);
    if (!prev || ix.food.portions.length > prev.portions.length) byName.set(ix.food.name, ix.food);
    for (const t of ix.seg.keys()) vocabSet.add(t);
  }
  vocab = [...vocabSet];
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
  for (const [s, w] of SYNONYMS[q] ?? []) put(s, w);
  const exact = vocabSet.has(q);
  for (const v of vocab) {
    if (v === q) continue;
    if (q.length >= 3 && v.startsWith(q)) put(v, 0.8); // "blue" ~ "blueberry": a guess, never "sure"
    else if (v.length >= 4 && q.startsWith(v) && q.length - v.length <= 3) put(v, 0.7);
    else if (!exact && q.length >= 5) { // typo tolerance, only for words the database has never seen
      const max = q.length >= 8 ? 2 : 1;
      if (editDistance(q, v, max) <= max) put(v, 0.6);
    }
  }
  return out;
}
/** A match strength that counts as certain (exact word or true synonym), as opposed to prefix / typo guesses. */
const SURE = 0.9;

export interface SearchHit {
  food: Food;
  /** 0..1 overall ranking score. */
  score: number;
  /** Share of the query's words found for certain in the food name (1 = all of them). */
  coverage: number;
  /** 0..1: how much of the food's main noun the query named. 0 means the query only hit side words. */
  head: number;
  /** How many words in the food's name make it a particular variety you did not ask for. */
  extras: number;
  /** A food you created, or an online food you have used before. */
  own?: boolean;
  viaAlias?: boolean;
}

export function search(query: string, limit = 12): SearchHit[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];
  const cands = qTokens.map(candidates);
  const isState = qTokens.map((t) => STATE_WORDS.has(t));
  const weights = isState.map((s) => (s ? 0.5 : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const qSet = new Set(qTokens);
  const wantsState: FoodState = qTokens.some((t) => RAW_WORDS.includes(t)) ? 'raw' : qTokens.some((t) => COOKED_WORDS.includes(t)) ? 'cooked' : null;
  // Words early in a name say what the food is; words deep in it are details ("..., made with soy sauce").
  const POS = [1, 0.9, 0.8, 0.7];
  // How much of a head phrase was named, with its first words counting most.
  const headShare = (head: string[], matched: Set<string>): number => {
    let hit = 0, all = 0;
    head.forEach((t, i) => { const w = 0.5 ** i; all += w; if (matched.has(t)) hit += w; });
    return all ? hit / all : 0;
  };

  const hits: SearchHit[] = [];
  for (const ix of [...userFoods, ...bundled]) {
    let got = 0, sure = 0;
    const matched = new Set<string>();
    for (let i = 0; i < qTokens.length; i++) {
      let best = 0, bestSeg = 99, bestTok = '';
      for (const [tok, w] of cands[i]) {
        const sg = ix.seg.get(tok);
        if (sg === undefined) continue;
        if (w > best || (w === best && sg < bestSeg)) { best = w; bestSeg = sg; bestTok = tok; }
      }
      if (!best) continue;
      matched.add(bestTok);
      got += best * weights[i] * (POS[bestSeg] ?? 0.5);
      // "grilled" matching a "cooked" entry is an accepted approximation, not a doubtful match.
      if (best >= SURE || (isState[i] && best >= 0.75)) sure += weights[i];
    }
    if (got === 0) continue;

    let head = headShare(ix.head1, matched);
    if (head === 0 && ix.head2.length) head = 0.9 * headShare(ix.head2, matched);

    let score = 0.62 * (got / totalW) + 0.2 * head;
    // Prefer the plain entry: every unasked-for word that makes this a particular variety costs a little.
    const extras = ix.distinct.reduce((n, t) => n + (matched.has(t) ? 0 : 1), 0);
    score += 0.18 * Math.max(0, 1 - extras / 6);
    for (const t of ix.seg.keys()) if (VARIANT_WORDS.has(t) && !qSet.has(t) && !matched.has(t)) score -= 0.05;
    if (ix.seg.has('salt') && !ix.seg.has('without') && !qSet.has('salt') && !qSet.has('salted')) score -= 0.01;
    if (!wantsState && ix.state) {
      const cat = ix.food.category ?? '';
      const def: FoodState = DEFAULT_COOKED.test(cat) ? 'cooked' : DEFAULT_RAW.test(cat) ? 'raw' : null;
      if (def) score += ix.state === def ? 0.05 : -0.05;
    }
    if (wantsState && ix.state && ix.state !== wantsState) score -= 0.15;
    const pen = PENALIZED_CATEGORY[ix.food.category ?? ''];
    if (pen) score -= pen;
    if (ix.user) score += 0.05; // foods you created or used before
    hits.push({ food: ix.food, score, coverage: sure / totalW, head, extras, own: ix.user });
  }
  // Sort on the unclamped score so tiny preferences (e.g. "without salt") still break ties, then clamp for display.
  hits.sort((a, b) => b.score - a.score || a.food.name.length - b.food.name.length);
  for (const h of hits) h.score = Math.max(0, Math.min(1, h.score));

  // Everyday-name shortcut ("chicken breast" -> the roasted, meat-only entry).
  const fullAlias = aliasFor(qTokens);
  const aliasName = fullAlias ?? aliasFor(qTokens.filter((t) => !MILD_STATE.has(t)));
  const aliasFood = aliasName ? byName.get(aliasName) : undefined;
  if (aliasFood) {
    const st = stateOf(aliasFood.name);
    const compatible = !!fullAlias || !wantsState || !st || st === wantsState;
    const top = hits[0];
    const ownFoodWins = !!top && top.food.source !== 'usda' && top.coverage >= 0.999 && top.score > 0.9;
    if (compatible && !ownFoodWins) {
      const rest = hits.filter((h) => h.food.id !== aliasFood.id);
      return [{ food: aliasFood, score: 0.97, coverage: 1, head: 1, extras: 0, viaAlias: true }, ...rest].slice(0, limit);
    }
  }
  return hits.slice(0, limit);
}

/**
 * A match is trusted only when it is a curated everyday name, or when every word was found for
 * certain, the food's main noun is one of them, and the entry is the plain version (no extra
 * variety words such as "chinese", "smoked", "reduced fat"). Foods you created or have used before
 * are trusted on a full match. Anything else must be confirmed by the user before saving.
 */
export const CONFIDENT_SCORE = 0.72;
export function isConfident(hit: SearchHit | undefined): boolean {
  if (!hit) return false;
  if (hit.viaAlias) return true;
  return hit.coverage >= 0.999 && hit.head > 0 && hit.score >= CONFIDENT_SCORE && (hit.extras === 0 || !!hit.own);
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

/** Reads a volume out of a portion label: "cup, chopped", "serving 1/2 cup", "drink (16 fl oz)". */
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
  const loose = vols.filter((x) => !/pureed|mashed|packed|crushed|melted|whipped|ground|\bdry\b|yield|uncooked|unpopped|unprepared|with hull|with pits|with shell|in shell/.test(x.p.label.toLowerCase()));
  const pool = loose.length ? loose : vols;
  const pick = pool.find((x) => x.v!.unit === prefer) ?? pool[0];
  return { gPerMl: pick.p.grams / (pick.v!.amount * VOLUME_ML[pick.v!.unit]), portion: pick.p };
}

/** Informal containers, as a volume in ml, used when the food has no portion of that name. */
const CONTAINER_ML: Record<string, number> = { glass: 240, mug: 240, bowl: 355, bottle: 500, can: 355 };
/** Rough weights for informal measures when the food has no matching portion. */
const GENERIC_COUNT_G: Record<string, number> = { handful: 30, scoop: 30, pinch: 0.4, dash: 0.6, pat: 5 };
const COUNT_SYNONYMS: Record<string, string[]> = { strip: ['slice'], piece: ['slice'], slice: ['piece'], fillet: ['filet'], bottle: ['can'], mug: ['cup'] };

export interface GramResult {
  grams: number;
  /** True when the amount rests on an assumption rather than this food's own data. Must be confirmed. */
  approx: boolean;
  /** How the amount was converted, shown on the confirmation card. */
  note: string;
}
const r1 = (n: number): number => Math.round(n * 10) / 10;
/** Where a portion weight came from, for the note. */
const sourceOf = (food: Food): string => (food.source === 'usda' ? 'USDA' : food.source === 'custom' ? 'your food' : 'package label');

/** Pick the portion people mean by "1 banana" / "2 eggs" / "a chicken breast". */
export function defaultCountPortion(food: Food, foodQuery = ''): Portion | null {
  const q = new Set(tokenize(foodQuery));
  const head = tokenize(food.name.split(',')[0]);
  let best: Portion | null = null, bestScore = -1;
  for (const p of food.portions) {
    const l = p.label.toLowerCase();
    if (volumeOfLabel(l) || MASS_LABEL.test(l)) continue;
    let s = 0.5;
    const ltok = tokenize(l.replace(/\(.*?\)/g, ''));
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

type Amount = Pick<ParsedItem, 'qty' | 'unit' | 'kind' | 'food' | 'qtyGiven'>;

function fromVolume(qty: number, ml: number, what: string, food: Food, siblings: Food[], prefer?: VolumeUnit, assumed = false): GramResult {
  const own = densityOf(food, prefer);
  if (own) {
    const grams = r1(qty * ml * own.gPerMl);
    return {
      grams, approx: assumed,
      note: `${what} = ${grams} g (${sourceOf(food)}: ${own.portion.label} = ${own.portion.grams} g)${assumed ? '. Check the amount.' : ''}`,
    };
  }
  for (const sib of siblings) {
    const d = densityOf(sib, prefer);
    if (!d) continue;
    const grams = r1(qty * ml * d.gPerMl);
    return { grams, approx: true, note: `No volume data for this exact food, so used "${sib.name}" (${d.portion.label} = ${d.portion.grams} g): ${what} = ${grams} g. Check the amount.` };
  }
  const grams = r1(qty * ml);
  return { grams, approx: true, note: `No volume data for this food, so assumed 1 g per ml (like water): ${what} = ${grams} g. Check the amount.` };
}

/**
 * Convert a parsed amount to grams for a specific food.
 * @param siblings other close matches for the same text; their volume data is borrowed
 *   (and flagged approximate) when the chosen food has none.
 */
export function resolveGrams(item: Amount, food: Food, siblings: Food[] = []): GramResult {
  const { qty, unit } = item;
  const src = sourceOf(food);

  if (unit && isMassUnit(unit)) {
    const grams = r1(massToGrams(qty, unit));
    return { grams, approx: false, note: unit === 'g' ? '' : `${qty} ${unit} = ${grams} g` };
  }
  if (unit && isVolumeUnit(unit)) return fromVolume(qty, VOLUME_ML[unit], `${qty} ${unit}`, food, siblings, unit);

  if (unit) {
    // A portion with that name on this food: "2 slices", "1 large", "1 can".
    for (const u of [stem(unit), ...(COUNT_SYNONYMS[unit] ?? [])]) {
      const hit = food.portions.find((p) => tokenize(p.label)[0] === u)
        ?? food.portions.find((p) => tokenize(p.label.replace(/\(.*?\)/g, '')).includes(u));
      if (hit) return { grams: r1(qty * hit.grams), approx: false, note: `${qty} × ${hit.label} (${hit.grams} g each, ${src})` };
    }
    // "a glass of milk", "a bowl of soup": a typical serving if the food lists one, else a typical container size.
    const ml = CONTAINER_ML[unit];
    if (ml) {
      const serving = food.portions.find((p) => /^serving\b/.test(p.label.toLowerCase()));
      if (serving) return { grams: r1(qty * serving.grams), approx: true, note: `Assumed 1 ${unit} = ${serving.label} (${serving.grams} g, ${src}). Check the amount.` };
      return fromVolume(qty, ml, `${qty} ${unit} (assumed ${ml} ml each)`, food, siblings, 'cup', true);
    }
    const generic = GENERIC_COUNT_G[unit];
    if (generic) return { grams: r1(qty * generic), approx: true, note: `No "${unit}" weight for this food, so assumed about ${generic} g per ${unit}. Check the amount.` };
  }

  // No amount at all ("chicken and rice"): assume one typical serving, never a whole roast or a single grape.
  if (!unit && !item.qtyGiven) return typicalServing(food, item.food);

  const def = defaultCountPortion(food, item.food);
  if (def) {
    const why = unit ? `No "${unit}" weight for this food, so used` : 'Used';
    return { grams: r1(qty * def.grams), approx: !!unit, note: `${why} ${qty} × ${def.label} (${def.grams} g each, ${src})${unit ? '. Check the amount.' : ''}` };
  }
  // Drinks, sauces and the like only list volumes: one of them is taken as one household measure.
  const hm = householdMeasure(food);
  if (hm) return { grams: r1(qty * hm.grams), approx: true, note: `No single-item weight for this food, so assumed ${qty} × ${hm.label} (${hm.grams} g each, ${src}). Check the amount.` };
  return { grams: r1(qty * 100), approx: true, note: 'No portion weight for this food, so assumed 100 g each. Check the amount.' };
}

/** Foods normally used by the spoonful rather than the cupful. */
const SPOONABLE = /sauce|dressing|catsup|ketchup|mustard|syrup|honey|jam|jell|butter|\boil\b|mayonnaise|cream|spread|vinegar|relish|paste|salsa|hummus|gravy|margarine|shortening|molasses/i;
/** One household measure of a food that lists only volumes: a spoonful for sauces, oils and spices, a cup otherwise. */
function householdMeasure(food: Food): Portion | null {
  const vols = food.portions.map((p) => ({ p, v: volumeOfLabel(p.label) })).filter((x) => x.v && x.v.amount === 1);
  const pick = (u: VolumeUnit): Portion | undefined => vols.find((x) => x.v!.unit === u)?.p;
  if (/Spices/.test(food.category ?? '')) return pick('tsp') ?? pick('tbsp') ?? null;
  if (SPOONABLE.test(food.name)) { const spoon = pick('tbsp') ?? pick('tsp'); if (spoon) return spoon; }
  const cup = densityOf(food, 'cup');
  if (cup && volumeOfLabel(cup.portion.label)?.unit === 'cup') return cup.portion;
  const floz = pick('floz');
  if (floz) return { label: '8 fl oz', grams: r1(floz.grams * 8) };
  return pick('tbsp') ?? pick('tsp') ?? null;
}

const MEAT_CATEGORY = /Poultry|Beef|Pork|Finfish|Lamb|Sausages/;
/** What "some chicken" or "rice" most plausibly means when no amount was typed. Always flagged for confirmation. */
function typicalServing(food: Food, query: string): GramResult {
  const src = sourceOf(food);
  const cat = food.category ?? '';
  const say = (grams: number, what: string): GramResult => ({ grams: r1(grams), approx: true, note: `No amount given, so assumed ${what}. Check the amount.` });
  const one = (p: Portion): GramResult => say(p.grams, `1 ${p.label} (${p.grams} g, ${src})`);

  const serving = food.portions.find((p) => /^(?:nlea )?serving\b/.test(p.label.toLowerCase()) && p.grams <= 400);
  if (serving) return one(serving);
  const def = defaultCountPortion(food, query);
  const meat = MEAT_CATEGORY.test(cat);
  // One grape or one almond is not a serving, but one clove, slice or stalk is.
  const naturalUnit = !!def && /^(?:clove|slice|stalk|spear|strip|pat|stick|link|patty|wedge|ring)\b/.test(def.label.toLowerCase());
  if (def && (def.grams >= (meat ? 5 : 20) || naturalUnit) && def.grams <= (meat ? 250 : 400)) return one(def);
  if (meat) return say(85, 'a 3 oz (85 g) serving');
  const oz = food.portions.find((p) => /^oz\b/.test(p.label.toLowerCase()));
  if (oz && /Nut and Seed|Snacks|Sweets/.test(cat)) return say(oz.grams, `1 oz (${oz.grams} g)`);
  const hm = householdMeasure(food);
  if (hm) return one(hm);
  if (oz) return say(oz.grams, `1 oz (${oz.grams} g)`);
  return say(100, '100 g');
}

/** Sentence about cooked vs raw weight for the confirmation card ('' when it doesn't matter). */
export function stateNote(food: Food, userText: string): string {
  const st = foodState(food);
  if (!st || NO_STATE_NOTE.test(food.category ?? '')) return '';
  const said = tokenize(userText).some((t) => STATE_WORDS.has(t));
  const what = st === 'cooked' ? 'cooked' : /\bdry\b|uncooked/i.test(food.name) ? 'dry, uncooked' : 'raw';
  if (said) return `Using ${what} values, as you described.`;
  return `Assumed ${what} weight (you didn't say). If you weighed it ${st === 'cooked' ? 'raw' : 'cooked'}, swap the match.`;
}

/** Close matches that share the chosen food's first word; used to borrow volume data. */
export function siblingsOf(hits: SearchHit[], chosen: Food): Food[] {
  const head = tokenize(chosen.name.split(',')[0])[0];
  return hits.filter((h) => h.food.id !== chosen.id && tokenize(h.food.name.split(',')[0])[0] === head).map((h) => h.food);
}
