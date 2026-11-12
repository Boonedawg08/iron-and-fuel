import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Page frame: sticky header with optional back button and right-side action. */
export function Page(props: { title: string; back?: string | true; right?: ReactNode; children: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mx-auto w-full max-w-md">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-bg/95 px-3 backdrop-blur">
        {props.back && (
          <IconBtn label="Back" className="-ml-2 text-2xl text-mute" onClick={() => (props.back === true ? nav(-1) : nav(props.back as string))}>‹</IconBtn>
        )}
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">{props.title}</h1>
        {props.right}
      </header>
      <main className="space-y-3 px-3 pb-6 pt-3">{props.children}</main>
    </div>
  );
}

type BtnKind = 'primary' | 'outline' | 'ghost' | 'danger';
const BTN: Record<BtnKind, string> = {
  primary: 'bg-accent text-[rgb(var(--accent-ink))] font-semibold',
  outline: 'border border-line bg-card text-ink font-medium',
  ghost: 'text-accent font-medium',
  danger: 'border border-bad/50 text-bad font-medium',
};
export function Btn(props: {
  kind?: BtnKind; onClick?: () => void; children: ReactNode; className?: string;
  disabled?: boolean; to?: string; type?: 'button' | 'submit'; full?: boolean; small?: boolean; label?: string;
}) {
  const cls = cx(
    'inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl px-4 text-center active:opacity-70 disabled:opacity-40',
    props.small ? 'text-sm' : 'text-base', props.full && 'w-full', BTN[props.kind ?? 'outline'], props.className,
  );
  if (props.to) return <Link to={props.to} className={cls} aria-label={props.label}>{props.children}</Link>;
  return (
    <button type={props.type ?? 'button'} className={cls} onClick={props.onClick} disabled={props.disabled} aria-label={props.label}>
      {props.children}
    </button>
  );
}

/** A 44x44 px icon button: the minimum comfortable thumb target. */
export function IconBtn(props: { label: string; onClick?: () => void; children: ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button" aria-label={props.label} onClick={props.onClick} disabled={props.disabled}
      className={cx('grid h-11 w-11 shrink-0 place-items-center rounded-full active:bg-line disabled:opacity-30', props.className)}
    >
      {props.children}
    </button>
  );
}

export function Card(props: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-card p-3', props.className)}>{props.children}</section>;
}

export function Empty(props: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-mute">{props.children}</p>;
}

/**
 * Numeric input that opens the phone's number pad. Keeps its own text while focused so
 * half-typed values like "12." aren't clobbered, and reports parsed numbers upward.
 */
export function NumField(props: {
  value: number | undefined; onChange: (n: number | undefined) => void; decimal?: boolean;
  className?: string; placeholder?: string; label?: string; min?: number; id?: string;
}) {
  const fmt = (n: number | undefined) => (n === undefined || Number.isNaN(n) ? '' : String(n));
  const [text, setText] = useState(fmt(props.value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(props.value)); }, [props.value]);
  return (
    <input
      id={props.id}
      aria-label={props.label}
      className={cx('field tnum', props.className)}
      type="text"
      inputMode={props.decimal === false ? 'numeric' : 'decimal'}
      pattern={props.decimal === false ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'}
      autoComplete="off"
      placeholder={props.placeholder}
      value={text}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onBlur={() => { focused.current = false; setText(fmt(props.value)); }}
      onChange={(e) => {
        const raw = e.target.value.replace(',', '.').replace(props.decimal === false ? /[^0-9]/g : /[^0-9.]/g, '');
        setText(raw);
        if (raw === '' || raw === '.') return props.onChange(undefined);
        const n = Number(raw);
        if (!Number.isNaN(n) && n >= (props.min ?? 0)) props.onChange(n);
      }}
    />
  );
}

export function Seg<T extends string>(props: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg p-1">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === props.value}
          onClick={() => props.onChange(o.value)}
          className={cx(
            'min-h-[44px] flex-1 whitespace-nowrap rounded-lg px-2 text-sm font-medium',
            o.value === props.value ? 'bg-accent text-[rgb(var(--accent-ink))]' : 'text-mute',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Bottom sheet modal. */
export function Sheet(props: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [props.open]);
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={props.onClose}>
      <div
        role="dialog"
        aria-label={props.title}
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-3xl border-t border-line bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <h2 className="flex-1 truncate text-lg font-bold">{props.title}</h2>
          <IconBtn label="Close" onClick={props.onClose} className="-mr-2 text-xl text-mute">✕</IconBtn>
        </div>
        <div className="space-y-3 overflow-y-auto overscroll-contain p-4">{props.children}</div>
      </div>
    </div>
  );
}

/** Progress toward a target: eaten / target / remaining. */
export function Progress(props: { label: string; value: number; target: number; unit: string; big?: boolean }) {
  const { value, target } = props;
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const left = Math.round(target - value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cx('font-semibold', props.big ? 'text-base' : 'text-sm')}>{props.label}</span>
        <span className="tnum text-sm text-mute">
          <span className={cx('font-bold text-ink', props.big ? 'text-2xl' : 'text-base')}>{Math.round(value)}</span>
          {' / '}{Math.round(target)} {props.unit}
        </span>
      </div>
      <div
        className={cx('mt-1 overflow-hidden rounded-full bg-line', props.big ? 'h-3' : 'h-2')}
        role="progressbar" aria-label={props.label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={Math.round(target)}
      >
        <div className="h-full rounded-full bg-chart transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="tnum mt-0.5 text-xs text-mute">
        {left >= 0 ? `${left} ${props.unit} remaining` : `${-left} ${props.unit} over`}
      </div>
    </div>
  );
}

export function Row(props: { children: ReactNode; className?: string }) {
  return <div className={cx('flex items-center gap-2', props.className)}>{props.children}</div>;
}

export function confirmDialog(msg: string): boolean {
  return window.confirm(msg);
}
