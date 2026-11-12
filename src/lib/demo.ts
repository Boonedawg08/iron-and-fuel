import { db, uid, type LogEntry, type Routine, type Slot, type Workout } from '../db';
import { addDays, ymd } from './date';
import { getFoodByName } from './foodSearch';
import { getOrCreateExercise } from './lift';
import { lbToKg } from './units';

/** Example data so the app can be explored. Only ever added from Settings > Load demo data. */
export async function loadDemoData(): Promise<void> {
  const plan: { name: string; ex: [string, number, number, number][] }[] = [
    { name: 'Push Day', ex: [['Bench Press', 3, 8, 185], ['Overhead Press', 3, 8, 115], ['Incline Dumbbell Press', 3, 10, 60], ['Triceps Pushdown', 3, 12, 50]] },
    { name: 'Pull Day', ex: [['Deadlift', 3, 5, 275], ['Barbell Row', 3, 8, 155], ['Lat Pulldown', 3, 10, 130], ['Dumbbell Curl', 3, 12, 30]] },
    { name: 'Leg Day', ex: [['Back Squat', 3, 6, 225], ['Romanian Deadlift', 3, 8, 185], ['Leg Press', 3, 10, 320], ['Calf Raise', 3, 15, 140]] },
  ];
  const routines: Routine[] = [];
  for (const [i, p] of plan.entries()) {
    const exercises = [];
    for (const [name, sets, reps, lb] of p.ex) {
      const e = await getOrCreateExercise(name);
      exercises.push({ exerciseId: e.id, sets, reps, weightKg: lbToKg(lb) });
    }
    routines.push({ id: uid(), name: `${p.name} (demo)`, order: Date.now() + i, exercises });
  }
  await db.routines.bulkAdd(routines);

  // Five weeks of history, three sessions a week, adding 5 lb most weeks.
  const names = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
  const workouts: Workout[] = [];
  const today = new Date();
  today.setHours(18, 0, 0, 0);
  for (let week = 5; week >= 1; week--) {
    routines.forEach((r, ri) => {
      const start = new Date(today);
      start.setDate(start.getDate() - week * 7 + ri * 2);
      const bump = (5 - week) * 5;
      workouts.push({
        id: uid(), routineId: r.id, name: r.name, status: 'done',
        startedAt: start.getTime(), finishedAt: start.getTime() + (52 + ri * 4) * 60000,
        exercises: r.exercises.map((re) => ({
          exerciseId: re.exerciseId, name: names.get(re.exerciseId) ?? 'Exercise',
          sets: Array.from({ length: re.sets }, (_, si) => ({
            weightKg: re.weightKg - lbToKg(20) + lbToKg(bump), reps: Math.max(1, re.reps - (si === re.sets - 1 && week % 2 ? 1 : 0)), done: true,
            doneAt: start.getTime() + si * 180000,
          })),
        })),
      });
    });
  }
  await db.workouts.bulkAdd(workouts);

  if (!(await db.kv.get('profile'))) {
    await db.kv.put({ key: 'profile', value: { weightKg: lbToKg(180), heightCm: 178, age: 30, sex: 'male', activity: 'moderate', goal: 'leanBulk', paceLbPerWeek: 0.5, overrides: {} } });
  }

  const meals: [Slot, string, number][] = [
    ['breakfast', 'Egg, whole, cooked, scrambled', 150], ['breakfast', 'Bread, whole-wheat, commercially prepared', 64], ['breakfast', 'Bananas, raw', 118],
    ['lunch', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 170], ['lunch', 'Rice, white, long-grain, regular, enriched, cooked', 250], ['lunch', 'Broccoli, raw', 90],
    ['dinner', 'Fish, salmon, Atlantic, farmed, cooked, dry heat', 170], ['dinner', 'Sweet potato, cooked, baked in skin, flesh, without salt', 200], ['dinner', 'Oil, olive, salad or cooking', 13.5],
    ['snack', 'Yogurt, Greek, plain, nonfat', 200], ['snack', 'Nuts, almonds', 30],
  ];
  const entries: LogEntry[] = [];
  for (let d = 6; d >= 1; d--) {
    const date = addDays(ymd(), -d);
    for (const [slot, name, grams] of meals) {
      const food = getFoodByName(name);
      if (!food || (d % 3 === 0 && slot === 'snack')) continue;
      entries.push({ id: uid(), date, slot, foodId: food.id, name: food.name, grams: Math.round(grams * (1 + ((d * 7) % 5 - 2) / 20)), per100: food.n, createdAt: Date.now() });
    }
  }
  await db.log.bulkAdd(entries);

  for (let d = 28; d >= 0; d -= 2) {
    const date = addDays(ymd(), -d);
    if (!(await db.bodyWeights.get(date))) await db.bodyWeights.put({ date, weightKg: lbToKg(178 + (28 - d) * 0.07 + ((d * 13) % 7 - 3) * 0.2) });
  }
}
