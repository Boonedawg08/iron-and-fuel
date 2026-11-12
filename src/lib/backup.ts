import { db } from '../db';
import { ymd } from './date';

const TABLES = ['exercises', 'routines', 'workouts', 'foods', 'log', 'savedMeals', 'bodyWeights', 'kv'] as const;
export interface Backup {
  app: 'iron-and-fuel';
  version: 1;
  exportedAt: string;
  data: Record<(typeof TABLES)[number], unknown[]>;
}

export async function buildBackup(): Promise<Backup> {
  const data = {} as Backup['data'];
  for (const t of TABLES) data[t] = await db.table(t).toArray();
  return { app: 'iron-and-fuel', version: 1, exportedAt: new Date().toISOString(), data };
}

/** Saves the backup file: share sheet on phones (Save to Files, AirDrop...), download elsewhere. */
export async function exportBackup(): Promise<void> {
  const json = JSON.stringify(await buildBackup(), null, 2);
  const name = `iron-and-fuel-backup-${ymd()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Iron & Fuel backup' }); return; } catch (e) {
      if ((e as Error).name === 'AbortError') return; // user closed the share sheet
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function validateBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return !!b && b.app === 'iron-and-fuel' && typeof b.data === 'object' && b.data !== null
    && TABLES.every((t) => b.data[t] === undefined || Array.isArray(b.data[t]));
}

/** Replaces everything on this device with the backup's contents. */
export async function importBackup(text: string): Promise<{ rows: number }> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  if (!validateBackup(parsed)) throw new Error('That file is not an Iron & Fuel backup.');
  const backup = parsed;
  let rows = 0;
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear();
      const list = backup.data[t] ?? [];
      rows += list.length;
      if (list.length) await db.table(t).bulkPut(list);
    }
  });
  return { rows };
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) await db.table(t).clear();
  });
}
