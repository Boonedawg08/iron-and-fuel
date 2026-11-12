import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Btn, Card, NumField, Page, confirmDialog } from '../../components/ui';
import { db, uid, useSettings } from '../../db';
import { getOrCreateExercise } from '../../lib/lift';
import { fromKg, toKg } from '../../lib/units';

interface Row { key: string; name: string; sets?: number; reps?: number; weight?: number }

export default function RoutineEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const { units } = useSettings();
  const known = useLiveQuery(() => db.exercises.orderBy('name').toArray(), []);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([{ key: uid(), name: '', sets: 3, reps: 8, weight: undefined }]);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew || !id) return;
    void (async () => {
      const r = await db.routines.get(id);
      if (!r) return nav('/lift', { replace: true });
      const names = new Map((await db.exercises.toArray()).map((e) => [e.id, e.name]));
      const s = await db.kv.get('settings');
      const u = ((s?.value as { units?: 'lb' | 'kg' })?.units) ?? 'lb';
      setName(r.name);
      setRows(r.exercises.map((e) => ({ key: uid(), name: names.get(e.exerciseId) ?? '', sets: e.sets, reps: e.reps, weight: e.weightKg ? fromKg(e.weightKg, u) : undefined })));
      setLoaded(true);
    })();
  }, [id, isNew, nav]);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => setRows((rs) => {
    const next = [...rs];
    const j = i + d;
    if (j < 0 || j >= next.length) return rs;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = async () => {
    const exercises = [];
    for (const r of rows) {
      if (!r.name.trim()) continue;
      const ex = await getOrCreateExercise(r.name);
      exercises.push({ exerciseId: ex.id, sets: Math.max(1, Math.round(r.sets ?? 3)), reps: Math.max(1, Math.round(r.reps ?? 8)), weightKg: toKg(r.weight ?? 0, units) });
    }
    const existing = isNew ? undefined : await db.routines.get(id!);
    await db.routines.put({
      id: existing?.id ?? uid(),
      name: name.trim() || 'Untitled routine',
      order: existing?.order ?? Date.now(),
      exercises,
    });
    nav('/lift');
  };
  const remove = async () => {
    if (!confirmDialog(`Delete routine "${name}"? Your workout history is kept.`)) return;
    await db.routines.delete(id!);
    nav('/lift');
  };

  if (!loaded) return <Page title="Routine" back="/lift">{null}</Page>;
  return (
    <Page title={isNew ? 'New routine' : 'Edit routine'} back="/lift">
      <div>
        <label className="label" htmlFor="rname">Routine name</label>
        <input id="rname" className="field" placeholder="Push Day" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <datalist id="exercise-names">{known?.map((e) => <option key={e.id} value={e.name} />)}</datalist>

      {rows.map((r, i) => (
        <Card key={r.key}>
          <div className="flex items-center gap-1">
            <input
              className="field flex-1" placeholder="Exercise name" aria-label={`Exercise ${i + 1} name`} list="exercise-names"
              value={r.name} onChange={(e) => patch(r.key, { name: e.target.value })}
            />
            <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="h-11 w-9 rounded-lg text-mute disabled:opacity-30">↑</button>
            <button aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="h-11 w-9 rounded-lg text-mute disabled:opacity-30">↓</button>
            <button aria-label="Remove exercise" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="h-11 w-9 rounded-lg text-bad">✕</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div><span className="label">Sets</span><NumField label="Sets" decimal={false} value={r.sets} onChange={(n) => patch(r.key, { sets: n })} /></div>
            <div><span className="label">Reps</span><NumField label="Reps" decimal={false} value={r.reps} onChange={(n) => patch(r.key, { reps: n })} /></div>
            <div><span className="label">Weight ({units})</span><NumField label="Weight" value={r.weight} placeholder="0" onChange={(n) => patch(r.key, { weight: n })} /></div>
          </div>
        </Card>
      ))}
      <Btn full onClick={() => setRows((rs) => [...rs, { key: uid(), name: '', sets: 3, reps: 8 }])}>+ Add exercise</Btn>
      <Btn kind="primary" full onClick={save}>Save routine</Btn>
      {!isNew && <Btn kind="danger" full onClick={remove}>Delete routine</Btn>}
    </Page>
  );
}
