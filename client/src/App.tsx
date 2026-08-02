import { NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, UserSquare2, ListChecks, Upload, Tags, Wallet, Sparkles, DatabaseBackup, TrendingUp, BarChart3, PieChart, Sun, Moon, PiggyBank, Lightbulb, Target, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './app/theme';
import { RequireAuth } from './app/auth';
import { useLogoutMutation } from './app/api';
import OverviewPage from '@/pages/OverviewPage';
import DeepDivePage from '@/pages/DeepDivePage';
import TransactionsPage from '@/pages/TransactionsPage';
import ImportPage from '@/pages/ImportPage';
import CategoriesRulesPage from '@/pages/CategoriesRulesPage';
import AccountsMembersPage from '@/pages/AccountsMembersPage';
import AiSettingsPage from '@/pages/AiSettingsPage';
import BackupsPage from '@/pages/BackupsPage';
import InvestmentsPage from '@/pages/InvestmentsPage';
import ReportIncomeExpensePage from '@/pages/ReportIncomeExpensePage';
import ReportCategoryAnalyticsPage from '@/pages/ReportCategoryAnalyticsPage';
import ReportForecastPage from '@/pages/ReportForecastPage';
import InsightsPage from '@/pages/InsightsPage';
import BudgetsPage from '@/pages/BudgetsPage';
import BudgetReportPage from '@/pages/BudgetReportPage';
import LoginPage from '@/pages/LoginPage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';

const nav = [
  // Dashboards / reports
  { to: '/', label: 'Household', icon: LayoutDashboard, end: true },
  { to: '/deepdive', label: 'Person/Account', icon: UserSquare2 },
  { to: '/reports/income-expense', label: 'Income vs Expense', icon: BarChart3 },
  { to: '/reports/categories', label: 'Category analytics', icon: PieChart },
  { to: '/reports/budget', label: 'Budget report', icon: Target },
  { to: '/reports/forecast', label: 'Forecast', icon: Sparkles },
  { to: '/insights', label: 'Insights', icon: Lightbulb },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  // Operational
  { to: '/transactions', label: 'Transactions', icon: ListChecks },
  { to: '/import', label: 'Import', icon: Upload },
  // Admin / settings
  { to: '/categories', label: 'Categories & Rules', icon: Tags },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/accounts', label: 'Accounts & Members', icon: Wallet },
  { to: '/ai', label: 'AI & Insights', icon: Sparkles },
  { to: '/backups', label: 'Backups / Data', icon: DatabaseBackup },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}

function LogoutButton() {
  const navigate = useNavigate();
  const [logout] = useLogoutMutation();
  return (
    <button
      type="button"
      onClick={async () => { await logout(); navigate('/login', { replace: true }); }}
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Sign out"
    >
      <LogOut className="h-3.5 w-3.5" /> Sign out
    </button>
  );
}

/** Authenticated shell: sidebar + main with an <Outlet/> for the nested routes. */
function AppLayout() {
  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Wallet className="h-5 w-5 text-primary" />
          <span className="text-lg font-bold">HomeFinance</span>
        </div>
        <nav className="flex flex-col gap-1 p-2">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 p-3">
          <span className="text-xs text-muted-foreground">AUD · en-AU</span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {/* Mobile nav */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-border bg-card p-2 md:hidden">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn('flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs', isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground')
              }
            >
              <n.icon className="h-3.5 w-3.5" />
              {n.label}
            </NavLink>
          ))}
          <ThemeToggle />
        </div>
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <Outlet />
        </div>
        <div className="hidden border-t border-border px-4 py-2 md:flex md:justify-end">
          <LogoutButton />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<AppLayout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/deepdive" element={<DeepDivePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/investments" element={<InvestmentsPage />} />
          <Route path="/reports/income-expense" element={<ReportIncomeExpensePage />} />
          <Route path="/reports/categories" element={<ReportCategoryAnalyticsPage />} />
          <Route path="/reports/budget" element={<BudgetReportPage />} />
          <Route path="/reports/forecast" element={<ReportForecastPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/budgets" element={<BudgetsPage />} />
          <Route path="/categories" element={<CategoriesRulesPage />} />
          <Route path="/accounts" element={<AccountsMembersPage />} />
          <Route path="/ai" element={<AiSettingsPage />} />
          <Route path="/backups" element={<BackupsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}