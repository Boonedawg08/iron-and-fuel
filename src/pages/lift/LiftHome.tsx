import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Btn, Card, Empty, Page } from '../../components/ui';
import { db, useSettings } from '../../db';
import { fmtDuration } from '../../lib/date';
import { getActiveWorkout, startWorkout } from '../../lib/lift';
import { fromKg } from '../../lib/units';

export function GearLink() {
  return (
    <Link to="/settings" aria-label="Settings" className="grid h-11 w-11 place-items-center rounded-full text-xl text-mute active:bg-line">⚙︎</Link>
  );
}

export default function LiftHome() {
  const nav = useNavigate();
  const { units } = useSettings();
  const routines = useLiveQuery(() => db.routines.orderBy('order').toArray(), []);
  const exercises = useLiveQuery(() => db.exercises.toArray(), []);
  const active = useLiveQuery(getActiveWorkout, []);
  const names = new Map((exercises ?? []).map((e) => [e.id, e.name]));

  const start = async (routineId?: string) => {
    const r = routineId ? await db.routines.get(routineId) : undefined;
    await startWorkout(r);
    nav('/lift/session');
  };

  return (
    <Page title="Lift" right={<GearLink />}>
      {active && (
        <Card className="border-accent">
          <div className="text-sm text-mute">Workout in progress · {fmtDuration(Date.now() - active.startedAt)}</div>
          <div className="mb-2 text-lg font-bold">{active.name}</div>
          <Btn kind="primary" full to="/lift/session">Resume workout</Btn>
        </Card>
      )}

      <div className="flex gap-2">
        <Btn full to="/lift/history">History &amp; progress</Btn>
        {!active && <Btn full onClick={() => start()}>Quick start</Btn>}
      </div>

      <h2 className="pt-2 text-sm font-bold uppercase tracking-wider text-mute">Routines</h2>
      {routines?.length === 0 && <Empty>No routines yet. Create one like “Push Day” with your exercises, sets, reps and weights.</Empty>}
      {routines?.map((r) => (
        <Card key={r.id}>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold">{r.name}</div>
              <ul className="mt-1 space-y-0.5 text-sm text-mute">
                {r.exercises.map((e, i) => (
                  <li key={i} className="truncate">
                    {names.get(e.exerciseId) ?? 'Exercise'} · {e.sets}×{e.reps}{e.weightKg > 0 ? ` @ ${fromKg(e.weightKg, units)} ${units}` : ''}
                  </li>
                ))}
                {r.exercises.length === 0 && <li>No exercises yet</li>}
              </ul>
            </div>
            <Btn small to={`/lift/routine/${r.id}`}>Edit</Btn>
          </div>
          {!active && <Btn kind="primary" full className="mt-3" onClick={() => start(r.id)}>Start workout</Btn>}
        </Card>
      ))}
      <Btn full to="/lift/routine/new">+ New routine</Btn>
    </Page>
  );
}
