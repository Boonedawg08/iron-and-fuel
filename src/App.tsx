import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { applyTheme, useSettings } from './db';
import { cx } from './components/ui';
import LiftHome from './pages/lift/LiftHome';
import RoutineEdit from './pages/lift/RoutineEdit';
import Session from './pages/lift/Session';
import { ExerciseStats, History, WorkoutDetail } from './pages/lift/History';
import Settings from './pages/Settings';
import FuelHome from './pages/fuel/FuelHome';
import GoalSetup from './pages/fuel/GoalSetup';
import HowCalculated from './pages/fuel/HowCalculated';
import LogMeal from './pages/fuel/LogMeal';
import CustomFood from './pages/fuel/CustomFood';
import Weekly from './pages/fuel/Weekly';
import WeightLog from './pages/fuel/WeightLog';
import { foodsReady } from './lib/foodStore';

const ICONS = {
  lift: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <rect x="7" y="10.75" width="10" height="2.5" rx="1" />
      <rect x="4" y="6.5" width="2.5" height="11" rx="1.1" /><rect x="17.5" y="6.5" width="2.5" height="11" rx="1.1" />
      <rect x="1.2" y="8.75" width="2" height="6.5" rx="0.9" /><rect x="20.8" y="8.75" width="2" height="6.5" rx="0.9" />
    </svg>
  ),
  fuel: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <path d="M12.6 2c.9 3.4 5 5.2 5 9.6A5.6 5.6 0 0 1 12 17.2a5.6 5.6 0 0 1-5.6-5.6c0-2.3 1.2-3.7 2.3-5 .5 1.4 1.2 1.8 1.8 2-.2-2.5.2-4.5 2.1-6.6zM7 20h10a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2z" />
    </svg>
  ),
};

function Tab(props: { to: string; label: string; icon: keyof typeof ICONS }) {
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) =>
        cx('flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-xs font-bold tracking-widest',
          isActive ? 'text-accent' : 'text-mute')
      }
    >
      {ICONS[props.icon]}
      {props.label}
    </NavLink>
  );
}

/** Each screen starts at the top; changing the date or other query values keeps your place. */
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => { document.getElementById('scroll')?.scrollTo(0, 0); }, [pathname]);
  return null;
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

  // Warm the food database in the background so logging is instant.
  useEffect(() => { const t = setTimeout(() => void foodsReady().catch(() => {}), 800); return () => clearTimeout(t); }, []);

  return (
    <div className="app-height flex flex-col" style={{ paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
      {/* Installed on iPhone the page runs under the status bar, whose text is always white: keep a dark strip behind it in both themes. */}
      <div aria-hidden className="shrink-0 bg-[#0b0d10]" style={{ height: 'env(safe-area-inset-top)' }} />
      <ScrollReset />
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" id="scroll">
        <Routes>
          <Route path="/" element={<Navigate to="/lift" replace />} />
          <Route path="/lift" element={<LiftHome />} />
          <Route path="/lift/routine/:id" element={<RoutineEdit />} />
          <Route path="/lift/session" element={<Session />} />
          <Route path="/lift/history" element={<History />} />
          <Route path="/lift/workout/:id" element={<WorkoutDetail />} />
          <Route path="/lift/exercise/:id" element={<ExerciseStats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/fuel" element={<FuelHome />} />
          <Route path="/fuel/goals" element={<GoalSetup />} />
          <Route path="/fuel/math" element={<HowCalculated />} />
          <Route path="/fuel/log" element={<LogMeal />} />
          <Route path="/fuel/food/:id" element={<CustomFood />} />
          <Route path="/fuel/week" element={<Weekly />} />
          <Route path="/fuel/weight" element={<WeightLog />} />
          <Route path="*" element={<Navigate to="/lift" replace />} />
        </Routes>
      </div>
      <nav
        aria-label="Sections"
        className="flex border-t border-line bg-card"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <Tab to="/lift" label="LIFT" icon="lift" />
        <Tab to="/fuel" label="FUEL" icon="fuel" />
      </nav>
    </div>
  );
}
