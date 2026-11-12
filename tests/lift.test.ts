import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Routine, type Workout, type WorkoutSet } from '../src/db';
import { buildBackup, importBackup, validateBackup, wipeAll } from '../src/lib/backup';
import {
  doneWorkouts, est1RM, exerciseStats, finishWorkout, getActiveWorkout, getOrCreateExercise, lastSets, startWorkout,
  workoutSetCount, workoutVolume,
} from '../src/lib/lift';

const set = (weightKg: number, reps: number, done = true): WorkoutSet => ({ weightKg, reps, done });
const workout = (id: string, startedAt: number, sets: WorkoutSet[], exerciseId = 'bench'): Workout => ({
  id, name: 'Push', startedAt, finishedAt: startedAt + 3600000, status: 'done',
  exercises: [{ exerciseId, name: 'Bench Press', sets }],
});

describe('lifting stats (pure)', () => {
  // newest first, the order doneWorkouts() returns
  const history = [
    workout('w3', 3000, [set(100, 5), set(105, 3), set(95, 8)]),
    workout('w2', 2000, [set(90, 10), set(90, 9)]),
    workout('w1', 1000, [set(80, 8), set(80, 8), set(80, 12)]),
    workout('other', 500, [set(200, 5)], 'squat'),
  ];

  it('volume and set counts only include completed sets', () => {
    const w = workout('x', 1, [set(100, 5), set(100, 5, false)]);
    expect(workoutVolume(w)).toBe(500);
    expect(workoutSetCount(w)).toBe(1);
  });
  it('estimates one-rep max with the Epley formula', () => {
    expect(est1RM(set(100, 1))).toBe(100);
    expect(est1RM(set(100, 10))).toBeCloseTo(133.33, 2);
  });
  it('finds what was done last time for an exercise', () => {
    expect(lastSets(history, 'bench')).toEqual({ sets: history[0].exercises[0].sets, at: 3000 });
    expect(lastSets(history, 'squat')!.at).toBe(500);
    expect(lastSets(history, 'curl')).toBeNull();
  });
  it('builds progress points oldest first: top weight and total volume per session', () => {
    const { sessions } = exerciseStats(history, 'bench');
    expect(sessions.map((s) => s.at)).toEqual([1000, 2000, 3000]);
    expect(sessions.map((s) => s.topKg)).toEqual([80, 90, 105]);
    expect(sessions.map((s) => s.volumeKg)).toEqual([80 * 28, 90 * 19, 500 + 315 + 760]);
  });
  it('finds personal records', () => {
    const { prs } = exerciseStats(history, 'bench');
    expect(prs.heaviest).toMatchObject({ set: { weightKg: 105, reps: 3 }, at: 3000 });
    expect(prs.mostReps).toMatchObject({ set: { reps: 12 }, at: 1000 });
    expect(prs.bestVolume).toEqual({ volumeKg: 2240, at: 1000 });
    // 95 x 8 -> 120.3 beats 90 x 10 -> 120.0 and 100 x 5 -> 116.7
    expect(prs.best1RM!.set).toMatchObject({ weightKg: 95, reps: 8 });
    expect(prs.best1RM!.value).toBeCloseTo(120.33, 2);
  });
  it('returns empty stats for an exercise never done', () => {
    expect(exerciseStats(history, 'curl')).toEqual({ sessions: [], prs: {} });
  });
});

describe('workout lifecycle and backup (IndexedDB)', () => {
  beforeEach(async () => { await wipeAll(); });

  const makeRoutine = async (): Promise<Routine> => {
    const bench = await getOrCreateExercise('Bench Press');
    const r: Routine = { id: 'r1', name: 'Push Day', order: 1, exercises: [{ exerciseId: bench.id, sets: 3, reps: 8, weightKg: 80 }] };
    await db.routines.put(r);
    return r;
  };

  it('reuses exercises by name, ignoring case and extra spaces', async () => {
    const a = await getOrCreateExercise('Bench Press');
    const b = await getOrCreateExercise('  bench   press ');
    expect(b.id).toBe(a.id);
    expect(await db.exercises.count()).toBe(1);
  });
  it('starts a workout from a routine, one row per target set', async () => {
    const w = await startWorkout(await makeRoutine());
    expect(w.status).toBe('active');
    expect(w.exercises[0].name).toBe('Bench Press');
    expect(w.exercises[0].sets).toEqual([set(80, 8, false), set(80, 8, false), set(80, 8, false)]);
  });
  it('keeps a single in-progress workout that survives a reload', async () => {
    const first = await startWorkout(await makeRoutine());
    const second = await startWorkout(); // e.g. tapping start again
    expect(second.id).toBe(first.id);
    expect((await getActiveWorkout())!.id).toBe(first.id); // read back from the database
  });
  it('finishing saves only completed sets to history', async () => {
    const w = await startWorkout(await makeRoutine());
    w.exercises[0].sets[0].done = true;
    w.exercises[0].sets[1] = set(85, 6);
    expect(await finishWorkout(w)).toBe(true);
    expect(await getActiveWorkout()).toBeUndefined();
    const [saved] = await doneWorkouts();
    expect(saved.status).toBe('done');
    expect(saved.finishedAt).toBeGreaterThanOrEqual(saved.startedAt);
    expect(saved.exercises[0].sets).toEqual([set(80, 8), set(85, 6)]);
  });
  it('refuses to save a workout with nothing checked off', async () => {
    const w = await startWorkout(await makeRoutine());
    expect(await finishWorkout(w)).toBe(false);
    expect(await doneWorkouts()).toEqual([]);
  });

  it('backup round-trips every table', async () => {
    const w = await startWorkout(await makeRoutine());
    w.exercises[0].sets[0].done = true;
    await finishWorkout(w);
    await db.log.put({ id: 'l1', date: '2026-01-02', slot: 'lunch', foodId: 'usda:1', name: 'Rice', grams: 150, per100: { kcal: 130, protein: 2.7 }, createdAt: 1 });
    await db.foods.put({ id: 'custom:1', source: 'custom', name: 'Shake', n: { kcal: 60 }, portions: [{ label: 'serving', grams: 350 }] });
    await db.savedMeals.put({ id: 'm1', name: 'Usual', items: [{ foodId: 'usda:1', name: 'Rice', grams: 150, per100: { kcal: 130 } }] });
    await db.bodyWeights.put({ date: '2026-01-02', weightKg: 80 });
    await db.kv.put({ key: 'settings', value: { units: 'kg' } });

    const backup = await buildBackup();
    expect(validateBackup(backup)).toBe(true);
    const json = JSON.stringify(backup);

    await wipeAll();
    expect(await db.workouts.count()).toBe(0);
    const { rows } = await importBackup(json);
    expect(rows).toBe(8);
    expect(JSON.stringify((await buildBackup()).data)).toBe(JSON.stringify(backup.data));
  });
  it('importing replaces what was on the device', async () => {
    await db.bodyWeights.put({ date: '2026-01-01', weightKg: 70 });
    const empty = JSON.stringify(await (async () => { const b = await buildBackup(); b.data.bodyWeights = [{ date: '2026-02-02', weightKg: 75 }]; return b; })());
    await db.bodyWeights.put({ date: '2026-03-03', weightKg: 99 });
    await importBackup(empty);
    expect(await db.bodyWeights.toArray()).toEqual([{ date: '2026-02-02', weightKg: 75 }]);
  });
  it('rejects files that are not a backup, without touching existing data', async () => {
    await db.bodyWeights.put({ date: '2026-01-01', weightKg: 70 });
    await expect(importBackup('not json')).rejects.toThrow(/not valid JSON/);
    await expect(importBackup('{"app":"something-else","data":{}}')).rejects.toThrow(/not an Iron & Fuel backup/);
    await expect(importBackup('{"app":"iron-and-fuel","data":{"workouts":"oops"}}')).rejects.toThrow(/not an Iron & Fuel backup/);
    expect(await db.bodyWeights.count()).toBe(1);
  });
});
