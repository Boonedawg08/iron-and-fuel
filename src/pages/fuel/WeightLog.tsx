import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { LineChart } from '../../components/Chart';
import { Btn, Card, Empty, NumField, Page } from '../../components/ui';
import { db, useSettings, type BodyWeight } from '../../db';
import { parseYmd, shortDate, ymd } from '../../lib/date';
import { fromKg, toKg } from '../../lib/units';

export default function WeightLog() {
  const { units } = useSettings();
  const [date, setDate] = useState(ymd());
  const [w, setW] = useState<number | undefined>();
  const rows = useLiveQuery(() => db.bodyWeights.orderBy('date').toArray(), [], [] as BodyWeight[]);

  const add = async () => {
    if (!w) return;
    await db.bodyWeights.put({ date, weightKg: toKg(w, units) });
    setW(undefined);
  };

  // Trend: average of the last 7 days vs the 7 days before that.
  const dayMs = 86400000;
  const now = parseYmd(ymd()).getTime();
  const avgBetween = (fromDays: number, toDays: number) => {
    const xs = rows.filter((r) => { const age = (now - parseYmd(r.date).getTime()) / dayMs; return age >= fromDays && age < toDays; });
    return xs.length ? xs.reduce((a, r) => a + r.weightKg, 0) / xs.length : null;
  };
  const recent = avgBetween(0, 7), before = avgBetween(7, 14);
  const delta = recent !== null && before !== null ? fromKg(recent - before, units, 1) : null;

  return (
    <Page title="Body weight" back="/fuel">
      <Card className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="bw-date">Date</label><input id="bw-date" type="date" className="field" value={date} max={ymd()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
          <div><label className="label" htmlFor="bw-val">Weight ({units})</label><NumField id="bw-val" value={w} onChange={setW} /></div>
        </div>
        <Btn kind="primary" full disabled={!w} onClick={add}>Save weight</Btn>
      </Card>

      {rows.length === 0 ? <Empty>Log your weight now and then to see the trend. It's optional.</Empty> : (
        <>
          <Card>
            <LineChart title="Body weight" unit={units} points={rows.map((r) => ({ x: parseYmd(r.date).getTime(), y: fromKg(r.weightKg, units, 1), label: shortDate(r.date) }))} />
            <p className="tnum mt-2 text-sm text-mute">
              {recent !== null && <>Last 7 days average: <b className="text-ink">{fromKg(recent, units, 1)} {units}</b>. </>}
              {delta !== null && <>That is {delta === 0 ? 'unchanged' : `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} ${units}`} from the week before.</>}
            </p>
          </Card>
          <Card>
            <ul className="tnum divide-y divide-line">
              {[...rows].reverse().slice(0, 60).map((r) => (
                <li key={r.date} className="flex min-h-[44px] items-center gap-2">
                  <span className="flex-1 text-mute">{parseYmd(r.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="font-semibold">{fromKg(r.weightKg, units, 1)} {units}</span>
                  <button aria-label={`Delete ${r.date}`} className="h-11 w-9 text-bad" onClick={() => void db.bodyWeights.delete(r.date)}>✕</button>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Page>
  );
}
