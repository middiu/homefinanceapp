import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'default' | 'success' | 'warning' | 'danger' | 'muted';
const tones: Record<Tone, string> = {
  default: 'bg-primary/15 text-primary',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-400',
  danger: 'bg-red-500/15 text-red-400',
  muted: 'bg-muted text-muted-foreground',
};

export function Badge({ className, tone = 'default', ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)} {...p} />;
}