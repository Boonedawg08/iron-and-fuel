import { Btn, Card, Page } from '../../components/ui';
import { useProfile, useSettings } from '../../db';
import { ACTIVITY, FAT_SHARE, GOALS, KCAL_PER_LB, MAX_ADJUST, MIN_KCAL, calcGoals } from '../../lib/goals';
import { fromKg, round } from '../../lib/units';

function Step(props: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-1 font-bold"><span className="text-accent">{props.n}.</span> {props.title}</h2>
      <div className="space-y-1 text-sm">{props.children}</div>
    </Card>
  );
}
const Math_ = (p: { children: React.ReactNode }) => <p className="tnum overflow-x-auto rounded-lg bg-bg p-2 font-mono text-[13px]">{p.children}</p>;

export default function HowCalculated() {
  const p = useProfile();
  const { units } = useSettings();
  if (!p) return <Page title="How this was calculated" back="/fuel/goals"><p className="text-mute">Set up your goals first.</p><Btn kind="primary" full to="/fuel/goals">Set up goals</Btn></Page>;
  const c = calcGoals(p);
  const g = GOALS[p.goal];
  const r = Math.round;
  const sign = (n: number) => (n > 0 ? `+ ${r(n)}` : n < 0 ? `− ${r(-n)}` : '+ 0');
  return (
    <Page title="How this was calculated" back="/fuel/goals">
      <Step n={1} title="Resting calories (BMR)">
        <p>Mifflin-St Jeor equation, the standard estimate of what your body burns at rest:</p>
        <Math_>10 × {round(p.weightKg, 1)} kg + 6.25 × {round(p.heightCm, 1)} cm − 5 × {p.age} yr {p.sex === 'male' ? '+ 5' : '− 161'} = <b>{r(c.bmr)} kcal</b></Math_>
        <p className="text-mute">Your weight of {fromKg(p.weightKg, units, 1)} {units} is {round(p.weightKg, 1)} kg. The last term is +5 for men, −161 for women.</p>
      </Step>
      <Step n={2} title="Maintenance calories (TDEE)">
        <p>BMR multiplied by an activity factor ({ACTIVITY[p.activity].label.toLowerCase()} = {c.factor}):</p>
        <Math_>{r(c.bmr)} × {c.factor} = <b>{r(c.tdee)} kcal</b></Math_>
      </Step>
      <Step n={3} title={`Goal adjustment: ${g.label.toLowerCase()}`}>
        {g.dir === 0 ? <p>Maintaining, so no adjustment.</p> : (
          <>
            <p>About {KCAL_PER_LB.toLocaleString()} kcal equals one pound of body weight, so {p.paceLbPerWeek} lb per week is:</p>
            <Math_>{p.paceLbPerWeek} × {KCAL_PER_LB} ÷ 7 = {r(Math.abs(c.requestedAdjust))} kcal per day {g.dir < 0 ? 'below' : 'above'} maintenance</Math_>
            {c.capped && <p>That is more than the {MAX_ADJUST} kcal limit, so it was capped at {MAX_ADJUST}.</p>}
          </>
        )}
        <Math_>{r(c.tdee)} {sign(c.adjust)} = {r(c.tdee + c.adjust)} → rounded to <b>{c.floored ? r((c.tdee + c.adjust) / 10) * 10 : c.auto.kcal} kcal</b></Math_>
        {c.floored && <p>That is under the {MIN_KCAL[p.sex]} kcal safety minimum, so the target was raised to <b>{c.auto.kcal} kcal</b>.</p>}
        <p className="text-mute">Adjustments are kept within {MAX_ADJUST} kcal of maintenance to protect muscle and energy.</p>
      </Step>
      <Step n={4} title="Protein">
        <p>{c.proteinPerLb} g per pound of body weight for this goal:</p>
        <Math_>{c.proteinPerLb} × {r(c.weightLb)} lb = <b>{c.auto.protein} g</b> ({c.auto.protein * 4} kcal)</Math_>
      </Step>
      <Step n={5} title="Fat">
        <p>{FAT_SHARE * 100}% of calories, at 9 kcal per gram:</p>
        <Math_>{c.auto.kcal} × {FAT_SHARE} ÷ 9 = <b>{c.auto.fat} g</b> ({c.auto.fat * 9} kcal)</Math_>
      </Step>
      <Step n={6} title="Carbs">
        <p>Whatever calories remain, at 4 kcal per gram:</p>
        <Math_>({c.auto.kcal} − {c.auto.protein * 4} − {c.auto.fat * 9}) ÷ 4 = <b>{c.auto.carbs} g</b></Math_>
      </Step>
      {c.overridden.length > 0 && (
        <Card>
          <h2 className="mb-1 font-bold">Your manual overrides</h2>
          <ul className="tnum space-y-1 text-sm">
            {c.overridden.map((k) => <li key={k}>{k === 'kcal' ? 'Calories' : k[0].toUpperCase() + k.slice(1)}: calculated {c.auto[k]}, using <b>{c.final[k]}</b></li>)}
          </ul>
        </Card>
      )}
      {c.warnings.map((w) => <p key={w} role="alert" className="rounded-xl border border-warn/60 bg-warn/10 p-2 text-sm"><b>⚠ Heads up:</b> {w}</p>)}
      <p className="px-1 text-xs text-mute">These are estimates. Real needs vary by person; adjust based on how your weight actually trends over a few weeks. Not medical advice.</p>
      <Btn full to="/fuel/goals">Edit goals or override targets</Btn>
    </Page>
  );
}
