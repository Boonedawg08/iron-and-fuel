/** Unit conversions. Everything is stored in metric (kg, cm, g) and converted for display. */

export const LB_PER_KG = 2.2046226218;
export const G_PER_OZ = 28.349523125;
export const G_PER_LB = 453.59237;
export const CM_PER_IN = 2.54;

export const kgToLb = (kg: number): number => kg * LB_PER_KG;
export const lbToKg = (lb: number): number => lb / LB_PER_KG;
export const cmToIn = (cm: number): number => cm / CM_PER_IN;
export const inToCm = (inch: number): number => inch * CM_PER_IN;

export type WeightUnit = 'lb' | 'kg';

/** Round to at most `dp` decimals and drop floating-point noise (83.91460000001 -> 83.91). */
export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Stored kilograms -> number shown in the user's unit. */
export function fromKg(kg: number, unit: WeightUnit, dp = 2): number {
  return round(unit === 'lb' ? kgToLb(kg) : kg, dp);
}
/** Number typed in the user's unit -> stored kilograms. */
export function toKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? lbToKg(value) : value;
}
/** Size of the quick +/- buttons: 5 lb, or 2.5 kg. */
export const weightStep = (unit: WeightUnit): number => (unit === 'lb' ? 5 : 2.5);

/* ---------- food units ---------- */

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'floz' | 'cup';

export const MASS_G: Record<MassUnit, number> = { g: 1, kg: 1000, oz: G_PER_OZ, lb: G_PER_LB };
/** US customary volumes in millilitres. */
export const VOLUME_ML: Record<VolumeUnit, number> = {
  ml: 1, l: 1000, tsp: 4.92892159375, tbsp: 14.78676478125, floz: 29.5735295625, cup: 236.5882365,
};

export const isMassUnit = (u: string): u is MassUnit => u in MASS_G;
export const isVolumeUnit = (u: string): u is VolumeUnit => u in VOLUME_ML;

export const massToGrams = (qty: number, unit: MassUnit): number => qty * MASS_G[unit];
export const volumeToMl = (qty: number, unit: VolumeUnit): number => qty * VOLUME_ML[unit];
/** Volume -> grams given a density in g/ml (1 = water). */
export const volumeToGrams = (qty: number, unit: VolumeUnit, gPerMl = 1): number =>
  volumeToMl(qty, unit) * gPerMl;
