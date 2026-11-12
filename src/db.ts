import Dexie, { type Table } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';

/* ---------- LIFT ---------- */
export interface Exercise { id: string; name: string }
export interface RoutineExercise { exerciseId: string; sets: number; reps: number; weightKg: number }
export interface Routine { id: string; name: string; order: number; exercises: RoutineExercise[] }
export interface WorkoutSet { weightKg: number; reps: number; done: boolean; doneAt?: number }
export interface WorkoutExercise { exerciseId: string; name: string; sets: WorkoutSet[] }
export interface Workout {
  id: string;
  routineId?: string;
  name: string;
  startedAt: number;
  finishedAt?: number;
  status: 'active' | 'done';
  exercises: WorkoutExercise[];
  /** Epoch ms when the current rest ends; stored so it survives app close / phone lock. */
  restEndsAt?: number;
  restTotalSec?: number;
}

/* ---------- FUEL ---------- */
export const NUTRIENT_KEYS = [
  'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat', 'cholesterol',
  'potassium', 'calcium', 'iron', 'magnesium', 'zinc', 'vitC', 'vitA', 'vitD', 'vitB12',
] as const;
export type NutrientKey = (typeof NUTRIENT_KEYS)[number];
/** Missing key = no data for that nutrient. */
export type Nutrients = Partial<Record<NutrientKey, number>>;

export const NUTRIENT_INFO: Record<NutrientKey, { label: string; unit: string }> = {
  kcal: { label: 'Calories', unit: 'kcal' },
  protein: { label: 'Protein', unit: 'g' },
  carbs: { label: 'Carbs', unit: 'g' },
  fat: { label: 'Fat', unit: 'g' },
  fiber: { label: 'Fiber', unit: 'g' },
  sugar: { label: 'Sugar', unit: 'g' },
  sodium: { label: 'Sodium', unit: 'mg' },
  satFat: { label: 'Saturated fat', unit: 'g' },
  cholesterol: { label: 'Cholesterol', unit: 'mg' },
  potassium: { label: 'Potassium', unit: 'mg' },
  calcium: { label: 'Calcium', unit: 'mg' },
  iron: { label: 'Iron', unit: 'mg' },
  magnesium: { label: 'Magnesium', unit: 'mg' },
  zinc: { label: 'Zinc', unit: 'mg' },
  vitC: { label: 'Vitamin C', unit: 'mg' },
  vitA: { label: 'Vitamin A', unit: 'µg' },
  vitD: { label: 'Vitamin D', unit: 'µg' },
  vitB12: { label: 'Vitamin B12', unit: 'µg' },
};

export interface Portion { label: string; grams: number }
export type FoodSource = 'usda' | 'fdc-api' | 'off' | 'custom';
export interface Food {
  /** e.g. "usda:171077", "fdc-api:2345", "off:0123456789", "custom:<uuid>" */
  id: string;
  source: FoodSource;
  name: string;
  brand?: string;
  category?: string;
  /** Nutrients per 100 g */
  n: Nutrients;
  portions: Portion[];
  lastUsed?: number;
}
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export interface LogEntry {
  id: string;
  date: string; // YYYY-MM-DD (local)
  slot: Slot;
  foodId: string;
  name: string;
  grams: number;
  /** Per-100 g nutrients snapshotted at log time, so edits to grams re-scale correctly
   *  and history never changes if the food is later edited or removed. */
  per100: Nutrients;
  createdAt: number;
}
export interface SavedMeal { id: string; name: string; items: { foodId: string; name: string; grams: number; per100: Nutrients }[] }
export interface BodyWeight { date: string; weightKg: number }

export type Sex = 'male' | 'female';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'very' | 'extra';
export type Goal = 'lose' | 'maintain' | 'leanBulk' | 'gain';
export interface Profile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activity: Activity;
  goal: Goal;
  /** Target pace in lb per week (always positive; direction comes from the goal). */
  paceLbPerWeek: number;
  overrides: { kcal?: number; protein?: number; carbs?: number; fat?: number };
}

export interface Settings {
  units: 'lb' | 'kg';
  theme: 'system' | 'light' | 'dark';
  restTimerOn: boolean;
  restSeconds: number;
  fdcApiKey: string;
}
export const DEFAULT_SETTINGS: Settings = {
  units: 'lb', theme: 'system', restTimerOn: true, restSeconds: 90, fdcApiKey: '',
};

interface KV { key: string; value: unknown }

class AppDB extends Dexie {
  exercises!: Table<Exercise, string>;
  routines!: Table<Routine, string>;
  workouts!: Table<Workout, string>;
  foods!: Table<Food, string>;
  log!: Table<LogEntry, string>;
  savedMeals!: Table<SavedMeal, string>;
  bodyWeights!: Table<BodyWeight, string>;
  kv!: Table<KV, string>;

  constructor() {
    super('iron-and-fuel');
    this.version(1).stores({
      exercises: 'id, name',
      routines: 'id, order',
      workouts: 'id, status, startedAt',
      foods: 'id, source, lastUsed',
      log: 'id, date',
      savedMeals: 'id',
      bodyWeights: 'date',
      kv: 'key',
    });
  }
}
export const db = new AppDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);

/* ---------- settings / profile ---------- */
export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
}
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await getSettings()), ...patch };
  await db.kv.put({ key: 'settings', value: next });
  if (patch.theme) applyTheme(next.theme);
}
export function useSettings(): Settings {
  return useLiveQuery(getSettings, [], DEFAULT_SETTINGS);
}
export function applyTheme(theme: Settings['theme']): void {
  try { localStorage.setItem('theme', theme); } catch { /* private mode */ }
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d10' : '#f4f5f7');
}

export async function getProfile(): Promise<Profile | null> {
  return ((await db.kv.get('profile'))?.value as Profile) ?? null;
}
export async function saveProfile(p: Profile): Promise<void> {
  await db.kv.put({ key: 'profile', value: p });
}
/** undefined = still loading, null = not set up yet */
export function useProfile(): Profile | null | undefined {
  return useLiveQuery(getProfile, [], undefined);
}
