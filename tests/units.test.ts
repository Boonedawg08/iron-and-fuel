import { describe, expect, it } from 'vitest';
import {
  cmToIn, fromKg, inToCm, kgToLb, lbToKg, massToGrams, round, toKg, volumeToGrams, volumeToMl, weightStep,
} from '../src/lib/units';

describe('body / lifting weight conversions', () => {
  it('converts kg <-> lb', () => {
    expect(kgToLb(100)).toBeCloseTo(220.462, 3);
    expect(lbToKg(220.462)).toBeCloseTo(100, 3);
    expect(lbToKg(kgToLb(83.5))).toBeCloseTo(83.5, 10);
  });
  it('round-trips typed lb values through kg storage without drift', () => {
    for (const lb of [45, 135, 185, 195, 205, 225, 317.5, 2.5]) expect(fromKg(toKg(lb, 'lb'), 'lb')).toBe(lb);
    for (const kg of [20, 60, 82.5, 102.5, 1.25]) expect(fromKg(toKg(kg, 'kg'), 'kg')).toBe(kg);
  });
  it('shows stored kg in the chosen unit', () => {
    expect(fromKg(100, 'kg')).toBe(100);
    expect(fromKg(100, 'lb')).toBe(220.46);
    expect(fromKg(100, 'lb', 0)).toBe(220);
  });
  it('uses 5 lb or 2.5 kg quick steps', () => {
    expect(weightStep('lb')).toBe(5);
    expect(weightStep('kg')).toBe(2.5);
  });
  it('converts height', () => {
    expect(inToCm(70)).toBeCloseTo(177.8, 5);
    expect(cmToIn(177.8)).toBeCloseTo(70, 5);
  });
  it('rounds away floating point noise', () => {
    expect(round(0.1 + 0.2)).toBe(0.3);
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(83.91460000001)).toBe(83.91);
  });
});

describe('food mass conversions', () => {
  it('converts to grams', () => {
    expect(massToGrams(100, 'g')).toBe(100);
    expect(massToGrams(1.5, 'kg')).toBe(1500);
    expect(massToGrams(5, 'oz')).toBeCloseTo(141.75, 2);
    expect(massToGrams(1, 'lb')).toBeCloseTo(453.59, 2);
    expect(massToGrams(16, 'oz')).toBeCloseTo(massToGrams(1, 'lb'), 6);
  });
});

describe('food volume conversions', () => {
  it('converts to millilitres (US customary)', () => {
    expect(volumeToMl(1, 'cup')).toBeCloseTo(236.59, 2);
    expect(volumeToMl(1, 'tbsp')).toBeCloseTo(14.79, 2);
    expect(volumeToMl(1, 'tsp')).toBeCloseTo(4.93, 2);
    expect(volumeToMl(1, 'floz')).toBeCloseTo(29.57, 2);
    expect(volumeToMl(2, 'l')).toBe(2000);
    expect(volumeToMl(250, 'ml')).toBe(250);
  });
  it('keeps kitchen ratios consistent', () => {
    expect(volumeToMl(3, 'tsp')).toBeCloseTo(volumeToMl(1, 'tbsp'), 6);
    expect(volumeToMl(16, 'tbsp')).toBeCloseTo(volumeToMl(1, 'cup'), 6);
    expect(volumeToMl(8, 'floz')).toBeCloseTo(volumeToMl(1, 'cup'), 6);
  });
  it('uses density to get grams', () => {
    expect(volumeToGrams(1, 'cup')).toBeCloseTo(236.59, 2); // water
    expect(volumeToGrams(1, 'tbsp', 13.5 / 14.78676478125)).toBeCloseTo(13.5, 6); // olive oil
  });
});
