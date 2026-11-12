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
    expect(top('raw chicken breast')).toMatch(/breast, skinless, boneless, meat only, raw/);
    expect(top('raw salmon')).toMatch(/^Fish, salmon.*raw/);
    expect(top('fried chicken')).toMatch(/fried/);
    expect(top('smoked salmon')).toMatch(/smoked/);
    expect(top('raw white rice')).toMatch(/^Rice, white.*(raw|uncooked)/);
    expect(top('cooked broccoli')).toMatch(/^Broccoli.*cooked/);
    expect(top('cooked spinach')).toMatch(/^Spinach, cooked/);
  });
  it('tolerates plurals and typos', () => {
    expect(top('bananas')).toBe('Bananas, raw');
    expect(top('brocolli')).toMatch(/^Broccoli/);
    expect(top('avacado')).toMatch(/^Avocados/);
  });
  it('is confident on clear matches', () => {
    for (const q of ['chicken breast', 'white rice', 'olive oil', 'raspberries', 'kale', 'feta cheese', 'trout',
      'greek yogurt', 'scrambled eggs', 'eggs, scrambled', 'grilled salmon', 'steamed broccoli', 'cooked spinach']) {
      expect(isConfident(search(q)[0]), q).toBe(true);
    }
  });
  it('is never confident on doubtful matches', () => {
    // unknown food, missing words, typos, prefix guesses
    for (const q of ['dragonfruit smoothie bowl', 'zzzzqq', 'chicken tikka masala', 'brocolli', 'turkey sandwich']) {
      expect(isConfident(search(q)[0]), q).toBe(false);
    }
    // every word matches, but only as a side note of a different food
    expect(search('minestrone')[0].head).toBe(0);
    expect(isConfident(search('minestrone')[0])).toBe(false);
    // a bare generic name with many varieties: the pick is arbitrary, so it must be confirmed
    for (const q of ['cereal', 'cake', 'muffin', 'pork loin']) expect(isConfident(search(q)[0]), q).toBe(false);
  });
  it('does not confuse foods that share words', () => {
    expect(top('red wine')).toMatch(/^Alcoholic beverage, wine/);
    expect(top('red wine vinegar')).toMatch(/^Vinegar, red wine/);
    expect(top('soy sauce')).toMatch(/^Soy sauce/);
    expect(top('milk chocolate')).toMatch(/^Candies, milk chocolate/);
    expect(top('chocolate milk')).toMatch(/^Milk, chocolate/);
    expect(top('hot dog')).toMatch(/^Frankfurter/);
    expect(top('fried rice')).toMatch(/fried rice/);
    expect(top('potato')).toMatch(/^Potatoes/);
    expect(top('sweet potato')).toMatch(/^Sweet potato/);
    expect(top('peanut butter')).toMatch(/^Peanut butter/);
    expect(top('butter')).toMatch(/^Butter/);
    expect(top('cream cheese')).toMatch(/^Cheese, cream/);
    expect(top('heavy cream')).toMatch(/^Cream, /);
    expect(top('ribeye')).toMatch(/^Beef, rib eye/);
  });
  it('understands lean ratios and fat levels', () => {
    expect(top('85/15 ground beef')).toMatch(/^Beef, ground, 85% lean meat \/ 15% fat/);
    expect(top('93% lean ground turkey')).toMatch(/^Turkey, ground, 93% lean/i);
    expect(top('low fat cottage cheese')).toMatch(/^Cheese, cottage, lowfat/);
    expect(top('nonfat greek yogurt')).toMatch(/^Yogurt, Greek, plain, nonfat/);
    expect(top('2% milk')).toMatch(/^Milk, reduced fat, fluid, 2% milkfat/);
  });
  it('prefers the unsalted, plainly cooked entry', () => {
    expect(top('kidney beans')).toMatch(/without salt$/);
    expect(top('cooked broccoli')).toBe('Broccoli, cooked, boiled, drained, without salt');
  });
  it('searches custom and previously used foods too, and trusts them', () => {
    setUserFoods([
      { id: 'custom:1', source: 'custom', name: 'Grandma lasagna', n: { kcal: 150, protein: 9, carbs: 14, fat: 6 }, portions: [{ label: 'slice', grams: 250 }] },
      { id: 'off:123', source: 'off', name: 'Oreo Chocolate Sandwich Cookies', brand: 'Nabisco', n: { kcal: 480, protein: 5, carbs: 70, fat: 20 }, portions: [{ label: 'serving (3 cookies)', grams: 34 }] },
    ]);
    expect(search('grandma lasagna')[0].food.id).toBe('custom:1');
    expect(isConfident(search('grandma lasagna')[0])).toBe(true);
    expect(search('oreo cookies')[0].food.id).toBe('off:123');
    expect(isConfident(search('oreo cookies')[0])).toBe(true);
    expect(log('2 slices grandma lasagna').grams).toBe(500);
    expect(log('1 slice grandma lasagna').note).toMatch(/your food/);
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
    expect(log('5oz chicken breast').approx).toBe(false);
    expect(log('2 eggs').approx).toBe(false);
    expect(log('1 cup white rice').approx).toBe(false);
    expect(log('a handful of almonds').approx).toBe(true); // informal measure
    expect(log('1 cup greek yogurt').approx).toBe(true); // density borrowed from a similar food
    expect(log('1 large chicken breast').approx).toBe(true); // no "large" portion: used a plain breast
  });
  it('assumes one typical serving when no amount is given, and flags it', () => {
    const cases: [string, number, number][] = [
      ['chicken breast', 150, 200], ['steak', 80, 90], ['rice', 150, 170], ['banana', 110, 130], ['grapes', 100, 160],
      ['almonds', 25, 32], ['olive oil', 13, 14], ['peanut butter', 15, 34], ['milk', 240, 250], ['soy sauce', 14, 20],
      ['eggs', 44, 56], ['lettuce', 20, 120], ['turkey breast', 80, 200],
    ];
    for (const [text, lo, hi] of cases) {
      const r = log(text);
      expect(r.approx, text).toBe(true);
      expect(r.note, text).toMatch(/No amount given/);
      expect(r.grams, text).toBeGreaterThanOrEqual(lo);
      expect(r.grams, text).toBeLessThanOrEqual(hi);
    }
  });
  it('handles containers and drinks sensibly', () => {
    expect(log('glass of milk').grams).toBeGreaterThan(235);
    expect(log('glass of milk').grams).toBeLessThan(260);
    expect(log('1 glass red wine').grams).toBeCloseTo(147, 0); // a 5 fl oz serving, not a full cup
    expect(log('1 beer').grams).toBe(356); // one can
    expect(log('1 coffee').grams).toBeCloseTo(237, 0); // one cup
    expect(log('bowl of cheerios').grams).toBeLessThan(60); // by volume, not 300 g of dry cereal
    expect(log('1 cup couscous').grams).toBe(157); // cooked cup, not the "dry, yields" weight
    expect(log('1 cup strawberries').grams).toBeLessThan(180); // not the pureed cup
    expect(log('3 strips of bacon').grams).toBeCloseTo(24.3, 1);
    expect(log('1 slice of pizza').grams).toBeLessThan(200); // never the whole package
    expect(log('10 cherry tomatoes').grams).toBe(170);
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
    expect(stateNote(search('broccoli')[0].food, 'broccoli')).toMatch(/Assumed raw weight/);
    // cooked vs raw is not a real question for fruit, nuts, drinks...
    expect(stateNote(search('banana')[0].food, 'banana')).toBe('');
    expect(stateNote(search('almonds')[0].food, 'almonds')).toBe('');
  });
});
