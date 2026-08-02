import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupDb, getDb, schema } from './dbHelper.js';
import {
  hashPassword, verifyPassword, seedAdmin, getUserByUsername,
  createSession, getSession, destroySession, destroyAllUserSessions,
  recordFailedLogin, recordSuccess, changePassword, toAuthUser,
} from '../services/auth.js';
import { config } from '../config.js';

beforeEach(() => setupDb());

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('rightpw');
    expect(await verifyPassword(hash, 'wrongpw')).toBe(false);
  });

  it('returns false for a malformed hash', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });
});

describe('seedAdmin', () => {
  it('seeds the admin user on first call', async () => {
    await seedAdmin();
    const admin = getUserByUsername('admin');
    expect(admin).toBeDefined();
    expect(admin!.mustResetPassword).toBe(true);
    expect(await verifyPassword(admin!.passwordHash, config.auth.adminInitialPassword)).toBe(true);
  });

  it('is idempotent — does not re-seed if a user exists', async () => {
    await seedAdmin();
    // insert a different password out-of-band to detect re-seed
    getDb().update(schema.users).set({ passwordHash: 'marker' }).where(
      eq(schema.users.id, getUserByUsername('admin')!.id),
    ).run();
    await seedAdmin();
    const admin = getUserByUsername('admin');
    expect(admin!.passwordHash).toBe('marker'); // untouched
    // only one user
    expect(getDb().select().from(schema.users).all().length).toBe(1);
  });
});

describe('brute-force lockout', () => {
  it('locks after maxFailedAttempts and resets on success', async () => {
    await seedAdmin();
    let user = toAuthUser(getUserByUsername('admin')!);
    const max = config.auth.maxFailedAttempts;
    let lastLocked = false;
    for (let i = 0; i < max; i++) {
      const res = recordFailedLogin(user);
      lastLocked = res.locked;
      user = toAuthUser(getUserByUsername('admin')!);
    }
    expect(lastLocked).toBe(true);
    expect(user.lockedUntil).toBeGreaterThan(Date.now());
    expect(user.failedAttempts).toBe(max);

    // success resets
    recordSuccess(user);
    user = toAuthUser(getUserByUsername('admin')!);
    expect(user.failedAttempts).toBe(0);
    expect(user.lockedUntil).toBe(0);
  });
});

describe('sessions', () => {
  it('creates, looks up, and destroys a session', async () => {
    await seedAdmin();
    const admin = getUserByUsername('admin')!;
    const { token } = createSession(admin.id);
    expect(token).toHaveLength(64); // 32 bytes hex
    const user = getSession(token);
    expect(user?.id).toBe(admin.id);
    destroySession(token);
    expect(getSession(token)).toBeNull();
  });

  it('rejects a session for a nonexistent token', () => {
    expect(getSession('deadbeef')).toBeNull();
  });

  it('destroyAllUserSessions kills all but the kept token', async () => {
    await seedAdmin();
    const admin = getUserByUsername('admin')!;
    const a = createSession(admin.id).token;
    const b = createSession(admin.id).token;
    const c = createSession(admin.id).token;
    expect(getSession(a)).not.toBeNull();
    expect(getSession(b)).not.toBeNull();
    expect(getSession(c)).not.toBeNull();
    destroyAllUserSessions(admin.id, a);
    expect(getSession(a)?.id).toBe(admin.id); // kept
    expect(getSession(b)).toBeNull();
    expect(getSession(c)).toBeNull();
  });
});

describe('changePassword', () => {
  it('rehashes, clears mustReset, and invalidates other sessions', async () => {
    await seedAdmin();
    const admin = getUserByUsername('admin')!;
    const keep = createSession(admin.id).token;
    const other = createSession(admin.id).token;
    expect(getSession(other)?.id).toBe(admin.id);

    await changePassword(admin.id, 'a-brand-new-password', keep);
    const after = getUserByUsername('admin')!;
    expect(after.mustResetPassword).toBe(false);
    expect(await verifyPassword(after.passwordHash, 'a-brand-new-password')).toBe(true);
    expect(await verifyPassword(after.passwordHash, config.auth.adminInitialPassword)).toBe(false);
    // kept session survives, others revoked
    expect(getSession(keep)?.id).toBe(admin.id);
    expect(getSession(other)).toBeNull();
  });
});