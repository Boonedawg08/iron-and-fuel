import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapFdcFood, mapOffProduct, type FdcFood, type OffProduct } from '../src/lib/online';

const fixture = <T>(name: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as T;

describe('USDA FoodData Central search results', () => {
  const { foods } = fixture<{ foods: FdcFood[] }>('fdc-search.json');

  it('maps a branded food to per-100 g nutrients', () => {
    const f = mapFdcFood(foods[0])!;
    expect(f.id).toBe('fdc-api:9990001');
    expect(f.source).toBe('fdc-api');
    expect(f.name).toBe('Chocolate Sandwich Cookies');
    expect(f.brand).toBe('EXAMPLE');
    expect(f.n).toMatchObject({ kcal: 471, protein: 5.88, carbs: 73.5, fat: 20.6, fiber: 2.9, sugar: 41.2, sodium: 397, satFat: 5.88 });
  });
  it('keeps the label serving as a portion', () => {
    expect(mapFdcFood(foods[0])!.portions).toEqual([{ label: 'serving (3 cookies)', grams: 34 }]);
  });
  it('skips foods with no calorie value', () => {
    expect(mapFdcFood(foods[1])).toBeNull();
  });
  it('also understands the abridged nutrient format (number / amount)', () => {
    const f = mapFdcFood({ fdcId: 1, description: 'PLAIN YOGURT', foodNutrients: [{ number: '208', amount: 61 }, { number: 203, amount: 3.5 }] })!;
    expect(f.n.kcal).toBe(61);
    expect(f.n.protein).toBe(3.5);
    expect(f.n.carbs).toBe(0); // macros default to 0 so totals never become NaN
  });
  it('falls back to Atwater energy codes', () => {
    expect(mapFdcFood({ fdcId: 2, description: 'X', foodNutrients: [{ nutrientNumber: '958', value: 120 }] })!.n.kcal).toBe(120);
  });
});

describe('Open Food Facts products (real response)', () => {
  const off = fixture<{ product: { product: OffProduct }; search: { products: OffProduct[] } }>('openfoodfacts.json');

  it('maps a barcode lookup', () => {
    const f = mapOffProduct(off.product.product)!;
    expect(f.id).toBe('off:3017620422003');
    expect(f.source).toBe('off');
    expect(f.name).toBe('Nutella');
    expect(f.brand).toBe('Ferrero');
    expect(f.n).toMatchObject({ kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, sugar: 56.3, satFat: 10.6, fiber: 0 });
  });
  it('converts sodium from grams to milligrams', () => {
    expect(mapOffProduct(off.product.product)!.n.sodium).toBeCloseTo(42.8, 5);
  });
  it('maps every product in a search response', () => {
    const foods = off.search.products.map(mapOffProduct);
    expect(foods.every((f) => f !== null && f.n.kcal !== undefined)).toBe(true);
  });
  it('handles missing serving data and missing energy', () => {
    expect(mapOffProduct(off.product.product)!.portions).toEqual([]);
    expect(mapOffProduct({ code: '1', product_name: 'No label', nutriments: {} })).toBeNull();
    expect(mapOffProduct({ product_name: 'No barcode', nutriments: { 'energy-kcal_100g': 10 } })).toBeNull();
  });
  it('uses the serving size when present and derives kcal from kJ', () => {
    const f = mapOffProduct({ code: '2', product_name: ' Granola ', brands: 'Acme, Other', serving_size: '45 g', serving_quantity: '45', nutriments: { energy_100g: 1883, proteins_100g: '9.5' } })!;
    expect(f.name).toBe('Granola');
    expect(f.portions).toEqual([{ label: 'serving (45 g)', grams: 45 }]);
    expect(f.n.kcal).toBe(450);
    expect(f.n.protein).toBe(9.5);
  });
});
