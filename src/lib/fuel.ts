import { db, uid, type Food, type LogEntry, type Nutrients, type Slot } from '../db';
import { scaleNutrients, sumNutrients } from './foodSearch';
import { rememberFood } from './foodStore';
import type { Targets } from './goals';

export const SLOT_LABEL: Record<Slot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

export const entryNutrients = (e: Pick<LogEntry, 'per100' | 'grams'>): Nutrients => scaleNutrients(e.per100, e.grams);
export const totalsOf = (entries: Pick<LogEntry, 'per100' | 'grams'>[]): Nutrients => sumNutrients(entries.map(entryNutrients));

export function defaultSlot(now = new Date()): Slot {
  const h = now.getHours() + now.getMinutes() / 60;
  return h < 10.5 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

export async function addToLog(date: string, slot: Slot, items: { food: Food; grams: number }[]): Promise<void> {
  const now = Date.now();
  const rows: LogEntry[] = items.map((it, i) => ({
    id: uid(), date, slot, foodId: it.food.id, name: it.food.brand ? `${it.food.name} (${it.food.brand})` : it.food.name,
    grams: it.grams, per100: it.food.n, createdAt: now + i,
  }));
  await db.log.bulkAdd(rows);
  for (const it of items) await rememberFood(it.food); // caches online foods for offline reuse
}

/** A day "hits" when calories land within 10% of target and protein reaches at least 90% of target. */
export function hitsTargets(t: Nutrients, target: Targets): { kcal: boolean; protein: boolean; both: boolean } {
  const kcal = Math.abs((t.kcal ?? 0) - target.kcal) <= target.kcal * 0.1;
  const protein = (t.protein ?? 0) >= target.protein * 0.9;
  return { kcal, protein, both: kcal && protein };
}
