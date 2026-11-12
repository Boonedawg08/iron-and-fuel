import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Btn, Card, Empty, NumField, Page, Seg, Sheet, confirmDialog, cx } from '../../components/ui';
import { SLOTS, db, uid, type Food, type SavedMeal, type Slot } from '../../db';
import { prettyDate, ymd } from '../../lib/date';
import { isConfident, resolveGrams, scaleNutrients, search, siblingsOf, stateNote, sumNutrients, type SearchHit } from '../../lib/foodSearch';
import { useFoodDb } from '../../lib/foodStore';
import { SLOT_LABEL, addToLog, defaultSlot } from '../../lib/fuel';
import { parseMeal, type ParsedItem } from '../../lib/parser';
import { AmountForm, FoodPicker } from './FoodPicker';

interface Draft {
  key: string;
  /** What the user typed for this item (empty when added from search). */
  raw: string;
  item?: ParsedItem;
  hits: SearchHit[];
  food?: Food;
  grams?: number;
  /** The automatic match is not trustworthy; the user must confirm or swap it before saving. */
  lowConfidence: boolean;
  confirmed: boolean;
  approx: boolean;
  note: string;
  state: string;
}

function draftFromParsed(item: ParsedItem): Draft {
  const hits = search(item.food, 12);
  const top = hits[0];
  const base = { key: uid(), raw: item.raw, item, hits, confirmed: false };
  if (!top) return { ...base, lowConfidence: true, approx: false, note: '', state: '' };
  const g = resolveGrams(item, top.food, siblingsOf(hits, top.food));
  return { ...base, food: top.food, grams: g.grams, approx: g.approx, note: g.note, lowConfidence: !isConfident(top), state: stateNote(top.food, item.food) };
}

export default function LogMeal() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const date = params.get('d') ?? ymd();
  const foodDb = useFoodDb();
  const [tab, setTab] = useState<'describe' | 'search' | 'saved'>('describe');
  const [slot, setSlot] = useState<Slot>((params.get('slot') as Slot) || defaultSlot());
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [picked, setPicked] = useState<Food | null>(null);
  const [mealName, setMealName] = useState('');
  const [parseMsg, setParseMsg] = useState('');
  const savedMeals = useLiveQuery(() => db.savedMeals.toArray(), [], [] as SavedMeal[]);
  const customFoods = useLiveQuery(() => db.foods.where('source').equals('custom').toArray(), [], [] as Food[]);

  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));

  const parse = () => {
    const items = parseMeal(text);
    if (items.length === 0) { setParseMsg("Couldn't find any foods in that. Try something like “2 eggs and a banana”."); return; }
    setParseMsg('');
    setDrafts((ds) => [...ds, ...items.map(draftFromParsed)]);
    setText('');
  };

  const swapTo = (key: string, food: Food) => {
    const d = drafts.find((x) => x.key === key);
    if (!d) return;
    const g = d.item ? resolveGrams(d.item, food, []) : { grams: d.grams ?? 100, approx: false, note: '' };
    // Picking a food by hand settles the match; a guessed amount still has to be accepted.
    patch(key, { food, grams: g.grams, approx: g.approx, note: g.note, lowConfidence: false, confirmed: false, state: stateNote(food, d.item?.food ?? '') });
    setSwapping(null);
  };

  const ready = drafts.filter((d) => d.food && d.grams && d.grams > 0);
  /** A doubtful match or a guessed amount is never saved until the user has explicitly accepted it. */
  const needsCheck = (d: Draft): boolean => (d.lowConfidence || d.approx) && !d.confirmed;
  const blocked = drafts.filter((d) => !d.food || !d.grams || needsCheck(d));
  const totals = sumNutrients(ready.map((d) => scaleNutrients(d.food!.n, d.grams!)));

  const save = async () => {
    if (!drafts.length || blocked.length) return;
    const items = ready.map((d) => ({ food: d.food!, grams: d.grams! }));
    await addToLog(date, slot, items);
    if (mealName.trim()) {
      await db.savedMeals.add({ id: uid(), name: mealName.trim(), items: items.map((i) => ({ foodId: i.food.id, name: i.food.name, grams: i.grams, per100: i.food.n })) });
    }
    nav(date === ymd() ? '/fuel' : `/fuel?d=${date}`);
  };

  const logSaved = async (m: SavedMeal) => {
    await db.log.bulkAdd(m.items.map((i, n) => ({ id: uid(), date, slot, foodId: i.foodId, name: i.name, grams: i.grams, per100: i.per100, createdAt: Date.now() + n })));
    nav(date === ymd() ? '/fuel' : `/fuel?d=${date}`);
  };

  const swapDraft = drafts.find((d) => d.key === swapping);

  return (
    <Page title="Log a meal" back={date === ymd() ? '/fuel' : `/fuel?d=${date}`}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-sm text-mute">{prettyDate(date)}</span>
        <div className="min-w-0 flex-1"><Seg label="Meal" value={slot} onChange={setSlot} options={SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] }))} /></div>
      </div>
      <Seg label="How to add" value={tab} onChange={setTab} options={[{ value: 'describe', label: 'Describe' }, { value: 'search', label: 'Search' }, { value: 'saved', label: 'Saved' }]} />

      {foodDb === 'loading' && <p className="text-sm text-mute">Loading food database…</p>}
      {foodDb === 'error' && <p role="alert" className="text-sm text-bad">The food database could not be loaded. Reopen the app while online once so it can be saved for offline use.</p>}

      {foodDb === 'ready' && tab === 'describe' && (
        <Card className="space-y-2">
          <label className="label" htmlFor="desc">What did you eat?</label>
          <textarea id="desc" className="field min-h-[96px]" rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="5oz chicken breast with 100 grams of white rice and a tablespoon of olive oil" />
          {parseMsg && <p role="alert" className="text-sm text-warn">{parseMsg}</p>}
          <Btn kind="primary" full disabled={!text.trim()} onClick={parse}>Find foods</Btn>
        </Card>
      )}

      {foodDb === 'ready' && tab === 'search' && (
        <Card><FoodPicker onPick={setPicked} /></Card>
      )}

      {tab === 'saved' && (
        <>
          <h2 className="text-sm font-bold uppercase tracking-wider text-mute">Saved meals</h2>
          {savedMeals.length === 0 && <Empty>Save a meal you eat often (name it when logging) and it appears here for one-tap logging.</Empty>}
          {savedMeals.map((m) => {
            const t = sumNutrients(m.items.map((i) => scaleNutrients(i.per100, i.grams)));
            return (
              <Card key={m.id}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{m.name}</div>
                    <div className="tnum text-xs text-mute">{Math.round(t.kcal ?? 0)} kcal · P {Math.round(t.protein ?? 0)} · C {Math.round(t.carbs ?? 0)} · F {Math.round(t.fat ?? 0)} · {m.items.length} items</div>
                  </div>
                  <Btn kind="primary" small onClick={() => void logSaved(m)} label={`Log ${m.name}`}>Log</Btn>
                  <button aria-label={`Delete ${m.name}`} className="h-11 w-9 text-bad" onClick={() => { if (confirmDialog(`Delete saved meal "${m.name}"?`)) void db.savedMeals.delete(m.id); }}>✕</button>
                </div>
              </Card>
            );
          })}
          <h2 className="pt-2 text-sm font-bold uppercase tracking-wider text-mute">My custom foods</h2>
          {customFoods.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-2xl border border-line bg-card px-3">
              <button className="min-h-[52px] min-w-0 flex-1 text-left" onClick={() => { setPicked(f); }}>
                <span className="block truncate font-medium">{f.name}</span>
                <span className="tnum block text-xs text-mute">{Math.round(f.n.kcal ?? 0)} kcal per 100 g</span>
              </button>
              <Link to={`/fuel/food/${encodeURIComponent(f.id)}`} className="grid h-11 place-items-center px-2 text-sm text-accent">Edit</Link>
            </div>
          ))}
          <Btn full to="/fuel/food/new">+ New custom food</Btn>
        </>
      )}

      {drafts.length > 0 && <h2 className="pt-1 text-sm font-bold uppercase tracking-wider text-mute">Check before saving</h2>}
      {drafts.map((d) => {
        const n = d.food && d.grams ? scaleNutrients(d.food.n, d.grams) : null;
        const needs = needsCheck(d);
        return (
          <Card key={d.key} className={cx(needs || !d.food ? 'border-warn' : '')}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {d.raw && <div className="text-xs text-mute">You wrote: “{d.raw}”</div>}
                <div className="font-semibold leading-snug">{d.food ? d.food.name : 'No match found'}{d.food?.brand ? <span className="font-normal text-mute"> · {d.food.brand}</span> : null}</div>
              </div>
              <button aria-label="Remove item" onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))} className="-mr-1 -mt-1 grid h-11 w-9 shrink-0 place-items-center text-bad">✕</button>
            </div>

            {d.food && (
              <div className="mt-2 flex items-center gap-2">
                <NumField label="Grams" className="!w-24 shrink-0 text-center font-bold" value={d.grams}
                  onChange={(grams) => patch(d.key, { grams, ...(d.approx ? { approx: false, note: 'Amount set by you.' } : {}) })} />
                <span className="text-sm text-mute">g</span>
                <span className="tnum flex-1 text-right text-sm">
                  <b className="text-base">{n ? Math.round(n.kcal ?? 0) : 0} kcal</b><br />
                  <span className="text-mute">P {n ? Math.round(n.protein ?? 0) : 0} · C {n ? Math.round(n.carbs ?? 0) : 0} · F {n ? Math.round(n.fat ?? 0) : 0} g</span>
                </span>
              </div>
            )}
            {d.note && <p className={cx('mt-2 text-xs', d.approx ? 'text-warn' : 'text-mute')}>{d.approx ? '⚠ ' : ''}{d.note}</p>}
            {d.state && <p className="mt-1 text-xs text-mute">{d.state}</p>}

            {needs && d.food && (
              <label className="mt-2 flex min-h-[44px] items-center gap-3 rounded-xl border border-warn/60 bg-warn/10 px-3 text-sm">
                <input type="checkbox" className="h-6 w-6 shrink-0 accent-[rgb(var(--accent))]" checked={d.confirmed} onChange={(e) => patch(d.key, { confirmed: e.target.checked })} />
                <span>
                  {d.lowConfidence
                    ? <><b>Not sure about this match.</b> Tick to confirm it's right, or swap it.</>
                    : <><b>The amount is a guess.</b> Tick to accept it, or fix the grams.</>}
                </span>
              </label>
            )}
            <Btn small full kind="ghost" onClick={() => setSwapping(d.key)}>{d.food ? 'Swap match' : 'Search for this food'}</Btn>
          </Card>
        );
      })}

      {drafts.length > 0 && (
        <Card className="space-y-3">
          <div className="tnum flex items-baseline justify-between">
            <span className="font-bold">Meal total</span>
            <span><b>{Math.round(totals.kcal ?? 0)} kcal</b> <span className="text-sm text-mute">· P {Math.round(totals.protein ?? 0)} · C {Math.round(totals.carbs ?? 0)} · F {Math.round(totals.fat ?? 0)} g</span></span>
          </div>
          <div><label className="label" htmlFor="mealname">Also save as a one-tap meal (optional)</label>
            <input id="mealname" className="field" placeholder="e.g. Usual lunch" value={mealName} onChange={(e) => setMealName(e.target.value)} /></div>
          {blocked.length > 0 && <p role="alert" className="text-sm text-warn">{blocked.length} item{blocked.length === 1 ? ' needs' : 's need'} your attention above before this can be saved.</p>}
          <Btn kind="primary" full disabled={blocked.length > 0} onClick={save}>Save to {SLOT_LABEL[slot]}</Btn>
        </Card>
      )}

      <Sheet open={!!swapDraft} onClose={() => setSwapping(null)} title="Choose the right food">
        {swapDraft && <FoodPicker key={swapDraft.key} initialQuery={swapDraft.item?.food ?? swapDraft.food?.name ?? ''} onPick={(f) => swapTo(swapDraft.key, f)} />}
      </Sheet>
      <Sheet open={!!picked} onClose={() => setPicked(null)} title="How much?">
        {picked && (
          <AmountForm key={picked.id} food={picked} cta="Add to meal" onAdd={(grams) => {
            setDrafts((ds) => [...ds, { key: uid(), raw: '', hits: [], food: picked, grams, lowConfidence: false, confirmed: true, approx: false, note: '', state: '' }]);
            setPicked(null);
          }} />
        )}
      </Sheet>
    </Page>
  );
}
