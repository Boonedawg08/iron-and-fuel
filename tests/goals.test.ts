import { describe, expect, it } from 'vitest';
import type { Profile } from '../src/db';
import { MAX_ADJUST, MIN_KCAL, bmrMifflin, calcGoals } from '../src/lib/goals';
import { lbToKg } from '../src/lib/units';

const base: Profile = {
  weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate', goal: 'maintain', paceLbPerWeek: 0, overrides: {},
};

describe('Mifflin-St Jeor BMR', () => {
  it('matches the published formula for men', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 1780
    expect(bmrMifflin(80, 180, 30, 'male')).toBe(1780);
  });
  it('matches the published formula for women', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 1345.25
    expect(bmrMifflin(60, 165, 25, 'female')).toBe(1345.25);
  });
});

describe('daily targets', () => {
  it('maintenance = BMR x activity factor', () => {
    const c = calcGoals(base);
    expect(c.tdee).toBeCloseTo(1780 * 1.55, 6); // 2759
    expect(c.adjust).toBe(0);
    expect(c.final.kcal).toBe(2760);
  });
  it('uses each activity factor', () => {
    const f = (activity: Profile['activity']) => calcGoals({ ...base, activity }).factor;
    expect([f('sedentary'), f('light'), f('moderate'), f('very'), f('extra')]).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
  });
  it('fat loss at 1 lb/week is a 500 kcal deficit', () => {
    const c = calcGoals({ ...base, goal: 'lose', paceLbPerWeek: 1 });
    expect(c.adjust).toBe(-500);
    expect(c.final.kcal).toBe(2260);
  });
  it('fat loss at 0.5 lb/week is a 250 kcal deficit', () => {
    expect(calcGoals({ ...base, goal: 'lose', paceLbPerWeek: 0.5 }).adjust).toBe(-250);
  });
  it('lean bulk and faster gain are surpluses', () => {
    expect(calcGoals({ ...base, goal: 'leanBulk', paceLbPerWeek: 0.5 }).adjust).toBe(250);
    expect(calcGoals({ ...base, goal: 'gain', paceLbPerWeek: 1 }).adjust).toBe(500);
  });
  it('never adjusts more than 500 kcal either way', () => {
    const cut = calcGoals({ ...base, goal: 'lose', paceLbPerWeek: 2 });
    expect(cut.requestedAdjust).toBe(-1000);
    expect(cut.adjust).toBe(-MAX_ADJUST);
    expect(cut.capped).toBe(true);
    const bulk = calcGoals({ ...base, goal: 'gain', paceLbPerWeek: 3 });
    expect(bulk.adjust).toBe(MAX_ADJUST);
  });
  it('sets protein by body weight, fat at 25-30% of calories, carbs as the remainder', () => {
    const p = { ...base, weightKg: lbToKg(180), goal: 'lose' as const, paceLbPerWeek: 1 };
    const c = calcGoals(p);
    expect(c.final.protein).toBe(180); // 1.0 g/lb when cutting
    const fatShare = (c.final.fat * 9) / c.final.kcal;
    expect(fatShare).toBeGreaterThanOrEqual(0.25);
    expect(fatShare).toBeLessThanOrEqual(0.3);
    const macroKcal = c.final.protein * 4 + c.final.carbs * 4 + c.final.fat * 9;
    expect(Math.abs(macroKcal - c.final.kcal)).toBeLessThanOrEqual(6); // rounding only
  });
  it('keeps protein within 0.8-1 g per lb for every goal', () => {
    for (const goal of ['lose', 'maintain', 'leanBulk', 'gain'] as const) {
      const c = calcGoals({ ...base, weightKg: lbToKg(200), goal, paceLbPerWeek: 0.5 });
      expect(c.final.protein).toBeGreaterThanOrEqual(160);
      expect(c.final.protein).toBeLessThanOrEqual(200);
    }
  });
  it('raises automatic targets to the safety floor', () => {
    const small: Profile = { ...base, sex: 'female', weightKg: 45, heightCm: 150, age: 60, activity: 'sedentary', goal: 'lose', paceLbPerWeek: 1 };
    const c = calcGoals(small);
    expect(c.floored).toBe(true);
    expect(c.final.kcal).toBe(MIN_KCAL.female);
    expect(c.warnings).toHaveLength(0);
  });
});

describe('manual overrides', () => {
  it('replace only the overridden targets', () => {
    const c = calcGoals({ ...base, overrides: { protein: 200 } });
    expect(c.final.protein).toBe(200);
    expect(c.final.kcal).toBe(c.auto.kcal);
    expect(c.overridden).toEqual(['protein']);
  });
  it('warns when a manual calorie target is very low', () => {
    const c = calcGoals({ ...base, overrides: { kcal: 1100 } });
    expect(c.final.kcal).toBe(1100);
    expect(c.warnings.some((w) => /very low/.test(w))).toBe(true);
    expect(c.warnings.some((w) => /below maintenance/.test(w))).toBe(true);
  });
  it('warns when more than 500 kcal above maintenance', () => {
    const c = calcGoals({ ...base, overrides: { kcal: 3600 } });
    expect(c.warnings.some((w) => /above maintenance/.test(w))).toBe(true);
  });
  it('does not warn for a sensible override', () => {
    const c = calcGoals(base);
    const ok = calcGoals({ ...base, overrides: { kcal: c.auto.kcal - 100, carbs: c.auto.carbs - 25 } });
    expect(ok.warnings).toEqual([]);
  });
});
