import { NavLink, Route, Routes } from 'react-router-dom';
import { LayoutDashboard, UserSquare2, ListChecks, Upload, Tags, Wallet, Sparkles, DatabaseBackup } from 'lucide-react';
import { cn } from '@/lib/utils';
import OverviewPage from '@/pages/OverviewPage';
import DeepDivePage from '@/pages/DeepDivePage';
import TransactionsPage from '@/pages/TransactionsPage';
import ImportPage from '@/pages/ImportPage';
import CategoriesRulesPage from '@/pages/CategoriesRulesPage';
import AccountsMembersPage from '@/pages/AccountsMembersPage';
import AiSettingsPage from '@/pages/AiSettingsPage';
import BackupsPage from '@/pages/BackupsPage';

const nav = [
  { to: '/', label: 'Household', icon: LayoutDashboard, end: true },
  { to: '/deepdive', label: 'Person/Account', icon: UserSquare2 },
  { to: '/transactions', label: 'Transactions', icon: ListChecks },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/categories', label: 'Categories & Rules', icon: Tags },
  { to: '/accounts', label: 'Accounts & Members', icon: Wallet },
  { to: '/ai', label: 'AI & Insights', icon: Sparkles },
  { to: '/backups', label: 'Backups / Data', icon: DatabaseBackup },
];

export default function App() {
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
        <div className="mt-auto p-3 text-xs text-muted-foreground">
          AUD · en-AU · self-hosted
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        {/* Mobile nav */}
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card p-2 md:hidden">
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
        </div>
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/deepdive" element={<DeepDivePage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/categories" element={<CategoriesRulesPage />} />
            <Route path="/accounts" element={<AccountsMembersPage />} />
            <Route path="/ai" element={<AiSettingsPage />} />
            <Route path="/backups" element={<BackupsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}