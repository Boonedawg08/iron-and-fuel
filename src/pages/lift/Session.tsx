import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Btn, Card, IconBtn, NumField, Page, Sheet, confirmDialog, cx } from '../../components/ui';
import { db, useSettings, type Workout, type WorkoutSet } from '../../db';
import { fmtClock, fmtDuration, shortDate } from '../../lib/date';
import { alertDone, unlockAudio, useWakeLock } from '../../lib/device';
import { doneWorkouts, finishWorkout, getActiveWorkout, getOrCreateExercise, lastSets } from '../../lib/lift';
import { fromKg, toKg, weightStep } from '../../lib/units';

/** Countdown driven by a stored end timestamp, so it stays right after the phone was locked. */
function RestTimer(props: { endsAt: number; total: number; onAdd: (sec: number) => void; onSkip: () => void }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = (props.endsAt - now) / 1000;
  useEffect(() => {
    if (left <= 0 && !fired.current) {
      fired.current = true;
      if (left > -3) alertDone(); // only alert if we were here to watch it finish
    }
    if (left > 0) fired.current = false;
  }, [left]);
  if (left < -120) return null; // long finished: don't keep nagging
  const done = left <= 0;
  const pct = done ? 100 : Math.min(100, (1 - left / Math.max(1, props.total)) * 100);
  return (
    <div role="timer" aria-label="Rest timer"
      className={cx('sticky top-14 z-10 overflow-hidden rounded-2xl border bg-card shadow-lg', done ? 'border-good' : 'border-accent')}>
      <div className="flex items-center gap-2 p-2 pl-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-mute">{done ? 'Rest done' : 'Rest'}</div>
          <div className="tnum text-3xl font-bold leading-8">{done ? 'Go!' : fmtClock(left)}</div>
        </div>
        {!done && <Btn small className="!px-2.5" onClick={() => props.onAdd(-15)} label="15 seconds less">−15s</Btn>}
        {!done && <Btn small className="!px-2.5" onClick={() => props.onAdd(30)} label="30 seconds more">+30s</Btn>}
        <Btn small className="!px-3" kind={done ? 'primary' : 'outline'} onClick={props.onSkip}>{done ? 'OK' : 'Skip'}</Btn>
      </div>
      <div className="h-1 bg-line"><div className={cx('h-full', done ? 'bg-good' : 'bg-accent')} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Session() {
  const nav = useNavigate();
  const settings = useSettings();
  const { units } = settings;
  const step = weightStep(units);
  const history = useLiveQuery(doneWorkouts, [], []);
  const known = useLiveQuery(() => db.exercises.orderBy('name').toArray(), [], []);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  // The screen renders from local state and writes every change straight through to IndexedDB.
  // `current` always holds the newest version, so two quick taps can never overwrite each other,
  // and nothing is lost if the app is closed or the phone locks mid-workout.
  const [workout, setWorkout] = useState<Workout | null | undefined>(undefined);
  const current = useRef<Workout | null>(null);
  useEffect(() => {
    let live = true;
    void getActiveWorkout().then((w) => {
      if (!live) return;
      current.current = w ?? null;
      setWorkout(w ?? null);
    });
    return () => { live = false; };
  }, []);
  const save = (fn: (w: Workout) => void) => {
    if (!current.current) return;
    const next = structuredClone(current.current);
    fn(next);
    current.current = next;
    setWorkout(next);
    void db.workouts.put(next);
  };

  // Re-render once a minute so the elapsed time stays current.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  useWakeLock(settings.keepAwake && !!workout);

  if (workout === undefined) return <Page title="Workout" back="/lift">{null}</Page>;
  if (workout === null) {
    return (
      <Page title="Workout" back="/lift">
        <p className="text-mute">No workout in progress.</p>
        <Btn kind="primary" full to="/lift">Back to routines</Btn>
      </Page>
    );
  }

  const patchSet = (ei: number, si: number, p: Partial<WorkoutSet>) => save((w) => { Object.assign(w.exercises[ei].sets[si], p); });
  const bump = (ei: number, si: number, delta: number) => save((w) => {
    const s = w.exercises[ei].sets[si];
    s.weightKg = Math.max(0, toKg(fromKg(s.weightKg, units) + delta, units));
  });

  const toggle = (ei: number, si: number) => {
    unlockAudio(); // a tap: lets the end-of-rest beep play later
    save((w) => {
      const s = w.exercises[ei].sets[si];
      s.done = !s.done;
      s.doneAt = s.done ? Date.now() : undefined;
      if (s.done && settings.restTimerOn) {
        w.restEndsAt = Date.now() + settings.restSeconds * 1000;
        w.restTotalSec = settings.restSeconds;
      }
    });
  };

  const addSet = (ei: number) => save((w) => {
    const sets = w.exercises[ei].sets;
    const prev = sets[sets.length - 1];
    sets.push({ weightKg: prev?.weightKg ?? 0, reps: prev?.reps ?? 8, done: false });
  });
  const removeLastSet = (ei: number) => {
    const sets = workout.exercises[ei].sets;
    const last = sets[sets.length - 1];
    if (!last) return;
    if (last.done && !confirmDialog(`Remove set ${sets.length}? It is already checked off.`)) return;
    save((w) => { w.exercises[ei].sets.pop(); });
  };
  const removeExercise = (ei: number) => {
    if (confirmDialog(`Remove ${workout.exercises[ei].name} from this workout?`)) save((w) => { w.exercises.splice(ei, 1); });
  };
  const addExercise = async (name: string) => {
    if (!name.trim()) return;
    const ex = await getOrCreateExercise(name);
    const last = lastSets(history, ex.id);
    save((w) => {
      w.exercises.push({
        exerciseId: ex.id, name: ex.name,
        // Start from what was done last time, or one empty set for a new exercise.
        sets: (last?.sets.length ? last.sets : [{ weightKg: 0, reps: 8, done: false }]).map((s) => ({ weightKg: s.weightKg, reps: s.reps, done: false })),
      });
    });
    setNewName('');
    setAdding(false);
  };

  const finish = async () => {
    const total = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
    const done = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0);
    if (done === 0) {
      if (confirmDialog('No sets were checked off. Discard this workout?')) { await db.workouts.delete(workout.id); nav('/lift'); }
      return;
    }
    if (done < total && !confirmDialog(`${total - done} set${total - done === 1 ? ' is' : 's are'} not checked off and won't be saved. Finish anyway?`)) return;
    const id = workout.id;
    await finishWorkout(workout);
    nav(`/lift/workout/${id}`, { replace: true });
  };
  const discard = async () => {
    if (!confirmDialog('Discard this workout? Nothing from it will be saved.')) return;
    await db.workouts.delete(workout.id);
    nav('/lift');
  };

  const query = newName.trim().toLowerCase();
  const suggestions = known.filter((e) => !workout.exercises.some((w) => w.exerciseId === e.id) && e.name.toLowerCase().includes(query));
  const nudge = 'h-11 w-9 min-[360px]:w-11 shrink-0 rounded-lg border border-line text-xs font-semibold active:bg-line';

  return (
    <Page title={workout.name} back="/lift" right={<span className="tnum pr-1 text-sm text-mute">{fmtDuration(Date.now() - workout.startedAt)}</span>}>
      {workout.restEndsAt && (
        <RestTimer
          endsAt={workout.restEndsAt} total={workout.restTotalSec ?? settings.restSeconds}
          onAdd={(sec) => save((w) => { w.restEndsAt = Math.max(Date.now(), (w.restEndsAt ?? Date.now()) + sec * 1000); w.restTotalSec = Math.max(1, (w.restTotalSec ?? 0) + sec); })}
          onSkip={() => save((w) => { w.restEndsAt = undefined; w.restTotalSec = undefined; })}
        />
      )}

      {workout.exercises.length === 0 && <p className="py-4 text-center text-mute">No exercises yet. Add your first one below.</p>}

      {workout.exercises.map((ex, ei) => {
        const last = lastSets(history, ex.exerciseId);
        return (
          <Card key={`${ex.exerciseId}-${ei}`} className="px-2">
            <div className="flex items-center gap-2 pl-1">
              <h2 className="min-w-0 flex-1 truncate text-lg font-bold">{ex.name}</h2>
              <IconBtn label={`Remove ${ex.name}`} onClick={() => removeExercise(ei)} className="text-bad">✕</IconBtn>
            </div>
            <div className="-mt-1 px-1 text-xs text-mute">{last ? `Last time: ${shortDate(last.at)}` : 'First time doing this exercise'}</div>

            <div className="mt-1 divide-y divide-line">
              {ex.sets.map((s, si) => {
                const prev = last?.sets[si];
                return (
                  <div key={si} className="py-2">
                    <div className="flex items-center gap-1">
                      <div className={cx('flex min-w-0 flex-1 items-center gap-1', s.done && 'opacity-60')}>
                        <span className="tnum w-5 shrink-0 text-center text-sm font-bold text-mute">{si + 1}</span>
                        <button aria-label={`Minus ${step} ${units}`} onClick={() => bump(ei, si, -step)} className={nudge}>−{step}</button>
                        <NumField label={`Set ${si + 1} weight in ${units}`} className="min-w-[3.5rem] flex-1 !px-0.5 text-center text-lg font-bold"
                          value={fromKg(s.weightKg, units)} onChange={(n) => patchSet(ei, si, { weightKg: toKg(n ?? 0, units) })} />
                        <button aria-label={`Plus ${step} ${units}`} onClick={() => bump(ei, si, step)} className={nudge}>+{step}</button>
                        <span aria-hidden className="shrink-0 text-mute">×</span>
                        <NumField label={`Set ${si + 1} reps`} decimal={false} className="!w-12 shrink-0 !px-0.5 text-center text-lg font-bold"
                          value={s.reps} onChange={(n) => patchSet(ei, si, { reps: n ?? 0 })} />
                      </div>
                      <button
                        role="checkbox" aria-checked={s.done} aria-label={`Set ${si + 1} done`} onClick={() => toggle(ei, si)}
                        className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 text-2xl font-bold',
                          s.done ? 'border-good bg-good text-bg' : 'border-mute text-transparent')}
                      >✓</button>
                    </div>
                    <div className="mt-1 flex items-center gap-2 pl-6">
                      <span className="min-w-0 flex-1 truncate text-xs text-mute/80">
                        {prev ? `Last: ${fromKg(prev.weightKg, units)} ${units} × ${prev.reps}` : last ? 'Last: no set here' : `${units} × reps`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Btn small full kind="ghost" onClick={() => addSet(ei)}>+ Add set</Btn>
              <Btn small full kind="ghost" className="!text-mute" disabled={ex.sets.length === 0} onClick={() => removeLastSet(ei)}>− Remove set</Btn>
            </div>
          </Card>
        );
      })}

      <Btn full onClick={() => setAdding(true)}>+ Add exercise</Btn>
      <Btn kind="primary" full onClick={finish}>Finish workout</Btn>
      <Btn kind="danger" full onClick={discard}>Discard workout</Btn>
      <p className="text-center text-sm text-mute">
        Rest timer {settings.restTimerOn ? `on (${settings.restSeconds} s)` : 'off'} · <Link to="/settings" className="inline-flex min-h-[44px] items-center font-medium text-accent">Change</Link>
      </p>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add exercise">
        <form onSubmit={(e) => { e.preventDefault(); void addExercise(newName); }} className="flex gap-2">
          <input className="field flex-1" placeholder="Exercise name" aria-label="Exercise name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Btn kind="primary" type="submit" disabled={!newName.trim()}>Add</Btn>
        </form>
        <div className="space-y-1">
          {suggestions.slice(0, 30).map((e) => (
            <button key={e.id} onClick={() => void addExercise(e.name)} className="block min-h-[44px] w-full rounded-lg px-2 text-left active:bg-line">{e.name}</button>
          ))}
        </div>
      </Sheet>
    </Page>
  );
}
