import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { applyTheme, useSettings } from './db';
import { cx } from './components/ui';

function Placeholder({ name }: { name: string }) {
  return <div className="p-6 text-xl font-bold">{name}</div>;
}

function Tab(props: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) =>
        cx('flex min-h-[56px] flex-1 flex-col items-center justify-center text-xs font-bold tracking-widest',
          isActive ? 'text-accent' : 'text-mute')
      }
    >
      <span aria-hidden className="text-xl leading-6">{props.icon}</span>
      {props.label}
    </NavLink>
  );
}

export default function App() {
  const settings = useSettings();
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings.theme]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden" id="scroll">
        <Routes>
          <Route path="/" element={<Navigate to="/lift" replace />} />
          <Route path="/lift/*" element={<Placeholder name="LIFT" />} />
          <Route path="/fuel/*" element={<Placeholder name="FUEL" />} />
          <Route path="*" element={<Navigate to="/lift" replace />} />
        </Routes>
      </div>
      <nav
        aria-label="Sections"
        className="flex border-t border-line bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Tab to="/lift" label="LIFT" icon="🏋️" />
        <Tab to="/fuel" label="FUEL" icon="🔥" />
      </nav>
    </div>
  );
}
