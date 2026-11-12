/**
 * Meal-description parser: turns free text like
 *   "5oz chicken breast with 100 grams of white rice and a tablespoon of olive oil"
 * into structured items (quantity, unit, food). Pure functions, no I/O.
 */
import { isMassUnit, isVolumeUnit, type MassUnit, type VolumeUnit } from './units';

export type UnitKind = 'mass' | 'volume' | 'count';
export interface ParsedItem {
  /** The original text fragment for this item. */
  raw: string;
  qty: number;
  /** Canonical unit: a MassUnit, a VolumeUnit, a count word ("slice", "large"), or null for a bare count. */
  unit: MassUnit | VolumeUnit | string | null;
  kind: UnitKind;
  food: string;
  /** False when the text had no amount at all ("chicken and rice"). */
  qtyGiven: boolean;
}

const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g', gm: 'g', gms: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tblsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup', c: 'cup',
  'fl oz': 'floz', floz: 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz', 'fluid oz': 'floz',
};
/** Words that act as a counting unit; resolved to grams with the food's USDA portion weights. */
const COUNT_UNITS = [
  'slice', 'piece', 'clove', 'can', 'scoop', 'stick', 'handful', 'strip', 'link', 'patty', 'fillet', 'filet',
  'serving', 'bowl', 'glass', 'mug', 'bottle', 'packet', 'package', 'bar', 'stalk', 'leaf', 'sprig', 'pinch', 'dash',
  'head', 'ear', 'wedge', 'pat', 'container', 'bag', 'spear', 'floret', 'square', 'bunch',
];
const SIZE_UNITS = ['small', 'medium', 'large', 'jumbo', 'extra large', 'extra small'];

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, half: 0.5, quarter: 0.25,
};
const UNICODE_FRACTIONS: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};
/** Phrases whose "and"/"with" is part of the food name, not a separator. */
const PROTECTED = [
  'mac and cheese', 'macaroni and cheese', 'peanut butter and jelly', 'rice and beans', 'beans and rice',
  'half and half', 'salt and pepper', 'pork and beans', 'biscuits and gravy', 'fish and chips',
  'chicken and dumplings', 'cookies and cream', 'franks and beans', 'sweet and sour', 'ham and cheese',
  'bacon and eggs', 'spaghetti and meatballs', 'chips and salsa',
];
/** A fragment made only of these words describes the previous food ("1 cup rice, cooked"). */
const DESCRIPTORS = new Set([
  'cooked', 'raw', 'uncooked', 'dry', 'grilled', 'baked', 'roasted', 'fried', 'boiled', 'steamed', 'broiled', 'sauteed',
  'scrambled', 'poached', 'toasted', 'smoked', 'chopped', 'diced', 'sliced', 'shredded', 'mashed', 'drained', 'rinsed',
  'plain', 'unsalted', 'salted', 'skinless', 'boneless', 'lean', 'fresh', 'frozen', 'canned', 'whole', 'peeled',
  'unsweetened', 'sweetened', 'nonfat', 'lowfat', 'trimmed', 'melted', 'packed', 'heaping', 'level',
]);

const unitPattern = [...Object.keys(UNIT_ALIASES)].sort((a, b) => b.length - a.length).join('|');
const countPattern = COUNT_UNITS
  .map((u) => (u === 'leaf' ? 'leaves|leaf' : u.endsWith('y') ? `${u.slice(0, -1)}ies|${u}` : /(?:ch|sh|s|x)$/.test(u) ? `${u}es|${u}` : `${u}s|${u}`))
  .join('|');
const sizePattern = SIZE_UNITS.join('|');
const NUM = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+`;
const WORDNUM = Object.keys(NUMBER_WORDS).join('|');
const COUNTING_WORDS = Object.keys(NUMBER_WORDS).filter((w) => w !== 'a' && w !== 'an').join('|');

function wordToNum(w: string): number {
  return /^[\d.]/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? 1;
}

function normalize(text: string): string {
  let s = text.toLowerCase();
  for (const [ch, frac] of Object.entries(UNICODE_FRACTIONS)) s = s.replace(new RegExp(`(\\d)?${ch}`, 'g'), (_m, d) => (d ? `${d} ${frac}` : frac));
  s = s.replace(/[’‘]/g, "'").replace(/[“”"]/g, '');
  s = s.replace(/\bfl\.?\s*oz\b\.?/g, 'fl oz').replace(/\bw\/\s*/g, ' with ');
  // "1-1/2 cups" -> "1 1/2 cups"
  s = s.replace(/(\d+)-(\d+\/\d+)/g, '$1 $2');
  // Ranges take the midpoint: "3-4 oz", "2 to 3 eggs"
  s = s.replace(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*|\s+to\s+)(\d+(?:\.\d+)?)(?=\s*[a-z])/g, (_m, a, b) => String((Number(a) + Number(b)) / 2));
  // "8-oz steak" -> "8 oz steak"; "half-and-half" -> "half and half"
  s = s.replace(/(\d)-(?=[a-z])/g, '$1 ').replace(/([a-z])-(?=[a-z])/g, '$1 ');
  // "one and a half cups" / "2 and a half" -> 1.5 / 2.5 ; "a cup and a half of rice" -> "1.5 cup of rice"
  s = s.replace(new RegExp(String.raw`\b(\d+|${WORDNUM})\s+and\s+(?:a|one)\s+half\b`, 'g'), (_m, n) => String(wordToNum(n) + 0.5));
  s = s.replace(new RegExp(String.raw`\b(\d+|${WORDNUM})\s+(${unitPattern}|${countPattern})\s+and\s+(?:a|one)\s+half\b`, 'g'), (_m, n, u) => `${wordToNum(n) + 0.5} ${u}`);
  // Conversational filler
  s = s.replace(/\b(?:i|we)\s+(?:just\s+)?(?:had|ate|eat|drank|have)\b/g, ' ');
  s = s.replace(/\bfor\s+(?:breakfast|lunch|dinner|a snack|snack)\b/g, ' ');
  s = s.replace(/\b(?:today|this morning|tonight|about|around|approximately|roughly)\b/g, ' ');
  for (const p of PROTECTED) s = s.split(p).join(p.replace(/ /g, '_'));
  return s;
}

/** "1 1/2" | "3/4" | "2.5" | "two" -> number */
export function parseQuantity(s: string): number | null {
  const t = s.trim().toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  if (/^(\d*\.\d+|\d+)$/.test(t)) return Number(t);
  if (t in NUMBER_WORDS) return NUMBER_WORDS[t];
  return null;
}

function canonicalUnit(u: string): { unit: string; kind: UnitKind } {
  const key = u.replace(/\.$/, '').replace(/\s+/g, ' ');
  const alias = UNIT_ALIASES[key];
  if (alias) return { unit: alias, kind: isMassUnit(alias) ? 'mass' : isVolumeUnit(alias) ? 'volume' : 'count' };
  if (SIZE_UNITS.includes(key)) return { unit: key, kind: 'count' };
  if (key === 'leaves') return { unit: 'leaf', kind: 'count' };
  const singular = COUNT_UNITS.find((c) => key === c || key === c + 's' || key === c + 'es' || key === c.slice(0, -1) + 'ies');
  return { unit: singular === 'filet' ? 'fillet' : singular ?? key, kind: 'count' };
}

const cleanFood = (s: string): string =>
  s.replace(/_/g, ' ').replace(/^[\s\-–:.()]+|[\s\-–:.()]+$/g, '').replace(/^(?:of|the|some|my)\s+/, '').replace(/\s+/g, ' ').trim();

const LEAD = new RegExp(
  String.raw`^(?:(half|quarter)\s+(?:of\s+)?(?:a|an)\s+|(?:a|an)\s+(half|quarter)\s+(?:of\s+)?(?:a\s+|an\s+)?|(a couple(?: of)?|a few|couple(?: of)?)\s+|(?:(?:a|an)\s+)?(${NUM})(?![\d/]|\s*%)\s*(?:x\s+)?|(${WORDNUM})\s+)`,
);
const UNIT_AT_START = new RegExp(String.raw`^(?:(${unitPattern})\.?(?=\s|$)|(${countPattern})(?=\s|$)|(${sizePattern})(?=\s+\S))\s*(?:of\s+)?`);
/** "bowl of oatmeal", "glass of milk": a measure with no number means one of it. */
const UNIT_OF = new RegExp(String.raw`^(?:(${unitPattern})|(${countPattern}))\s+of\s+(?=\S)`);
const TRAIL = new RegExp(String.raw`^(.+?)[\s,(\-–:]+(${NUM})\s*(?:(${unitPattern})\.?|(${countPattern}))\)?$`);
const TRAIL_COUNT = new RegExp(String.raw`^(.+?)\s*(?:\(|x\s*|×\s*)(${NUM})\)?$`);
/** A fragment that is only an amount: "5 oz", "100g", "2 slices", "2 large", "3". */
const AMOUNT_ONLY = new RegExp(String.raw`^(?:(${NUM})|(${COUNTING_WORDS}))\s*(?:(${unitPattern})\.?|(${countPattern})|(${sizePattern}))?$`);

export function parseItem(fragment: string): ParsedItem | null {
  const raw = fragment.replace(/_/g, ' ').trim();
  let s = fragment.trim().replace(/^(?:and|with|plus|then|also)\s+/, '');
  if (!s) return null;

  let qty = 1;
  let qtyGiven = false;
  let unit: string | null = null;
  let kind: UnitKind = 'count';

  // "85/15 ground beef" is a lean-to-fat ratio, not a fraction.
  const ratio = s.match(/^(\d{2})\/(\d{1,2})(?!\d)/);
  const lead = ratio && Number(ratio[1]) + Number(ratio[2]) === 100 ? null : s.match(LEAD);
  if (lead) {
    const [all, halfA, aHalf, couple, num, word] = lead;
    if (halfA || aHalf) qty = NUMBER_WORDS[halfA || aHalf];
    else if (couple) qty = couple.includes('few') ? 3 : 2;
    else if (num) qty = parseQuantity(num) ?? 1;
    else if (word) qty = NUMBER_WORDS[word];
    qtyGiven = true;
    s = s.slice(all.length);
    // "a dozen eggs", "2 dozen eggs", "half a dozen eggs"
    const dz = s.match(/^dozen\s+/);
    if (dz) { qty *= 12; s = s.slice(dz[0].length); }
    const um = s.match(UNIT_AT_START);
    if (um && s.length > um[0].length) {
      ({ unit, kind } = canonicalUnit(um[1] ?? um[2] ?? um[3]));
      s = s.slice(um[0].length);
    }
  } else {
    const uo = s.match(UNIT_OF);
    // Amount at the end: "chicken breast 5oz", "white rice (100 g)", "bread 2 slices", "eggs x2"
    const tm = uo ? null : s.match(TRAIL);
    const tc = uo || tm ? null : s.match(TRAIL_COUNT);
    if (uo) {
      ({ unit, kind } = canonicalUnit(uo[1] ?? uo[2]));
      s = s.slice(uo[0].length);
      qtyGiven = true;
    } else if (tm) {
      qty = parseQuantity(tm[2]) ?? 1;
      ({ unit, kind } = canonicalUnit(tm[3] ?? tm[4]));
      s = tm[1];
      qtyGiven = true;
    } else if (tc) {
      qty = parseQuantity(tc[2]) ?? 1;
      s = tc[1];
      qtyGiven = true;
    }
  }

  const food = cleanFood(s);
  if (!food || !/[a-z]/.test(food) || food in UNIT_ALIASES) return null;
  return { raw, qty, unit, kind, food, qtyGiven };
}

/** Split a meal description into items and parse each one. */
export function parseMeal(text: string): ParsedItem[] {
  const fragments = normalize(text)
    .split(/\s*(?:[,;\n+&]|\band\b|\bwith\b|\bplus\b|\balong with\b|\bon top of\b)\s*/)
    .map((part) => part.replace(/[.!]+$/, '').trim())
    .filter(Boolean);

  const items: ParsedItem[] = [];
  for (const frag of fragments) {
    const prev = items[items.length - 1];
    // "chicken breast, 5 oz": the amount arrived as its own fragment and belongs to the food before it.
    const am = frag.match(AMOUNT_ONLY);
    if (am) {
      if (prev && !prev.qtyGiven) {
        prev.qty = parseQuantity(am[1] ?? am[2]) ?? 1;
        const u = am[3] ?? am[4] ?? am[5];
        if (u) ({ unit: prev.unit, kind: prev.kind } = canonicalUnit(u));
        prev.qtyGiven = true;
        prev.raw += `, ${frag}`;
      }
      continue;
    }
    // "1 cup rice, cooked": a bare description belongs to the food before it.
    if (prev && frag.split(/\s+/).every((w) => DESCRIPTORS.has(w))) {
      prev.food += ` ${frag}`;
      prev.raw += `, ${frag}`;
      continue;
    }
    const item = parseItem(frag);
    if (item) items.push(item);
  }
  return items;
}
