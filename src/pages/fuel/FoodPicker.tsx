import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Btn, NumField, cx } from '../../components/ui';
import { useSettings, type Food } from '../../db';
import { search } from '../../lib/foodSearch';
import { searchOnline } from '../../lib/online';
import { G_PER_OZ } from '../../lib/units';

const SOURCE_LABEL: Record<Food['source'], string> = { usda: 'USDA', 'fdc-api': 'USDA branded', off: 'Open Food Facts', custom: 'My food' };

export function FoodRow(props: { food: Food; onPick: () => void }) {
  const f = props.food;
  return (
    <button onClick={props.onPick} className="block min-h-[52px] w-full rounded-lg px-1 py-1.5 text-left active:bg-line">
      <span className="block leading-snug">{f.name}{f.brand ? <span className="text-mute"> · {f.brand}</span> : null}</span>
      <span className="tnum block text-xs text-mute">
        {Math.round(f.n.kcal ?? 0)} kcal · P {Math.round(f.n.protein ?? 0)} · C {Math.round(f.n.carbs ?? 0)} · F {Math.round(f.n.fat ?? 0)} per 100 g · {SOURCE_LABEL[f.source]}
      </span>
    </button>
  );
}

/** Search box over the offline database, with an explicit "search online" step for branded foods. */
export function FoodPicker(props: { initialQuery?: string; onPick: (food: Food) => void; autoFocus?: boolean }) {
  const { fdcApiKey } = useSettings();
  const [q, setQ] = useState(props.initialQuery ?? '');
  const [debounced, setDebounced] = useState(q);
  const [online, setOnline] = useState<{ q: string; foods: Food[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 150); return () => clearTimeout(t); }, [q]);
  const hits = useMemo(() => (debounced.trim().length >= 2 ? search(debounced, 25) : []), [debounced]);

  const goOnline = async () => {
    setBusy(true);
    const query = q.trim();
    try {
      if (!navigator.onLine) setOnline({ q: query, foods: [], errors: ["You're offline. Online search needs a connection; the built-in database still works."] });
      else setOnline({ q: query, ...(await searchOnline(query, fdcApiKey)) });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <input className="field" type="search" placeholder="Search foods (or type a barcode)" aria-label="Search foods" autoFocus={props.autoFocus}
        value={q} onChange={(e) => { setQ(e.target.value); setOnline(null); }} enterKeyHint="search" />
      {q.trim().length >= 2 && (
        <>
          <div className="divide-y divide-line">
            {hits.map((h) => <FoodRow key={h.food.id} food={h.food} onPick={() => props.onPick(h.food)} />)}
            {hits.length === 0 && debounced === q && <p className="py-3 text-sm text-mute">Nothing in the built-in database matches.</p>}
          </div>
          <Btn full small onClick={goOnline} disabled={busy}>{busy ? 'Searching online…' : 'Search online for branded foods'}</Btn>
          {online && online.q === q.trim() && (
            <div>
              {online.errors.map((e) => <p key={e} role="alert" className="py-1 text-sm text-warn">{e}</p>)}
              {online.foods.length === 0 && online.errors.length === 0 && <p className="py-1 text-sm text-mute">No online results.</p>}
              <div className="divide-y divide-line">{online.foods.map((f) => <FoodRow key={f.id} food={f} onPick={() => props.onPick(f)} />)}</div>
            </div>
          )}
          <Link to="/fuel/food/new" className="flex min-h-[44px] items-center justify-center text-sm font-medium text-accent">Can't find it? Create a custom food</Link>
        </>
      )}
    </div>
  );
}

/** Amount entry for a chosen food: grams, ounces, or any of the food's own portions. */
export function AmountForm(props: { food: Food; onAdd: (grams: number) => void; cta?: string }) {
  const f = props.food;
  const units = useMemo(() => [{ label: 'grams', grams: 1 }, { label: 'oz', grams: G_PER_OZ }, ...f.portions], [f]);
  const firstPortion = f.portions.length ? 2 : 0;
  const [ui, setUi] = useState(firstPortion);
  const [qty, setQty] = useState<number | undefined>(firstPortion ? 1 : 100);
  const grams = Math.round((qty ?? 0) * units[ui].grams * 10) / 10;
  const k = grams / 100;
  return (
    <div className="space-y-3">
      <p className="font-semibold leading-snug">{f.name}{f.brand ? <span className="font-normal text-mute"> · {f.brand}</span> : null}</p>
      <div className="flex gap-2">
        <NumField label="Amount" className="!w-24 shrink-0" value={qty} onChange={setQty} />
        <select aria-label="Unit" className="field min-w-0 flex-1" value={ui} onChange={(e) => { const i = Number(e.target.value); setUi(i); if (i === 0 && ui !== 0) setQty(100); if (i !== 0 && ui === 0) setQty(1); }}>
          {units.map((u, i) => <option key={i} value={i}>{u.label}{i > 1 ? ` (${u.grams} g)` : ''}</option>)}
        </select>
      </div>
      <p className={cx('tnum text-sm', grams ? 'text-ink' : 'text-mute')}>
        {grams} g · <b>{Math.round((f.n.kcal ?? 0) * k)} kcal</b> · P {Math.round((f.n.protein ?? 0) * k)} g · C {Math.round((f.n.carbs ?? 0) * k)} g · F {Math.round((f.n.fat ?? 0) * k)} g
      </p>
      <Btn kind="primary" full disabled={!grams} onClick={() => props.onAdd(grams)}>{props.cta ?? 'Add'}</Btn>
    </div>
  );
}
