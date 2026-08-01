import { useEffect, useRef } from 'react';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useJobProgress } from '@/app/useJobProgress';
import { Button } from '@/components/ui/button';

/** Modal that streams a server AI job's progress and shows a progress bar.
 *  `jobId` null => hidden. `onDone(result)` fires once when the job completes
 *  successfully; the caller can invalidate tags / apply the result there. */
export function JobProgressModal({
  jobId,
  title = 'Working…',
  onDone,
  onClose,
  closeOnDone = true,
}: {
  jobId: string | null;
  title?: string;
  onDone?: (result: unknown) => void;
  onClose?: () => void;
  closeOnDone?: boolean;
}) {
  const state = useJobProgress(jobId);
  const firedRef = useRef(false);

  useEffect(() => {
    if (state?.status === 'done' && !firedRef.current) {
      firedRef.current = true;
      onDone?.(state.result);
      if (closeOnDone) onClose?.();
    }
    if (state?.status === 'error' && !firedRef.current) {
      firedRef.current = true;
    }
  }, [state, onDone, onClose, closeOnDone]);

  useEffect(() => {
    if (jobId) firedRef.current = false;
  }, [jobId]);

  if (!jobId) return null;

  const determinate = !!state && state.total > 0;
  const pct = determinate ? Math.min(100, Math.round((state!.progress / state!.total) * 100)) : 0;
  const running = !state || state.status === 'running';
  const stage = state?.stage ?? 'starting…';
  const done = state?.status === 'done';
  const err = state?.status === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2 text-lg font-semibold">
          {running && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
          {done && <CheckCircle2 className="h-5 w-5 text-emerald-400" />}
          {err && <XCircle className="h-5 w-5 text-red-400" />}
          {title}
        </div>

        <p className="mb-3 text-sm text-muted-foreground">{stage}</p>

        {/* Progress bar */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          {determinate ? (
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
          ) : running ? (
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          ) : (
            <div className={`h-full w-full rounded-full ${done ? 'bg-emerald-500' : 'bg-red-500'}`} />
          )}
        </div>

        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{state?.message || (determinate ? `${state!.progress}/${state!.total}` : '')}</span>
          {determinate && <span>{pct}%</span>}
        </div>

        {err && <p className="mt-3 text-sm text-red-400">{state?.error || 'Job failed'}</p>}

        <div className="mt-5 flex justify-end gap-2">
          {running ? (
            <Button variant="ghost" onClick={onClose}>Hide</Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </div>
      </div>
    </div>
  );
}