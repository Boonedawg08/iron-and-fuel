import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALIASES } from '../src/lib/aliases';
import {
  bundledCount, getFoodByName, initBundledFoods, isConfident, resolveGrams, scaleNutrients, search, setUserFoods, stateNote,
} from '../src/lib/foodSearch';
import { parseMeal } from '../src/lib/parser';

beforeAll(() => {
  initBundledFoods(JSON.parse(readFileSync(new URL('../public/data/foods.json', import.meta.url), 'utf8')));
});

/** Parse a one-item description, match it, and convert to grams. */
function log(text: string) {
  const [item] = parseMeal(text);
  const hits = search(item.food);
  return { item, hit: hits[0], hits, ...resolveGrams(item, hits[0].food) };
}

describe('bundled USDA database', () => {
  it('loads Foundation + SR Legacy foods with macros', () => {
    expect(bundledCount()).toBeGreaterThan(7500);
    const f = getFoodByName('Bananas, raw')!;
    expect(f.n.kcal).toBe(89);
    expect(f.n.protein).toBeCloseTo(1.09, 2);
    expect(f.n.potassium).toBe(358);
    expect(f.portions.length).toBeGreaterThan(0);
  });
  it('every everyday-name alias points at a real food', () => {
    const missing = Object.entries(ALIASES).filter(([, name]) => !getFoodByName(name)).map(([k]) => k);
    expect(missing).toEqual([]);
  });
});

describe('matching', () => {
  const top = (q: string) => search(q)[0].food.name;
  it('matches the spec example to sensible foods', () => {
    expect(top('chicken breast')).toBe('Chicken, broilers or fryers, breast, meat only, cooked, roasted');
    expect(top('white rice')).toBe('Rice, white, long-grain, regular, enriched, cooked');
    expect(top('olive oil')).toBe('Oil, olive, salad or cooking');
  });
  it('matches common foods without an alias', () => {
    expect(top('raspberries')).toMatch(/^Raspberries, raw/);
    expect(top('cauliflower')).toMatch(/^Cauliflower, raw/);
    expect(top('feta cheese')).toMatch(/^Cheese, feta/);
    expect(top('pineapple')).toMatch(/^Pineapple, raw/);
    expect(top('kale')).toMatch(/^Kale, raw/);
    expect(top('asparagus')).toMatch(/^Asparagus, raw/);
  });
  it('respects raw / cooked when the user says so', () => {
    expect(top('raw chicken breast')).toMatch(/breast.*raw/);
    expect(top('raw white rice')).toMatch(/^Rice, white.*(raw|uncooked)/);
    expect(top('cooked broccoli')).toMatch(/^Broccoli.*cooked/);
    expect(top('cooked spinach')).toMatch(/^Spinach, cooked/);
  });
  it('tolerates plurals and typos', () => {
    expect(top('bananas')).toBe('Bananas, raw');
    expect(top('brocolli')).toMatch(/^Broccoli/);
    expect(top('avacado')).toMatch(/^Avocados/);
  });
  it('is confident on clear matches and not on poor ones', () => {
    expect(isConfident(search('chicken breast')[0])).toBe(true);
    expect(isConfident(search('raspberries')[0])).toBe(true);
    expect(isConfident(search('dragonfruit smoothie bowl')[0])).toBe(false);
    expect(isConfident(search('zzzzqq')[0])).toBe(false);
    expect(isConfident(search('chicken tikka masala')[0])).toBe(false);
  });
  it('searches custom foods too', () => {
    setUserFoods([{ id: 'custom:1', source: 'custom', name: 'Grandma lasagna', n: { kcal: 150, protein: 9, carbs: 14, fat: 6 }, portions: [{ label: 'slice', grams: 250 }] }]);
    expect(search('grandma lasagna')[0].food.id).toBe('custom:1');
    setUserFoods([]);
  });
});

describe('converting amounts to grams', () => {
  it('mass units convert directly', () => {
    expect(log('5oz chicken breast').grams).toBeCloseTo(141.7, 1);
    expect(log('100 grams of white rice').grams).toBe(100);
    expect(log('1 lb ground beef').grams).toBeCloseTo(453.6, 1);
  });
  it('volume units use the food\'s own USDA portion weights', () => {
    const oil = log('a tablespoon of olive oil');
    expect(oil.grams).toBe(13.5);
    expect(oil.approx).toBe(false);
    expect(log('2 tsp olive oil').grams).toBe(9);
    expect(log('1 cup white rice').grams).toBe(158);
    expect(log('1/2 cup white rice').grams).toBe(79);
    // tablespoon derived from the cup weight when USDA lists only cups
    expect(log('1 tbsp white rice').grams).toBeCloseTo(158 / 16, 1);
  });
  it('counts use per-food portion weights', () => {
    expect(log('2 eggs').grams).toBe(100); // 2 large eggs
    expect(log('3 large eggs').grams).toBe(150);
    expect(log('1 banana').grams).toBe(118); // medium
    expect(log('1 large banana').grams).toBe(136);
    expect(log('2 slices of bread').grams).toBeGreaterThan(40);
    expect(log('2 slices of bread').grams).toBeLessThan(80);
  });
  it('marks assumptions as approximate', () => {
    expect(log('chicken breast').approx).toBe(true); // no amount given
    expect(log('5oz chicken breast').approx).toBe(false);
  });
});

describe('nutrition math', () => {
  it('computes the spec example meal', () => {
    const items = parseMeal('5oz chicken breast with 100 grams of white rice and a tablespoon of olive oil');
    const totals = items.map((it) => {
      const food = search(it.food)[0].food;
      return scaleNutrients(food.n, resolveGrams(it, food).grams);
    });
    expect(totals[0].kcal).toBeCloseTo(233.8, 0); // 141.7 g x 165 kcal/100 g
    expect(totals[0].protein).toBeCloseTo(43.9, 0);
    expect(totals[1].kcal).toBeCloseTo(130, 0);
    expect(totals[2].kcal).toBeCloseTo(119.3, 0); // 13.5 g x 884
    expect(totals[2].fat).toBeCloseTo(13.5, 1);
  });
  it('states cooked vs raw assumptions', () => {
    const chicken = search('chicken breast')[0].food;
    expect(stateNote(chicken, 'chicken breast')).toMatch(/Assumed cooked weight/);
    expect(stateNote(search('raw chicken breast')[0].food, 'raw chicken breast')).toMatch(/raw values, as you described/);
    expect(stateNote(search('banana')[0].food, 'banana')).toMatch(/Assumed raw/);
  });
});
