import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Btn, Card, NumField, Page, confirmDialog } from '../../components/ui';
import { db, uid, type Food, type NutrientKey, type Nutrients } from '../../db';
import { round } from '../../lib/units';

const FIELDS: [NutrientKey, string, boolean][] = [
  ['kcal', 'Calories', true], ['protein', 'Protein (g)', true], ['carbs', 'Carbs (g)', true], ['fat', 'Fat (g)', true],
  ['fiber', 'Fiber (g)', false], ['sugar', 'Sugar (g)', false], ['sodium', 'Sodium (mg)', false],
];

/** Enter values straight off a nutrition label (per serving); stored per 100 g like every other food. */
export default function CustomFood() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [servingName, setServingName] = useState('serving');
  const [servingG, setServingG] = useState<number | undefined>(100);
  const [vals, setVals] = useState<Nutrients>({});
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew) return;
    void db.foods.get(decodeURIComponent(id!)).then((f) => {
      if (!f) return nav(-1);
      const p = f.portions[0] ?? { label: 'serving', grams: 100 };
      setName(f.name); setBrand(f.brand ?? ''); setServingName(p.label); setServingG(p.grams);
      const per: Nutrients = {};
      for (const [k] of FIELDS) if (f.n[k] !== undefined) per[k] = round((f.n[k] as number) * p.grams / 100, 1);
      setVals(per);
      setLoaded(true);
    });
  }, [id, isNew, nav]);

  const valid = name.trim() && servingG && servingG > 0 && FIELDS.every(([k, , req]) => !req || vals[k] !== undefined);
  const save = async () => {
    if (!valid) return;
    const n: Nutrients = {};
    for (const [k] of FIELDS) if (vals[k] !== undefined) n[k] = round((vals[k] as number) * 100 / servingG!, 2);
    const food: Food = {
      id: isNew ? `custom:${uid()}` : decodeURIComponent(id!), source: 'custom', name: name.trim(), brand: brand.trim() || undefined,
      n, portions: [{ label: servingName.trim() || 'serving', grams: servingG! }], lastUsed: Date.now(),
    };
    await db.foods.put(food);
    nav(-1);
  };
  const remove = async () => {
    if (!confirmDialog(`Delete "${name}"? Meals already logged with it are kept.`)) return;
    await db.foods.delete(decodeURIComponent(id!));
    nav(-1);
  };

  if (!loaded) return <Page title="Custom food" back>{null}</Page>;
  return (
    <Page title={isNew ? 'New custom food' : 'Edit custom food'} back>
      <Card className="space-y-3">
        <div><label className="label" htmlFor="cf-name">Name</label><input id="cf-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Homemade chili" /></div>
        <div><label className="label" htmlFor="cf-brand">Brand (optional)</label><input id="cf-brand" className="field" value={brand} onChange={(e) => setBrand(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label" htmlFor="cf-sn">Serving name</label><input id="cf-sn" className="field" value={servingName} onChange={(e) => setServingName(e.target.value)} placeholder="bowl" /></div>
          <div><label className="label" htmlFor="cf-sg">Serving weight (g)</label><NumField id="cf-sg" value={servingG} onChange={setServingG} /></div>
        </div>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-bold">Nutrition per serving</h2>
        <div className="grid grid-cols-2 gap-2">
          {FIELDS.map(([k, label, req]) => (
            <div key={k}><label className="label" htmlFor={`cf-${k}`}>{label}{req ? ' *' : ''}</label>
              <NumField id={`cf-${k}`} value={vals[k]} onChange={(n) => setVals((v) => ({ ...v, [k]: n }))} /></div>
          ))}
        </div>
      </Card>
      <Btn kind="primary" full disabled={!valid} onClick={save}>Save food</Btn>
      {!isNew && <Btn kind="danger" full onClick={remove}>Delete food</Btn>}
    </Page>
  );
}
