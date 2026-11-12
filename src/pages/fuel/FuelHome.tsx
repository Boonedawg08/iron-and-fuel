import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Btn, Card, NumField, Page, Progress, Seg, Sheet } from '../../components/ui';
import { NUTRIENT_INFO, NUTRIENT_KEYS, SLOTS, db, useProfile, type LogEntry, type Slot } from '../../db';
import { addDays, prettyDate, ymd } from '../../lib/date';
import { SLOT_LABEL, entryNutrients, totalsOf } from '../../lib/fuel';
import { calcGoals } from '../../lib/goals';
import { GearLink } from '../lift/LiftHome';
import GoalSetup from './GoalSetup';

function EntryEditor(props: { entry: LogEntry | null; onClose: () => void }) {
  const e = props.entry;
  const [grams, setGrams] = useState<number | undefined>(e?.grams);
  const [slot, setSlot] = useState<Slot>(e?.slot ?? 'snack');
  if (!e) return null;
  const n = entryNutrients({ per100: e.per100, grams: grams ?? 0 });
  return (
    <Sheet open onClose={props.onClose} title="Edit entry">
      <p className="font-semibold">{e.name}</p>
      <div><label className="label" htmlFor="eg">Amount (grams)</label><NumField id="eg" value={grams} onChange={setGrams} /></div>
      <p className="tnum text-sm text-mute">{Math.round(n.kcal ?? 0)} kcal · P {Math.round(n.protein ?? 0)} g · C {Math.round(n.carbs ?? 0)} g · F {Math.round(n.fat ?? 0)} g</p>
      <Seg label="Meal" value={slot} onChange={setSlot} options={SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))} />
      <Btn kind="primary" full disabled={!grams} onClick={async () => { await db.log.update(e.id, { grams: grams!, slot }); props.onClose(); }}>Save</Btn>
      <Btn kind="danger" full onClick={async () => { await db.log.delete(e.id); props.onClose(); }}>Delete entry</Btn>
    </Sheet>
  );
}

export default function FuelHome() {
  const profile = useProfile();
  const [params, setParams] = useSearchParams();
  const date = params.get('d') ?? ymd();
  const setDate = (d: string) => setParams(d === ymd() ? {} : { d }, { replace: true });
  const entries = useLiveQuery(() => db.log.where('date').equals(date).sortBy('createdAt'), [date], [] as LogEntry[]);
  const [editing, setEditing] = useState<LogEntry | null>(null);

  if (profile === undefined) return <Page title="Fuel">{null}</Page>;
  if (profile === null) return <GoalSetup />;

  const target = calcGoals(profile).final;
  const t = totalsOf(entries);
  const extras = NUTRIENT_KEYS.filter((k) => !['kcal', 'protein', 'carbs', 'fat'].includes(k) && t[k] !== undefined);

  return (
    <Page title="Fuel" right={<GearLink />}>
      <div className="flex items-center gap-1">
        <button aria-label="Previous day" onClick={() => setDate(addDays(date, -1))} className="h-11 w-11 rounded-full text-2xl text-mute active:bg-line">‹</button>
        <label className="relative flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-line bg-card font-semibold">
          {prettyDate(date)}
          <input type="date" aria-label="Pick a date" value={date} max="2100-01-01" onChange={(e) => e.target.value && setDate(e.target.value)}
            onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* the native picker opens on its own */ } }}
            className="absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] cursor-pointer opacity-0" />
        </label>
        <button aria-label="Next day" onClick={() => setDate(addDays(date, 1))} className="h-11 w-11 rounded-full text-2xl text-mute active:bg-line">›</button>
      </div>

      <Card className="space-y-3">
        <Progress big label="Calories" unit="kcal" value={t.kcal ?? 0} target={target.kcal} />
        <Progress label="Protein" unit="g" value={t.protein ?? 0} target={target.protein} />
        <Progress label="Carbs" unit="g" value={t.carbs ?? 0} target={target.carbs} />
        <Progress label="Fat" unit="g" value={t.fat ?? 0} target={target.fat} />
        {extras.length > 0 && (
          <details>
            <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-medium text-accent">Fiber, sugar, sodium and micronutrients</summary>
            <dl className="tnum mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {extras.map((k) => (
                <div key={k} className="flex justify-between gap-2"><dt className="text-mute">{NUTRIENT_INFO[k].label}</dt>
                  <dd>{(t[k] as number) >= 10 ? Math.round(t[k] as number) : (t[k] as number).toFixed(1)} {NUTRIENT_INFO[k].unit}</dd></div>
              ))}
            </dl>
            <p className="mt-1 text-xs text-mute">Totals count only foods that list each nutrient, so they can run low.</p>
          </details>
        )}
      </Card>

      <Btn kind="primary" full to={`/fuel/log?d=${date}`}>+ Log a meal</Btn>

      {SLOTS.map((slot) => {
        const list = entries.filter((e) => e.slot === slot);
        const st = totalsOf(list);
        return (
          <Card key={slot}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{SLOT_LABEL[slot]}</h2>
              <span className="tnum text-sm text-mute">{list.length ? `${Math.round(st.kcal ?? 0)} kcal · P ${Math.round(st.protein ?? 0)} g` : ''}</span>
              <Link to={`/fuel/log?d=${date}&slot=${slot}`} aria-label={`Add to ${SLOT_LABEL[slot]}`} className="-mr-1 grid h-11 w-11 place-items-center rounded-full text-2xl text-accent">＋</Link>
            </div>
            {list.length === 0 && <p className="text-sm text-mute">Nothing logged.</p>}
            <ul className="divide-y divide-line">
              {list.map((e) => {
                const n = entryNutrients(e);
                return (
                  <li key={e.id}>
                    <button onClick={() => setEditing(e)} className="flex min-h-[48px] w-full items-center gap-2 py-1 text-left active:opacity-60" aria-label={`Edit ${e.name}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{e.name}</span>
                        <span className="tnum block text-xs text-mute">{Math.round(e.grams)} g · P {Math.round(n.protein ?? 0)} · C {Math.round(n.carbs ?? 0)} · F {Math.round(n.fat ?? 0)}</span>
                      </span>
                      <span className="tnum shrink-0 font-semibold">{Math.round(n.kcal ?? 0)}</span>
                      <span className="shrink-0 text-mute">✎</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}

      <div className="grid grid-cols-3 gap-2">
        <Btn small to="/fuel/week">Week</Btn>
        <Btn small to="/fuel/weight">Weight</Btn>
        <Btn small to="/fuel/goals">Goals</Btn>
      </div>
      {editing && <EntryEditor key={editing.id} entry={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}
