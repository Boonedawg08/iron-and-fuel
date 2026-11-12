/** Local-time date helpers. Dates are stored as YYYY-MM-DD strings. */
export function ymd(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function prettyDate(s: string): string {
  const today = ymd();
  if (s === today) return 'Today';
  if (s === addDays(today, -1)) return 'Yesterday';
  if (s === addDays(today, 1)) return 'Tomorrow';
  return parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
export function shortDate(ts: number | string): string {
  const d = typeof ts === 'string' ? parseYmd(ts) : new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function fmtDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
