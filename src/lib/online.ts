/** Online lookups for branded / packaged foods. Only used when the user asks; results are cached on use. */
import type { Food, Nutrients, Portion } from '../db';

const FDC_MAP: Record<string, keyof Nutrients> = {
  '208': 'kcal', '203': 'protein', '205': 'carbs', '204': 'fat', '291': 'fiber', '269': 'sugar', '307': 'sodium',
  '606': 'satFat', '601': 'cholesterol', '306': 'potassium', '301': 'calcium', '303': 'iron', '304': 'magnesium',
  '309': 'zinc', '401': 'vitC', '320': 'vitA', '328': 'vitD', '418': 'vitB12',
};
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_m, a, b) => a + b.toUpperCase());

async function getJson(url: string, timeoutMs = 12000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' } });
    if (res.status === 429) throw new Error('rate-limited');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

interface FdcFood {
  fdcId: number; description: string; brandName?: string; brandOwner?: string; servingSize?: number; servingSizeUnit?: string;
  householdServingFullText?: string; foodNutrients?: { nutrientNumber?: string; value?: number }[];
}
export function mapFdcFood(f: FdcFood): Food | null {
  const n: Nutrients = {};
  for (const fn of f.foodNutrients ?? []) {
    const key = fn.nutrientNumber ? FDC_MAP[fn.nutrientNumber] : undefined;
    if (key && typeof fn.value === 'number' && n[key] === undefined) n[key] = fn.value;
  }
  if (n.kcal === undefined) return null;
  const portions: Portion[] = [];
  const unit = (f.servingSizeUnit ?? '').toLowerCase();
  if (f.servingSize && (unit === 'g' || unit === 'grm' || unit === 'ml' || unit === 'mlt')) {
    portions.push({ label: `serving${f.householdServingFullText ? ` (${f.householdServingFullText.toLowerCase()})` : ''}`, grams: f.servingSize });
  }
  return {
    id: `fdc-api:${f.fdcId}`, source: 'fdc-api', name: titleCase(f.description), brand: f.brandName || f.brandOwner || undefined,
    n: { protein: 0, carbs: 0, fat: 0, ...n }, portions,
  };
}
export async function searchFdc(query: string, apiKey: string): Promise<Food[]> {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}&query=${encodeURIComponent(query)}&dataType=Branded&pageSize=20`;
  const json = (await getJson(url)) as { foods?: FdcFood[] };
  return (json.foods ?? []).map(mapFdcFood).filter((f): f is Food => f !== null);
}

interface OffProduct {
  code?: string; product_name?: string; brands?: string; serving_size?: string; serving_quantity?: number | string;
  nutriments?: Record<string, number | string | undefined>;
}
export function mapOffProduct(p: OffProduct): Food | null {
  const nm = p.nutriments ?? {};
  const num = (k: string): number | undefined => {
    const v = Number(nm[k]);
    return nm[k] === undefined || nm[k] === '' || Number.isNaN(v) ? undefined : v;
  };
  const kcal = num('energy-kcal_100g') ?? (num('energy_100g') !== undefined ? (num('energy_100g') as number) / 4.184 : undefined);
  if (!p.code || !p.product_name || kcal === undefined) return null;
  const n: Nutrients = { kcal: Math.round(kcal), protein: num('proteins_100g') ?? 0, carbs: num('carbohydrates_100g') ?? 0, fat: num('fat_100g') ?? 0 };
  const opt: [keyof Nutrients, string, number][] = [
    ['fiber', 'fiber_100g', 1], ['sugar', 'sugars_100g', 1], ['satFat', 'saturated-fat_100g', 1],
    ['sodium', 'sodium_100g', 1000], ['potassium', 'potassium_100g', 1000], ['calcium', 'calcium_100g', 1000],
    ['iron', 'iron_100g', 1000], ['cholesterol', 'cholesterol_100g', 1000], ['vitC', 'vitamin-c_100g', 1000],
  ]; // Open Food Facts stores minerals in grams; the app uses milligrams.
  for (const [key, field, mult] of opt) { const v = num(field); if (v !== undefined) n[key] = v * mult; }
  const sq = Number(p.serving_quantity);
  const portions: Portion[] = sq > 0 ? [{ label: `serving${p.serving_size ? ` (${p.serving_size})` : ''}`, grams: sq }] : [];
  return { id: `off:${p.code}`, source: 'off', name: p.product_name.trim(), brand: p.brands?.split(',')[0]?.trim() || undefined, n, portions };
}
const OFF_FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments';
export async function searchOff(query: string): Promise<Food[]> {
  const q = query.trim();
  if (/^\d{8,14}$/.test(q)) { // a barcode typed in
    const json = (await getJson(`https://world.openfoodfacts.org/api/v2/product/${q}.json?fields=${OFF_FIELDS}`)) as { product?: OffProduct };
    const f = json.product ? mapOffProduct({ ...json.product, code: json.product.code ?? q }) : null;
    return f ? [f] : [];
  }
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`;
  const json = (await getJson(url)) as { products?: OffProduct[] };
  return (json.products ?? []).map(mapOffProduct).filter((f): f is Food => f !== null);
}

export interface OnlineResult { foods: Food[]; errors: string[] }
/** Queries both services; one failing doesn't hide the other's results. */
export async function searchOnline(query: string, apiKey: string): Promise<OnlineResult> {
  const explain = (name: string, e: unknown): string => {
    const m = (e as Error).message;
    if (m === 'rate-limited') return `${name} is rate-limiting requests${name.startsWith('USDA') && !apiKey ? ' (add your own free API key in Settings)' : ''}.`;
    return `${name} could not be reached.`;
  };
  const [fdc, off] = await Promise.allSettled([searchFdc(query, apiKey), searchOff(query)]);
  const errors: string[] = [];
  if (fdc.status === 'rejected') errors.push(explain('USDA FoodData Central', fdc.reason));
  if (off.status === 'rejected') errors.push(explain('Open Food Facts', off.reason));
  return { foods: [...(fdc.status === 'fulfilled' ? fdc.value : []), ...(off.status === 'fulfilled' ? off.value : [])], errors };
}
