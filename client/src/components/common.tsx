import { type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn, formatAUD, pct } from '@/lib/utils';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-xl font-bold md:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, delta, hint, tone = 'default' }: { label: string; value: string; delta?: number | null; hint?: string; tone?: 'default' | 'positive' | 'negative' }) {
  const deltaColor = delta == null ? '' : delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-muted-foreground';
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-bold', tone === 'positive' && 'text-emerald-400', tone === 'negative' && 'text-red-400')}>{value}</div>
      {delta != null && <div className={cn('mt-0.5 text-xs font-medium', deltaColor)}>{pct(delta)} vs last month</div>}
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function EmptyState({ message, icon }: { message: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      {icon}
      <p className="text-sm">{message}</p>
    </div>
  );
}

export function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('text-xs font-medium', delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-muted-foreground')}>
      {pct(delta)}
    </span>
  );
}

export function Money({ amount, signed = false }: { amount: number; signed?: boolean }) {
  const cls = amount < 0 ? 'text-red-400' : amount > 0 && signed ? 'text-emerald-400' : '';
  return <span className={cls}>{formatAUD(amount)}</span>;
}