import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { SESSION_COOKIE, requireAuth, attachSession } from '../middleware/auth.js';
import {
  getUserByUsername,
  verifyPassword,
  createSession,
  recordFailedLogin,
  recordSuccess,
  destroySession,
  changePassword,
  getUserById,
  toAuthUser,
} from '../services/auth.js';

const router = Router();

// Populate req.user / req.sessionToken from the cookie for public auth routes
// (me, logout) that sit before requireAuth. Non-blocking: no cookie → no user.
router.use(attachSession);

// IP rate-limit on the login endpoint — 10 attempts / 15min (single process, in-memory store).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts, try again later' },
});

const loginBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

const changePwBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(128),
});

function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.auth.cookieSecure });
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.auth.sessionTtlMs,
  });
}

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const parsed = loginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request' });
    return;
  }
  const { username, password } = parsed.data;
  const userRow = getUserByUsername(username);

  // Constant-ish failure path: if user doesn't exist, still run an argon2 verify
  // against a dummy hash to blunt timing/enumeration. Single user, but defense.
  if (!userRow) {
    await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$dummy$dummy', password).catch(() => false);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const now = Date.now();
  if (userRow.lockedUntil > now) {
    res.status(429).json({ error: 'account locked', lockedUntil: userRow.lockedUntil, retryAfter: Math.ceil((userRow.lockedUntil - now) / 1000) });
    return;
  }

  const ok = await verifyPassword(userRow.passwordHash, password);
  if (!ok) {
    const { locked, lockedUntil } = recordFailedLogin(toAuthUser(userRow));
    if (locked) {
      res.status(429).json({ error: 'account locked', lockedUntil, retryAfter: Math.ceil((lockedUntil - now) / 1000) });
    } else {
      res.status(401).json({ error: 'invalid credentials' });
    }
    return;
  }

  recordSuccess(toAuthUser(userRow));
  const { token } = createSession(userRow.id);
  setSessionCookie(res, token);
  res.json({ user: toAuthUser(userRow), mustResetPassword: userRow.mustResetPassword });
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  if (req.sessionToken) destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — 401 when unauthed (drives client redirect to /login)
router.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({ user: req.user, mustResetPassword: req.user.mustResetPassword });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const parsed = changePwBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'password must be 12–128 characters' });
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword === req.user!.username) {
    res.status(400).json({ error: 'password must not equal the username' });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({ error: 'new password must differ from the current password' });
    return;
  }
  const userRow = getUserById(req.user!.id);
  if (!userRow) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const ok = await verifyPassword(userRow.passwordHash, currentPassword);
  if (!ok) {
    res.status(401).json({ error: 'current password is incorrect' });
    return;
  }
  await changePassword(userRow.id, newPassword, req.sessionToken);
  res.json({ ok: true });
});

export default router;