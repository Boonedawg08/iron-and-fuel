import { useEffect } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
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

  // Warm the food database in the background so logging is instant.
  useEffect(() => { const t = setTimeout(() => void foodsReady().catch(() => {}), 800); return () => clearTimeout(t); }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto overflow-x-hidden" id="scroll">
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
        <Tab to="/lift" label="LIFT" icon="🏋️" />
        <Tab to="/fuel" label="FUEL" icon="🔥" />
      </nav>
    </div>
  );
}
