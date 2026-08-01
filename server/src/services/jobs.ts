// In-memory job registry for long-running AI processes (insight, forecast,
// re-categorize). Each job streams progress events via an EventEmitter which the
// SSE route subscribes to. Jobs are ephemeral: a server restart drops them. This
// is a single-user, self-hosted app, so durability across restarts is not needed.
import { EventEmitter } from 'node:events';
import { uid } from '../utils.js';

export type JobStatus = 'running' | 'done' | 'error';

export interface Job {
  id: string;
  type: string; // 'insight' | 'forecast' | 'forecast-report' | 'recategorize' | ...
  status: JobStatus;
  stage: string; // human-readable current stage
  progress: number; // completed units (batches, stages, transactions)
  total: number; // total units; 0 = indeterminate
  message: string;
  result?: unknown; // final payload on 'done'
  error?: string; // message on 'error'
  startedAt: string;
  updatedAt: string;
}

const jobs = new Map<string, Job>();
const emitters = new Map<string, EventEmitter>();

/** Max jobs retained; prune oldest finished beyond this to bound memory. */
const MAX_JOBS = 50;

function prune() {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.entries()].filter(([, j]) => j.status !== 'running').sort((a, b) => a[1].updatedAt.localeCompare(b[1].updatedAt));
  while (jobs.size > MAX_JOBS && finished.length) {
    const [id] = finished.shift()!;
    jobs.delete(id);
    emitters.get(id)?.removeAllListeners();
    emitters.delete(id);
  }
}

export function createJob(type: string, total = 0): Job {
  const id = uid();
  const now = new Date().toISOString();
  const job: Job = { id, type, status: 'running', stage: 'starting', progress: 0, total, message: '', startedAt: now, updatedAt: now };
  const em = new EventEmitter();
  jobs.set(id, job);
  emitters.set(id, em);
  prune();
  emit(id);
  return job;
}

export function updateJob(id: string, patch: Partial<Pick<Job, 'stage' | 'progress' | 'total' | 'message'>>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  emit(id);
}

export function finishJob(id: string, result?: unknown): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'done';
  job.progress = job.total || job.progress;
  job.stage = 'done';
  job.result = result;
  job.updatedAt = new Date().toISOString();
  emit(id, true);
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  job.stage = 'error';
  job.message = error;
  job.updatedAt = new Date().toISOString();
  emit(id, true);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function jobEmitter(id: string): EventEmitter | undefined {
  return emitters.get(id);
}

function emit(id: string, terminal = false): void {
  const job = jobs.get(id);
  const em = emitters.get(id);
  if (!job || !em) return;
  em.emit('progress', snapshot(job));
  if (terminal) em.emit('done', snapshot(job));
}

export function snapshot(job: Job): Job {
  return { ...job };
}