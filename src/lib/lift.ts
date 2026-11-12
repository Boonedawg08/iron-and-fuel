import { db, uid, type Exercise, type Routine, type Workout, type WorkoutSet } from '../db';

export async function getOrCreateExercise(name: string): Promise<Exercise> {
  const clean = name.trim().replace(/\s+/g, ' ');
  const all = await db.exercises.toArray();
  const found = all.find((e) => e.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const ex: Exercise = { id: uid(), name: clean };
  await db.exercises.add(ex);
  return ex;
}

export async function getActiveWorkout(): Promise<Workout | undefined> {
  return db.workouts.where('status').equals('active').first();
}

export async function startWorkout(routine?: Routine): Promise<Workout> {
  const existing = await getActiveWorkout();
  if (existing) return existing;
  const names = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
  const w: Workout = {
    id: uid(),
    routineId: routine?.id,
    name: routine?.name ?? 'Quick workout',
    startedAt: Date.now(),
    status: 'active',
    exercises: (routine?.exercises ?? []).map((re) => ({
      exerciseId: re.exerciseId,
      name: names.get(re.exerciseId) ?? 'Exercise',
      sets: Array.from({ length: Math.max(1, re.sets) }, (): WorkoutSet => ({ weightKg: re.weightKg, reps: re.reps, done: false })),
    })),
  };
  await db.workouts.add(w);
  return w;
}

/** Keeps only completed sets. Returns false (and saves nothing) when no set was completed. */
export async function finishWorkout(w: Workout): Promise<boolean> {
  const exercises = w.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) }))
    .filter((e) => e.sets.length > 0);
  if (exercises.length === 0) return false;
  await db.workouts.put({ ...w, exercises, status: 'done', finishedAt: Date.now(), restEndsAt: undefined, restTotalSec: undefined });
  return true;
}

export async function doneWorkouts(): Promise<Workout[]> {
  const all = await db.workouts.where('status').equals('done').toArray();
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

/** The completed sets from the most recent finished workout that included this exercise. */
export function lastSets(history: Workout[], exerciseId: string): { sets: WorkoutSet[]; at: number } | null {
  for (const w of history) {
    const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
    if (ex && ex.sets.length) return { sets: ex.sets, at: w.startedAt };
  }
  return null;
}

export const setVolume = (s: WorkoutSet): number => s.weightKg * s.reps;
export const workoutVolume = (w: Workout): number =>
  w.exercises.reduce((sum, e) => sum + e.sets.reduce((a, s) => a + (s.done ? setVolume(s) : 0), 0), 0);
export const workoutSetCount = (w: Workout): number => w.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
/** Epley estimated one-rep max. */
export const est1RM = (s: WorkoutSet): number => (s.reps <= 1 ? s.weightKg : s.weightKg * (1 + s.reps / 30));

export interface ExerciseSession { at: number; topKg: number; volumeKg: number; sets: WorkoutSet[] }
export interface ExerciseStats {
  sessions: ExerciseSession[]; // oldest first
  prs: {
    heaviest?: { set: WorkoutSet; at: number };
    best1RM?: { set: WorkoutSet; at: number; value: number };
    mostReps?: { set: WorkoutSet; at: number };
    bestVolume?: { volumeKg: number; at: number };
  };
}
export function exerciseStats(history: Workout[], exerciseId: string): ExerciseStats {
  const sessions: ExerciseSession[] = [];
  const prs: ExerciseStats['prs'] = {};
  for (const w of [...history].reverse()) {
    const ex = w.exercises.find((e) => e.exerciseId === exerciseId);
    const sets = ex?.sets.filter((s) => s.done) ?? [];
    if (!sets.length) continue;
    const volumeKg = sets.reduce((a, s) => a + setVolume(s), 0);
    sessions.push({ at: w.startedAt, topKg: Math.max(...sets.map((s) => s.weightKg)), volumeKg, sets });
    for (const s of sets) {
      if (!prs.heaviest || s.weightKg > prs.heaviest.set.weightKg || (s.weightKg === prs.heaviest.set.weightKg && s.reps > prs.heaviest.set.reps)) prs.heaviest = { set: s, at: w.startedAt };
      const e = est1RM(s);
      if (!prs.best1RM || e > prs.best1RM.value) prs.best1RM = { set: s, at: w.startedAt, value: e };
      if (!prs.mostReps || s.reps > prs.mostReps.set.reps) prs.mostReps = { set: s, at: w.startedAt };
    }
    if (!prs.bestVolume || volumeKg > prs.bestVolume.volumeKg) prs.bestVolume = { volumeKg, at: w.startedAt };
  }
  return { sessions, prs };
}
