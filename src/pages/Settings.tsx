import { useRef, useState } from 'react';
import { Btn, Card, NumField, Page, Seg, confirmDialog } from '../components/ui';
import { saveSettings, useSettings } from '../db';
import { exportBackup, importBackup, wipeAll } from '../lib/backup';
import { loadDemoData } from '../lib/demo';
import { foodsReady } from '../lib/foodStore';

export default function Settings() {
  const s = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const run = async (fn: () => Promise<string>) => {
    try { setMsg(await fn()); } catch (e) { setMsg((e as Error).message || 'Something went wrong.'); }
  };

  return (
    <Page title="Settings" back>
      <Card className="space-y-3">
        <div><span className="label">Weight unit</span>
          <Seg label="Weight unit" value={s.units} onChange={(units) => void saveSettings({ units })} options={[{ value: 'lb', label: 'Pounds (lb)' }, { value: 'kg', label: 'Kilograms (kg)' }]} /></div>
        <div><span className="label">Theme</span>
          <Seg label="Theme" value={s.theme} onChange={(theme) => void saveSettings({ theme })} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Workout</h2>
        <span className="label">Rest timer</span>
        <Seg label="Rest timer" value={s.restTimerOn ? 'on' : 'off'} onChange={(v) => void saveSettings({ restTimerOn: v === 'on' })}
          options={[{ value: 'on', label: 'Start when I check a set' }, { value: 'off', label: 'Off' }]} />
        <div><label className="label" htmlFor="rest">Rest length (seconds)</label>
          <NumField id="rest" decimal={false} value={s.restSeconds} onChange={(n) => { if (n && n >= 5) void saveSettings({ restSeconds: Math.min(900, n) }); }} /></div>
        <div><span className="label">Screen during a workout</span>
          <Seg label="Screen during a workout" value={s.keepAwake ? 'on' : 'off'} onChange={(v) => void saveSettings({ keepAwake: v === 'on' })}
            options={[{ value: 'on', label: 'Keep screen on' }, { value: 'off', label: 'Let it sleep' }]} /></div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Backup</h2>
        <p className="text-sm text-mute">Everything lives only on this device. Export a backup file now and then, and keep it somewhere safe (Files, iCloud Drive, email to yourself).</p>
        <Btn full kind="primary" onClick={() => run(async () => { await exportBackup(); return 'Backup file created.'; })}>Export backup (JSON)</Btn>
        <Btn full onClick={() => fileRef.current?.click()}>Import backup…</Btn>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Backup file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (!confirmDialog('Importing replaces ALL data on this device with the backup. Continue?')) return;
            void run(async () => { const r = await importBackup(await f.text()); return `Backup restored (${r.rows} records).`; });
          }} />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Online food search</h2>
        <p className="text-sm text-mute">
          Branded and packaged foods are searched on USDA FoodData Central and Open Food Facts when you're online, and anything you log is kept for offline use.
          USDA's shared demo key only allows a few searches an hour, so a free personal key makes it reliable.
        </p>
        <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center font-medium text-accent">Get a free USDA API key ↗</a>
        <label className="label" htmlFor="fdckey">USDA API key (optional)</label>
        <input id="fdckey" className="field" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="DEMO_KEY"
          value={s.fdcApiKey} onChange={(e) => void saveSettings({ fdcApiKey: e.target.value.trim() })} />
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Demo &amp; reset</h2>
        <Btn full onClick={() => { if (confirmDialog('Add example routines, workouts, meals and body weights to this device?')) void run(async () => { await foodsReady(); await loadDemoData(); return 'Demo data loaded.'; }); }}>Load demo data</Btn>
        <Btn full kind="danger" onClick={() => { if (confirmDialog('Delete ALL data on this device? This cannot be undone. Export a backup first if unsure.')) void run(async () => { await wipeAll(); return 'All data deleted.'; }); }}>Delete all data</Btn>
      </Card>

      {msg && <p role="status" className="rounded-xl border border-line bg-card p-3 text-center font-medium">{msg}</p>}

      <p className="px-1 text-xs text-mute">
        Iron &amp; Fuel v{__APP_VERSION__}. Food data: USDA FoodData Central (Foundation Foods and SR Legacy, public domain) and, for online
        results, Open Food Facts (Open Database License). Calorie targets are estimates, not medical advice.
      </p>
    </Page>
  );
}
