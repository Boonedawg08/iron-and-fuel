import type { Activity, Goal, Profile, Sex } from '../db';
import { kgToLb } from './units';

export const ACTIVITY: Record<Activity, { label: string; desc: string; factor: number }> = {
  sedentary: { label: 'Sedentary', desc: 'Desk job, little exercise', factor: 1.2 },
  light: { label: 'Light', desc: 'Exercise 1–3 days a week', factor: 1.375 },
  moderate: { label: 'Moderate', desc: 'Exercise 3–5 days a week', factor: 1.55 },
  very: { label: 'Very active', desc: 'Hard exercise 6–7 days a week', factor: 1.725 },
  extra: { label: 'Extra active', desc: 'Physical job plus training', factor: 1.9 },
};

/** dir: -1 deficit, 0 maintenance, +1 surplus. Paces are lb per week. */
export const GOALS: Record<Goal, { label: string; dir: -1 | 0 | 1; paces: number[]; proteinPerLb: number }> = {
  lose: { label: 'Lose fat', dir: -1, paces: [0.5, 1], proteinPerLb: 1.0 },
  maintain: { label: 'Maintain', dir: 0, paces: [0], proteinPerLb: 0.8 },
  leanBulk: { label: 'Lean bulk', dir: 1, paces: [0.25, 0.5], proteinPerLb: 0.9 },
  gain: { label: 'Gain muscle faster', dir: 1, paces: [0.75, 1], proteinPerLb: 1.0 },
};

/** One pound of body weight is roughly 3,500 kcal, so 1 lb/week is about 500 kcal/day. */
export const KCAL_PER_LB = 3500;
/** Adjustments never exceed this many kcal/day above or below maintenance. */
export const MAX_ADJUST = 500;
/** Share of calories from fat (middle of the 25–30% range). */
export const FAT_SHARE = 0.275;
/** Automatic targets never go below these; manual targets below them trigger a warning. */
export const MIN_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

/** Mifflin-St Jeor resting energy expenditure, kcal/day. */
export function bmrMifflin(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
}

export interface Targets { kcal: number; protein: number; carbs: number; fat: number }
export interface GoalCalc {
  bmr: number;
  factor: number;
  tdee: number;
  /** kcal/day asked for by the goal + pace, before the cap. */
  requestedAdjust: number;
  /** After capping to +/- MAX_ADJUST. */
  adjust: number;
  capped: boolean;
  /** True when the automatic target was raised to the safety floor. */
  floored: boolean;
  weightLb: number;
  proteinPerLb: number;
  /** Calculated targets, before manual overrides. */
  auto: Targets;
  /** What the app uses: auto with any manual overrides applied. */
  final: Targets;
  overridden: (keyof Targets)[];
  warnings: string[];
}

export function calcGoals(p: Profile): GoalCalc {
  const bmr = bmrMifflin(p.weightKg, p.heightCm, p.age, p.sex);
  const factor = ACTIVITY[p.activity].factor;
  const tdee = bmr * factor;
  const g = GOALS[p.goal];

  const requestedAdjust = g.dir * ((p.paceLbPerWeek * KCAL_PER_LB) / 7);
  const adjust = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, requestedAdjust));
  const capped = adjust !== requestedAdjust;

  let kcal = Math.round((tdee + adjust) / 10) * 10;
  const floored = kcal < MIN_KCAL[p.sex];
  if (floored) kcal = MIN_KCAL[p.sex];

  const weightLb = kgToLb(p.weightKg);
  const protein = Math.round(g.proteinPerLb * weightLb);
  const fat = Math.round((kcal * FAT_SHARE) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const auto: Targets = { kcal, protein, carbs, fat };

  const o = p.overrides ?? {};
  const overridden = (['kcal', 'protein', 'carbs', 'fat'] as const).filter((k) => typeof o[k] === 'number');
  const final: Targets = { ...auto };
  for (const k of overridden) final[k] = o[k] as number;

  return {
    bmr, factor, tdee, requestedAdjust, adjust, capped, floored, weightLb,
    proteinPerLb: g.proteinPerLb, auto, final, overridden,
    warnings: goalWarnings(final, { bmr, tdee, sex: p.sex, weightLb }, overridden.length > 0),
  };
}

export function goalWarnings(
  t: Targets, ctx: { bmr: number; tdee: number; sex: Sex; weightLb: number }, manual: boolean,
): string[] {
  const w: string[] = [];
  if (t.kcal < MIN_KCAL[ctx.sex]) {
    w.push(`${t.kcal} kcal is very low. Going under ${MIN_KCAL[ctx.sex]} kcal a day is hard to sustain and makes it difficult to get enough nutrients. Talk to a doctor or dietitian before eating this little.`);
  } else if (t.kcal < ctx.bmr) {
    w.push(`${t.kcal} kcal is below your resting metabolic rate (about ${Math.round(ctx.bmr)} kcal).`);
  }
  if (manual) {
    const diff = t.kcal - ctx.tdee;
    if (diff < -MAX_ADJUST - 5) w.push(`This is ${Math.round(-diff)} kcal below maintenance. More than about ${MAX_ADJUST} below tends to cost muscle and energy.`);
    if (diff > MAX_ADJUST + 5) w.push(`This is ${Math.round(diff)} kcal above maintenance. More than about ${MAX_ADJUST} above mostly adds fat.`);
    const macroKcal = t.protein * 4 + t.carbs * 4 + t.fat * 9;
    if (Math.abs(macroKcal - t.kcal) > Math.max(75, t.kcal * 0.05)) {
      w.push(`Your macros add up to ${Math.round(macroKcal)} kcal, which doesn't match the ${t.kcal} kcal target.`);
    }
    if (t.protein < 0.5 * ctx.weightLb) w.push('Protein is under 0.5 g per lb of body weight, which is low for keeping muscle.');
    if (t.fat * 9 < 0.15 * t.kcal) w.push('Fat is under 15% of calories, which is low for long-term health.');
  }
  return w;
}
