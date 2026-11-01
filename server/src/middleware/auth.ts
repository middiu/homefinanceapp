import type { Request, Response, NextFunction } from 'express';
import { getSession, type AuthUserRow } from '../services/auth.js';

// Augment Express Request with the authenticated user attached by getSession.
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUserRow;
    sessionToken?: string; // raw cookie token (for change-password to keep its own session)
  }
}

export const SESSION_COOKIE = 'hf_session';

/** Reads the session cookie, looks up the session, attaches req.user + req.sessionToken. */
export function loadSession(req: Request): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return;
  const user = getSession(token);
  if (user) {
    req.user = user;
    req.sessionToken = token;
  }
}

/** Middleware: attach req.user if a valid session exists (does not block). */
export const attachSession = (req: Request, _res: Response, next: NextFunction) => {
  loadSession(req);
  next();
};

/** Middleware: require a valid session, else 401. Allows a password-reset session. */
export const requireSession = (req: Request, res: Response, next: NextFunction) => {
  loadSession(req);
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};

/** Middleware: require a session that has finished the forced password reset. */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  loadSession(req);
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.user.mustResetPassword) {
    res.status(403).json({ error: 'password reset required' });
    return;
  }
  next();
};