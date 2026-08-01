import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Dialog({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; className?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={cn('relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto', className)}>
        {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}