import { type LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...p} />;
}