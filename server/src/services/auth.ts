import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { eq, lt } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';

// argon2id (Algorithm.Argon2id === 2) — OWASP recommended (memory-hard, GPU-resistant).
// Use the literal so isolatedModules doesn't trip on the const-enum import.
const ARGON2_OPTS = {
  algorithm: 2,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export interface AuthUserRow {
  id: string;
  username: string;
  mustResetPassword: boolean;
  failedAttempts: number;
  lockedUntil: number;
  lastLoginAt: number;
}

const db = () => getDb();
const nowMs = () => Date.now();

function sha256hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function toAuthUser(u: typeof schema.users.$inferSelect): AuthUserRow {
  return {
    id: u.id,
    username: u.username,
    mustResetPassword: u.mustResetPassword,
    failedAttempts: u.failedAttempts,
    lockedUntil: u.lockedUntil,
    lastLoginAt: u.lastLoginAt,
  };
}

export async function hashPassword(pw: string): Promise<string> {
  return hash(pw, ARGON2_OPTS);
}

export async function verifyPassword(hashStr: string, pw: string): Promise<boolean> {
  try {
    return await verify(hashStr, pw);
  } catch {
    return false; // malformed hash → treat as no match (don't leak)
  }
}

export function getUserByUsername(username: string) {
  return db().select().from(schema.users).where(eq(schema.users.username, username)).get();
}

export function getUserById(id: string) {
  return db().select().from(schema.users).where(eq(schema.users.id, id)).get();
}

/** Create a session row. Returns the RAW token (cookie value) — only the sha256 hash is stored. */
export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex');
  const tokenHash = sha256hex(token);
  const expiresAt = nowMs() + config.auth.sessionTtlMs;
  db().insert(schema.sessions).values({
    tokenHash,
    userId,
    expiresAt,
    lastSeenAt: nowMs(),
  }).run();
  return { token, expiresAt };
}

/** Look up a session by raw token; sliding-renew on hit. Returns the user or null. */
export function getSession(token: string): AuthUserRow | null {
  if (!token) return null;
  const tokenHash = sha256hex(token);
  const row = db().select().from(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).get();
  if (!row) return null;
  const now = nowMs();
  if (row.expiresAt <= now) {
    // expired — clean up
    db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).run();
    return null;
  }
  const user = getUserById(row.userId);
  if (!user) {
    db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, tokenHash)).run();
    return null;
  }
  // sliding renewal
  const newExpires = now + config.auth.sessionTtlMs;
  db().update(schema.sessions).set({ lastSeenAt: now, expiresAt: newExpires }).where(eq(schema.sessions.tokenHash, tokenHash)).run();
  return toAuthUser(user);
}

export function destroySession(token: string): void {
  if (!token) return;
  db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256hex(token))).run();
}

export function destroyAllUserSessions(userId: string, exceptToken?: string): void {
  const exceptHash = exceptToken ? sha256hex(exceptToken) : undefined;
  const all = db().select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).all();
  for (const s of all) {
    if (exceptHash && s.tokenHash === exceptHash) continue;
    db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, s.tokenHash)).run();
  }
}

/** Sweep expired sessions (best-effort, called on boot). */
export function pruneExpiredSessions(): void {
  db().delete(schema.sessions).where(lt(schema.sessions.expiresAt, nowMs())).run();
}

/** Progressive account lockout: after maxFailedAttempts, set lockedUntil growing with attempts. */
export function recordFailedLogin(user: AuthUserRow): { locked: boolean; lockedUntil: number } {
  const attempts = user.failedAttempts + 1;
  let lockedUntil = user.lockedUntil;
  const max = config.auth.maxFailedAttempts;
  if (attempts >= max) {
    // grows up to 6× base (capped 30min)
    const mult = Math.min(attempts - max + 1, 6);
    lockedUntil = nowMs() + Math.min(config.auth.lockoutBaseMs * mult, 30 * 60 * 1000);
  }
  db().update(schema.users).set({
    failedAttempts: attempts,
    lockedUntil,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.users.id, user.id)).run();
  return { locked: lockedUntil > nowMs(), lockedUntil };
}

export function recordSuccess(user: AuthUserRow): void {
  db().update(schema.users).set({
    failedAttempts: 0,
    lockedUntil: 0,
    lastLoginAt: nowMs(),
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.users.id, user.id)).run();
}

/** Change password: rehash, clear mustReset, invalidate all other sessions (caller keeps current). */
export async function changePassword(userId: string, newPw: string, currentToken?: string): Promise<void> {
  const passwordHash = await hashPassword(newPw);
  db().update(schema.users).set({
    passwordHash,
    mustResetPassword: false,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.users.id, userId)).run();
  destroyAllUserSessions(userId, currentToken);
}

/** Seed the single admin user on first boot (idempotent — only when users table empty). */
export async function seedAdmin(): Promise<void> {
  const existing = db().select().from(schema.users).all();
  if (existing.length > 0) return;
  const passwordHash = await hashPassword(config.auth.adminInitialPassword);
  db().insert(schema.users).values({
    id: randomUUID(),
    username: 'admin',
    passwordHash,
    mustResetPassword: true,
    failedAttempts: 0,
    lockedUntil: 0,
    lastLoginAt: 0,
  }).run();
}