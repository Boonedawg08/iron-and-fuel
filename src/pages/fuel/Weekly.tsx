import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Btn, Card, Page, cx } from '../../components/ui';
import { db, useProfile, type LogEntry } from '../../db';
import { addDays, parseYmd, shortDate, ymd } from '../../lib/date';
import { hitsTargets, totalsOf } from '../../lib/fuel';
import { calcGoals } from '../../lib/goals';

export default function Weekly() {
  const profile = useProfile();
  const [end, setEnd] = useState(ymd());
  const start = addDays(end, -6);
  const entries = useLiveQuery(() => db.log.where('date').between(start, end, true, true).toArray(), [start, end], [] as LogEntry[]);
  if (!profile) return <Page title="This week" back="/fuel"><p className="text-mute">Set up your goals first.</p></Page>;
  const target = calcGoals(profile).final;

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const list = entries.filter((e) => e.date === date);
    const t = totalsOf(list);
    return { date, logged: list.length > 0, kcal: t.kcal ?? 0, protein: t.protein ?? 0, hit: hitsTargets(t, target) };
  });
  const logged = days.filter((d) => d.logged);
  const avg = (f: (d: (typeof days)[number]) => number) => (logged.length ? Math.round(logged.reduce((a, d) => a + f(d), 0) / logged.length) : 0);
  const maxKcal = Math.max(target.kcal * 1.15, ...days.map((d) => d.kcal));

  return (
    <Page title="Weekly view" back="/fuel">
      <div className="flex items-center gap-1">
        <button aria-label="Previous week" onClick={() => setEnd(addDays(end, -7))} className="h-11 w-11 rounded-full text-2xl text-mute active:bg-line">‹</button>
        <div className="flex-1 text-center font-semibold">{shortDate(start)} – {shortDate(end)}</div>
        <button aria-label="Next week" disabled={end >= ymd()} onClick={() => setEnd(addDays(end, 7))} className="h-11 w-11 rounded-full text-2xl text-mute active:bg-line disabled:opacity-30">›</button>
      </div>

      <div className="tnum grid grid-cols-3 gap-2 text-center">
        <Card><div className="text-xl font-bold">{avg((d) => d.kcal)}</div><div className="text-xs text-mute">avg kcal<br />target {target.kcal}</div></Card>
        <Card><div className="text-xl font-bold">{avg((d) => d.protein)} g</div><div className="text-xs text-mute">avg protein<br />target {target.protein} g</div></Card>
        <Card><div className="text-xl font-bold">{days.filter((d) => d.logged && d.hit.both).length} / 7</div><div className="text-xs text-mute">days on target</div></Card>
      </div>
      <p className="text-xs text-mute">Averages cover the {logged.length} day{logged.length === 1 ? '' : 's'} with food logged. A day is on target when calories are within 10% of your goal and protein reaches at least 90% of it.</p>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Calories by day</h2>
        <div className="relative flex h-36 items-end gap-2" role="img" aria-label={`Calories per day, target ${target.kcal}`}>
          <div className="absolute inset-x-0 border-t border-dashed border-mute" style={{ bottom: `${(target.kcal / maxKcal) * 100}%` }}>
            <span className="absolute -top-4 right-0 text-[10px] text-mute">target {target.kcal}</span>
          </div>
          {days.map((d) => (
            <div key={d.date} className="flex h-full flex-1 flex-col justify-end">
              <div className={cx('w-full rounded-t', d.logged ? 'bg-chart' : 'bg-line')} style={{ height: `${Math.max(d.logged ? 2 : 1, (d.kcal / maxKcal) * 100)}%` }} title={`${Math.round(d.kcal)} kcal`} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-2 text-center text-[11px] text-mute">
          {days.map((d) => <div key={d.date} className="flex-1">{parseYmd(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })}</div>)}
        </div>
      </Card>

      <Card>
        <table className="tnum w-full text-sm">
          <thead><tr className="text-left text-xs text-mute"><th className="py-1 font-medium">Day</th><th className="text-right font-medium">kcal</th><th className="text-right font-medium">Protein</th><th className="text-right font-medium">On target</th></tr></thead>
          <tbody className="divide-y divide-line">
            {days.map((d) => (
              <tr key={d.date}>
                <td><Link className="inline-flex min-h-[44px] items-center text-accent" to={`/fuel?d=${d.date}`}>{parseYmd(d.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</Link></td>
                <td className="text-right">{d.logged ? Math.round(d.kcal) : '–'}</td>
                <td className="text-right">{d.logged ? `${Math.round(d.protein)} g` : '–'}</td>
                <td className="text-right">{!d.logged ? <span className="text-mute">not logged</span> : d.hit.both ? <span className="font-semibold text-good">✓ Yes</span> : <span className="text-mute">{d.hit.kcal ? 'protein low' : d.hit.protein ? 'calories off' : 'No'}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Btn full to="/fuel">Back to today</Btn>
    </Page>
  );
}
