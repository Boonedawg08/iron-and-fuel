/** Loads the bundled USDA database and keeps the search index in sync with custom / cached foods. */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db, type Food } from '../db';
import { initBundledFoods, setUserFoods, type BundledDb } from './foodSearch';

let ready: Promise<void> | null = null;

export function foodsReady(): Promise<void> {
  ready ??= (async () => {
    // Relative to index.html, so it works under any base path. Precached by the service worker.
    const res = await fetch('./data/foods.json');
    if (!res.ok) throw new Error('Could not load the food database.');
    initBundledFoods((await res.json()) as BundledDb);
    setUserFoods(await db.foods.toArray());
    liveQuery(() => db.foods.toArray()).subscribe({ next: (foods) => setUserFoods(foods) });
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** 'loading' | 'ready' | 'error' */
export function useFoodDb(): 'loading' | 'ready' | 'error' {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let live = true;
    foodsReady().then(() => live && setState('ready'), () => live && setState('error'));
    return () => { live = false; };
  }, []);
  return state;
}

/** Remember a food on this device (custom foods, and online foods once they are used). */
export async function rememberFood(food: Food): Promise<void> {
  if (food.source === 'usda') return; // already bundled
  await db.foods.put({ ...food, lastUsed: Date.now() });
}
