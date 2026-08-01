import { useEffect, useState } from 'react';

export interface JobState {
  id: string;
  type: string;
  status: 'running' | 'done' | 'error';
  stage: string;
  progress: number;
  total: number;
  message: string;
  result?: unknown;
  error?: string;
}

/**
 * Subscribe to a server AI job's progress stream (SSE) at /api/ai/jobs/:id/events.
 * Pass a jobId to subscribe, or null to be idle. Returns the latest job snapshot
 * (or null before the first event). The stream closes itself on done/error.
 */
export function useJobProgress(jobId: string | null): JobState | null {
  const [state, setState] = useState<JobState | null>(null);

  useEffect(() => {
    setState(null);
    if (!jobId) return;
    let closed = false;
    const es = new EventSource(`/api/ai/jobs/${jobId}/events`);

    const apply = (raw: MessageEvent) => {
      if (!raw.data) return;
      try {
        const data = JSON.parse(raw.data) as JobState;
        setState(data);
        if (data.status === 'done' || data.status === 'error') {
          es.close();
        }
      } catch {
        /* ignore malformed */
      }
    };

    es.addEventListener('progress', apply as EventListener);
    es.addEventListener('done', apply as EventListener);
    es.addEventListener('error', (e) => {
      // Server-sent `event: error` carries data; a transport drop has none.
      if (e instanceof MessageEvent && e.data) {
        try {
          const data = JSON.parse(e.data) as JobState;
          setState({ ...(data as JobState), status: 'error' });
        } catch {
          /* ignore */
        }
        es.close();
      } else if (closed) {
        // intentional close
      }
    });

    return () => {
      closed = true;
      es.close();
    };
  }, [jobId]);

  return state;
}