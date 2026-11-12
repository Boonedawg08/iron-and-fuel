import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LineChart } from '../../components/Chart';
import { Btn, Card, Empty, Page, Seg, confirmDialog } from '../../components/ui';
import { db, useSettings } from '../../db';
import { fmtDuration, shortDate } from '../../lib/date';
import { doneWorkouts, exerciseStats, workoutSetCount, workoutVolume } from '../../lib/lift';
import { fromKg } from '../../lib/units';

const longDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function History() {
  const { units } = useSettings();
  const [tab, setTab] = useState<'sessions' | 'exercises'>('sessions');
  const workouts = useLiveQuery(doneWorkouts, []);
  const exercises = useLiveQuery(() => db.exercises.orderBy('name').toArray(), [], []);
  const used = new Map<string, number>();
  for (const w of workouts ?? []) for (const e of w.exercises) used.set(e.exerciseId, (used.get(e.exerciseId) ?? 0) + 1);

  return (
    <Page title="History" back="/lift">
      <Seg value={tab} onChange={setTab} label="View" options={[{ value: 'sessions', label: 'Sessions' }, { value: 'exercises', label: 'Exercises & PRs' }]} />
      {tab === 'sessions' && (
        <>
          {workouts?.length === 0 && <Empty>Finished workouts will show up here.</Empty>}
          {workouts?.map((w) => (
            <Link key={w.id} to={`/lift/workout/${w.id}`} className="block rounded-2xl border border-line bg-card p-3 active:opacity-70">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-lg font-bold">{w.name}</span>
                <span className="shrink-0 text-sm text-mute">{longDate(w.startedAt)}</span>
              </div>
              <div className="tnum text-sm text-mute">
                {w.exercises.length} exercises · {workoutSetCount(w)} sets · {Math.round(fromKg(workoutVolume(w), units)).toLocaleString()} {units} volume
                {w.finishedAt ? ` · ${fmtDuration(w.finishedAt - w.startedAt)}` : ''}
              </div>
            </Link>
          ))}
        </>
      )}
      {tab === 'exercises' && (
        <>
          {used.size === 0 && <Empty>Progress charts and personal records appear after your first finished workout.</Empty>}
          {exercises.filter((e) => used.has(e.id)).map((e) => (
            <Link key={e.id} to={`/lift/exercise/${e.id}`} className="flex min-h-[52px] items-center justify-between rounded-2xl border border-line bg-card px-3 active:opacity-70">
              <span className="truncate font-semibold">{e.name}</span>
              <span className="shrink-0 text-sm text-mute">{used.get(e.id)} sessions ›</span>
            </Link>
          ))}
        </>
      )}
    </Page>
  );
}

export function WorkoutDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { units } = useSettings();
  const w = useLiveQuery(async () => (await db.workouts.get(id!)) ?? null, [id], undefined);
  if (w === undefined) return <Page title="Workout" back="/lift/history">{null}</Page>;
  if (w === null) return <Page title="Workout" back="/lift/history"><p className="text-mute">This workout no longer exists.</p></Page>;
  const remove = async () => {
    if (!confirmDialog('Delete this workout from your history?')) return;
    await db.workouts.delete(w.id);
    nav('/lift/history', { replace: true });
  };
  return (
    <Page title={w.name} back="/lift/history">
      <p className="tnum text-sm text-mute">
        {longDate(w.startedAt)}{w.finishedAt ? ` · ${fmtDuration(w.finishedAt - w.startedAt)}` : ''} · {workoutSetCount(w)} sets · {Math.round(fromKg(workoutVolume(w), units)).toLocaleString()} {units} total volume
      </p>
      {w.exercises.map((e, i) => (
        <Card key={i}>
          <Link to={`/lift/exercise/${e.exerciseId}`} className="flex min-h-[44px] items-center justify-between">
            <h2 className="truncate text-lg font-bold">{e.name}</h2>
            <span className="shrink-0 text-sm text-accent">Progress ›</span>
          </Link>
          <ol className="tnum space-y-1">
            {e.sets.map((s, si) => (
              <li key={si} className="flex gap-3"><span className="w-5 text-mute">{si + 1}</span><span>{fromKg(s.weightKg, units)} {units} × {s.reps}</span></li>
            ))}
          </ol>
        </Card>
      ))}
      <Btn kind="danger" full onClick={remove}>Delete workout</Btn>
    </Page>
  );
}

export function ExerciseStats() {
  const { id } = useParams();
  const { units } = useSettings();
  const ex = useLiveQuery(() => db.exercises.get(id!), [id]);
  const workouts = useLiveQuery(doneWorkouts, [], []);
  const stats = exerciseStats(workouts, id!);
  const pts = (f: (s: (typeof stats.sessions)[number]) => number) => stats.sessions.map((s) => ({ x: s.at, y: fromKg(f(s), units, 1), label: shortDate(s.at) }));
  const { prs } = stats;
  const w = (kg: number) => `${fromKg(kg, units, 1)} ${units}`;
  return (
    <Page title={ex?.name ?? 'Exercise'} back>
      {stats.sessions.length === 0 ? <Empty>No finished sets for this exercise yet.</Empty> : (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-mute">Personal records</h2>
            <dl className="grid grid-cols-2 gap-3">
              {prs.heaviest && <div><dt className="text-xs text-mute">Heaviest set</dt><dd className="tnum text-lg font-bold">{w(prs.heaviest.set.weightKg)} × {prs.heaviest.set.reps}</dd><dd className="text-xs text-mute">{shortDate(prs.heaviest.at)}</dd></div>}
              {prs.best1RM && <div><dt className="text-xs text-mute">Best estimated 1-rep max</dt><dd className="tnum text-lg font-bold">{w(prs.best1RM.value)}</dd><dd className="text-xs text-mute">from {w(prs.best1RM.set.weightKg)} × {prs.best1RM.set.reps}, {shortDate(prs.best1RM.at)}</dd></div>}
              {prs.bestVolume && <div><dt className="text-xs text-mute">Most volume in a session</dt><dd className="tnum text-lg font-bold">{Math.round(fromKg(prs.bestVolume.volumeKg, units)).toLocaleString()} {units}</dd><dd className="text-xs text-mute">{shortDate(prs.bestVolume.at)}</dd></div>}
              {prs.mostReps && <div><dt className="text-xs text-mute">Most reps in a set</dt><dd className="tnum text-lg font-bold">{prs.mostReps.set.reps} @ {w(prs.mostReps.set.weightKg)}</dd><dd className="text-xs text-mute">{shortDate(prs.mostReps.at)}</dd></div>}
            </dl>
          </Card>
          <Card><LineChart title="Top weight" unit={units} points={pts((s) => s.topKg)} /></Card>
          <Card><LineChart title="Total volume (weight × reps)" unit={units} points={pts((s) => s.volumeKg)} /></Card>
          <Card>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-mute">Sessions</h2>
            <ul className="tnum space-y-2 text-sm">
              {[...stats.sessions].reverse().slice(0, 30).map((s) => (
                <li key={s.at} className="flex gap-3">
                  <span className="w-16 shrink-0 text-mute">{shortDate(s.at)}</span>
                  <span>{s.sets.map((x) => `${fromKg(x.weightKg, units)}×${x.reps}`).join(', ')}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Page>
  );
}
