import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Btn, Card, NumField, Page, Seg } from '../../components/ui';
import { getProfile, saveProfile, useSettings, type Activity, type Goal, type Profile, type Sex } from '../../db';
import { ACTIVITY, GOALS, calcGoals } from '../../lib/goals';
import { cmToIn, fromKg, inToCm, round, toKg } from '../../lib/units';

interface Form {
  weight?: number; heightCm?: number; feet?: number; inches?: number; age?: number;
  sex: Sex; activity: Activity; goal: Goal; pace: number;
  o: { kcal?: number; protein?: number; carbs?: number; fat?: number };
}

export default function GoalSetup() {
  const nav = useNavigate();
  const { units } = useSettings();
  const [f, setF] = useState<Form>({ sex: 'male', activity: 'moderate', goal: 'maintain', pace: 0, o: {} });
  const [existing, setExisting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    void getProfile().then((p) => {
      if (p) {
        const totalIn = cmToIn(p.heightCm);
        setExisting(true);
        setF({
          weight: fromKg(p.weightKg, units, 1), heightCm: round(p.heightCm, 1), feet: Math.floor(Math.round(totalIn) / 12), inches: Math.round(totalIn) % 12,
          age: p.age, sex: p.sex, activity: p.activity, goal: p.goal, pace: p.paceLbPerWeek, o: { ...p.overrides },
        });
      }
      setLoaded(true);
    });
  }, [units]);

  const heightCm = units === 'lb' ? (f.feet !== undefined ? inToCm(f.feet * 12 + (f.inches ?? 0)) : undefined) : f.heightCm;
  const valid = !!f.weight && f.weight > 0 && !!heightCm && heightCm > 90 && heightCm < 250 && !!f.age && f.age >= 13 && f.age <= 100;
  const paces = GOALS[f.goal].paces;
  const pace = paces.includes(f.pace) ? f.pace : paces[0];
  const profile: Profile | null = valid ? {
    weightKg: toKg(f.weight!, units), heightCm: heightCm!, age: f.age!, sex: f.sex, activity: f.activity, goal: f.goal,
    paceLbPerWeek: pace,
    overrides: Object.fromEntries(Object.entries(f.o).filter(([, v]) => typeof v === 'number' && v > 0)),
  } : null;
  const calc = profile ? calcGoals(profile) : null;
  const paceLabel = (p: number) => (units === 'lb' ? `${p} lb/week` : `${round(p / 2.2046, 2)} kg/week`);

  const save = async () => {
    if (!profile) return;
    await saveProfile(profile);
    nav('/fuel');
  };

  if (!loaded) return <Page title="Goals" back="/fuel">{null}</Page>;
  return (
    <Page title={existing ? 'Your goals' : 'Set up your goals'} back={existing ? '/fuel' : undefined}>
      {!existing && <p className="text-mute">A few details to work out your daily calories and macros. You can change everything later.</p>}
      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="bw">Body weight ({units})</label><NumField id="bw" value={f.weight} onChange={(weight) => set({ weight })} /></div>
          <div><label className="label" htmlFor="age">Age</label><NumField id="age" decimal={false} value={f.age} onChange={(age) => set({ age })} /></div>
        </div>
        {units === 'lb' ? (
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="ft">Height (ft)</label><NumField id="ft" decimal={false} value={f.feet} onChange={(feet) => set({ feet })} /></div>
            <div><label className="label" htmlFor="in">(in)</label><NumField id="in" decimal={false} value={f.inches} onChange={(inches) => set({ inches })} /></div>
          </div>
        ) : (
          <div><label className="label" htmlFor="cm">Height (cm)</label><NumField id="cm" value={f.heightCm} onChange={(heightCm) => set({ heightCm })} /></div>
        )}
        <div><span className="label">Sex (used by the calorie equation)</span>
          <Seg label="Sex" value={f.sex} onChange={(sex) => set({ sex })} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} /></div>
        <div><label className="label" htmlFor="act">Activity level</label>
          <select id="act" className="field" value={f.activity} onChange={(e) => set({ activity: e.target.value as Activity })}>
            {(Object.keys(ACTIVITY) as Activity[]).map((a) => <option key={a} value={a}>{ACTIVITY[a].label}: {ACTIVITY[a].desc}</option>)}
          </select></div>
      </Card>

      <Card className="space-y-3">
        <div><span className="label">Goal</span>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(GOALS) as Goal[]).map((g) => (
              <button key={g} role="radio" aria-checked={f.goal === g} onClick={() => set({ goal: g, pace: GOALS[g].paces[0] })}
                className={`min-h-[48px] rounded-xl border px-2 text-sm font-semibold ${f.goal === g ? 'border-accent bg-accent text-[rgb(var(--accent-ink))]' : 'border-line text-ink'}`}>
                {GOALS[g].label}
              </button>
            ))}
          </div></div>
        {paces.length > 1 && (
          <div><span className="label">Target pace</span>
            <Seg label="Target pace" value={String(pace)} onChange={(v) => set({ pace: Number(v) })}
              options={paces.map((p) => ({ value: String(p), label: paceLabel(p) }))} /></div>
        )}
      </Card>

      {calc && (
        <Card className="space-y-3">
          <h2 className="font-bold">Your daily targets</h2>
          <div className="tnum grid grid-cols-4 gap-2 text-center">
            {([['kcal', 'Calories', ''], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g']] as const).map(([k, label, u]) => (
              <div key={k} className="rounded-xl bg-bg p-2">
                <div className="text-lg font-bold">{calc.final[k]}{u}</div>
                <div className="text-xs text-mute">{label}{calc.overridden.includes(k) ? ' ✎' : ''}</div>
              </div>
            ))}
          </div>
          {calc.capped && <p className="text-sm text-mute">The pace was capped at 500 kcal from maintenance.</p>}
          {calc.floored && <p className="text-sm text-mute">Raised to the {calc.auto.kcal} kcal minimum, since the calculation came out lower.</p>}

          <details className="rounded-xl border border-line p-2" open={calc.overridden.length > 0}>
            <summary className="flex min-h-[44px] cursor-pointer items-center font-medium">Override targets manually</summary>
            <p className="my-2 text-sm text-mute">Leave a box empty to use the calculated value.</p>
            <div className="grid grid-cols-2 gap-2">
              {([['kcal', 'Calories'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)']] as const).map(([k, label]) => (
                <div key={k}><label className="label" htmlFor={`o-${k}`}>{label}</label>
                  <NumField id={`o-${k}`} decimal={false} value={f.o[k]} placeholder={String(calc.auto[k])} onChange={(n) => set({ o: { ...f.o, [k]: n } })} /></div>
              ))}
            </div>
          </details>
          {calc.warnings.map((w) => (
            <p key={w} role="alert" className="rounded-xl border border-warn/60 bg-warn/10 p-2 text-sm"><b>⚠ Heads up:</b> {w}</p>
          ))}
        </Card>
      )}

      {!profile && <p className="text-center text-sm text-mute">Enter your weight, height and age (13 to 100) to see your targets.</p>}
      <Btn kind="primary" full disabled={!profile} onClick={save}>{existing ? 'Save goals' : 'Save and start tracking'}</Btn>
      {existing && <Btn full to="/fuel/math">How this was calculated</Btn>}
    </Page>
  );
}
