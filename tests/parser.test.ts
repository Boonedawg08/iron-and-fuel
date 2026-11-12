import { describe, expect, it } from 'vitest';
import { parseItem, parseMeal, parseQuantity } from '../src/lib/parser';

const brief = (text: string) => parseMeal(text).map((i) => [i.qty, i.unit, i.food]);

describe('parseQuantity', () => {
  it('handles integers, decimals, fractions, mixed numbers and words', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('.5')).toBe(0.5);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('three')).toBe(3);
    expect(parseQuantity('an')).toBe(1);
    expect(parseQuantity('1/0')).toBeNull();
    expect(parseQuantity('lots')).toBeNull();
  });
});

describe('parseMeal', () => {
  it('parses the example from the spec', () => {
    expect(brief('5oz chicken breast with 100 grams of white rice and a tablespoon of olive oil')).toEqual([
      [5, 'oz', 'chicken breast'],
      [100, 'g', 'white rice'],
      [1, 'tbsp', 'olive oil'],
    ]);
  });

  it('classifies unit kinds', () => {
    const [a, b, c] = parseMeal('5oz chicken, 1 cup milk, 2 eggs');
    expect([a.kind, b.kind, c.kind]).toEqual(['mass', 'volume', 'count']);
  });

  it('handles every mass unit and spelling', () => {
    expect(brief('200g rice')).toEqual([[200, 'g', 'rice']]);
    expect(brief('200 grams rice')).toEqual([[200, 'g', 'rice']]);
    expect(brief('0.5 kg potatoes')).toEqual([[0.5, 'kg', 'potatoes']]);
    expect(brief('8 ounces steak')).toEqual([[8, 'oz', 'steak']]);
    expect(brief('1 lb ground beef')).toEqual([[1, 'lb', 'ground beef']]);
    expect(brief('2 pounds of chicken thighs')).toEqual([[2, 'lb', 'chicken thighs']]);
    expect(brief('6 oz. salmon')).toEqual([[6, 'oz', 'salmon']]);
  });

  it('handles every volume unit and spelling', () => {
    expect(brief('2 cups spinach')).toEqual([[2, 'cup', 'spinach']]);
    expect(brief('1 tbsp peanut butter')).toEqual([[1, 'tbsp', 'peanut butter']]);
    expect(brief('2 tablespoons butter')).toEqual([[2, 'tbsp', 'butter']]);
    expect(brief('1 tsp honey')).toEqual([[1, 'tsp', 'honey']]);
    expect(brief('3 teaspoons sugar')).toEqual([[3, 'tsp', 'sugar']]);
    expect(brief('250ml milk')).toEqual([[250, 'ml', 'milk']]);
    expect(brief('1 l water')).toEqual([[1, 'l', 'water']]);
    expect(brief('8 fl oz orange juice')).toEqual([[8, 'floz', 'orange juice']]);
  });

  it('handles "a" / "an" / number words', () => {
    expect(brief('a banana')).toEqual([[1, null, 'banana']]);
    expect(brief('an apple')).toEqual([[1, null, 'apple']]);
    expect(brief('a cup of oatmeal')).toEqual([[1, 'cup', 'oatmeal']]);
    expect(brief('two eggs')).toEqual([[2, null, 'eggs']]);
    expect(brief('a dozen eggs')).toEqual([[12, null, 'eggs']]);
    expect(brief('a couple of eggs')).toEqual([[2, null, 'eggs']]);
  });

  it('handles fractions', () => {
    expect(brief('1/2 cup oats')).toEqual([[0.5, 'cup', 'oats']]);
    expect(brief('1 1/2 cups rice')).toEqual([[1.5, 'cup', 'rice']]);
    expect(brief('½ avocado')).toEqual([[0.5, null, 'avocado']]);
    expect(brief('1½ cups milk')).toEqual([[1.5, 'cup', 'milk']]);
    expect(brief('half an avocado')).toEqual([[0.5, null, 'avocado']]);
    expect(brief('half a cup of rice')).toEqual([[0.5, 'cup', 'rice']]);
    expect(brief('a half cup of rice')).toEqual([[0.5, 'cup', 'rice']]);
    expect(brief('one and a half cups of rice')).toEqual([[1.5, 'cup', 'rice']]);
    expect(brief('a cup and a half of rice')).toEqual([[1.5, 'cup', 'rice']]);
  });

  it('handles counts and counting words', () => {
    expect(brief('2 eggs')).toEqual([[2, null, 'eggs']]);
    expect(brief('1 banana')).toEqual([[1, null, 'banana']]);
    expect(brief('2 slices of bread')).toEqual([[2, 'slice', 'bread']]);
    expect(brief('3 large eggs')).toEqual([[3, 'large', 'eggs']]);
    expect(brief('1 medium apple')).toEqual([[1, 'medium', 'apple']]);
    expect(brief('2 scoops whey protein')).toEqual([[2, 'scoop', 'whey protein']]);
    expect(brief('3 strips of bacon')).toEqual([[3, 'strip', 'bacon']]);
  });

  it('does not mistake a food word for a unit', () => {
    expect(brief('2 large')).toEqual([[2, null, 'large']]);
    expect(brief('1 can')).toEqual([[1, null, 'can']]);
    expect(brief('3 grapes')).toEqual([[3, null, 'grapes']]);
    expect(brief('2 lemons')).toEqual([[2, null, 'lemons']]);
  });

  it('accepts the amount after the food', () => {
    expect(brief('chicken breast 5oz')).toEqual([[5, 'oz', 'chicken breast']]);
    expect(brief('white rice (100 g)')).toEqual([[100, 'g', 'white rice']]);
    expect(brief('eggs x2')).toEqual([[2, null, 'eggs']]);
  });

  it('splits on commas, "and", "with", "plus", "+", "&" and new lines', () => {
    expect(brief('2 eggs, 1 banana and a cup of milk').map((x) => x[2])).toEqual(['eggs', 'banana', 'milk']);
    expect(brief('2 eggs + toast & coffee').map((x) => x[2])).toEqual(['eggs', 'toast', 'coffee']);
    expect(brief('6oz steak\n1 cup broccoli plus 1 tbsp butter').map((x) => x[2])).toEqual(['steak', 'broccoli', 'butter']);
  });

  it('keeps foods whose name contains "and"', () => {
    expect(brief('1 cup mac and cheese')).toEqual([[1, 'cup', 'mac and cheese']]);
    expect(brief('2 tbsp half and half and 1 cup coffee')).toEqual([[2, 'tbsp', 'half and half'], [1, 'cup', 'coffee']]);
  });

  it('flags items with no amount instead of guessing silently', () => {
    const items = parseMeal('chicken breast and rice');
    expect(items.map((i) => [i.food, i.qty, i.qtyGiven])).toEqual([['chicken breast', 1, false], ['rice', 1, false]]);
    expect(parseMeal('2 eggs')[0].qtyGiven).toBe(true);
  });

  it('ignores conversational filler and punctuation', () => {
    expect(brief('I had 2 eggs and a banana for breakfast.')).toEqual([[2, null, 'eggs'], [1, null, 'banana']]);
    expect(brief('about 6 oz grilled salmon')).toEqual([[6, 'oz', 'grilled salmon']]);
  });

  it('is case-insensitive and tolerant of extra spaces', () => {
    expect(brief('  5 OZ   Chicken Breast ,  100 G  Rice ')).toEqual([[5, 'oz', 'chicken breast'], [100, 'g', 'rice']]);
  });

  it('returns nothing for empty or meaningless input', () => {
    expect(parseMeal('')).toEqual([]);
    expect(parseMeal('  ,  and  ')).toEqual([]);
    expect(parseMeal('123')).toEqual([]);
    expect(parseItem('')).toBeNull();
  });
});
