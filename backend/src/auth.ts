import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const SESSION_COOKIE_NAME = 'tasklink_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

if (!SESSION_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('SESSION_SECRET is not set; set this in production.');
}

export interface SessionPayload {
  userId: string;
  email?: string | null;
  remember?: boolean;
}

export function setSessionCookie(res: Response, payload: SessionPayload) {
  const remember = !!payload.remember;
  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : undefined; // 30 days or session-only

  const token = jwt.sign(
    { userId: payload.userId, email: payload.email ?? null },
    SESSION_SECRET,
    {
      expiresIn: remember ? '30d' : '1d',
    },
  );

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Frontend and backend are on different subdomains (Render), so we need SameSite=None
    // for the cookie to be sent on cross-site fetch requests with credentials: 'include'.
    sameSite: 'none',
    path: '/',
    maxAge: maxAgeSeconds ? maxAgeSeconds * 1000 : undefined,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    path: '/',
  });
}

export function getSessionFromRequest(req: Request): SessionPayload | null {
  const raw = (req as any).cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  if (!raw) return null;
  try {
    const decoded = jwt.verify(raw, SESSION_SECRET) as { userId: string; email?: string | null };
    return {
      userId: decoded.userId,
      email: decoded.email ?? null,
    };
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const session = getSessionFromRequest(req);
  if (session) {
    (req as any).userId = session.userId;
    (req as any).userEmail = session.email ?? null;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Ensure downstream handlers can still read userId/email from the request.
  (req as any).userId = session.userId;
  (req as any).userEmail = session.email ?? null;
  return next();
}

export function getUserIdFromRequest(req: Request): string {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    throw new Error('User ID missing on request. Did you forget to use requireAuth?');
  }
  return userId;
}

export function getUserEmailFromRequest(req: Request): string | null {
  const email = (req as any).userEmail as string | undefined;
  return email ?? null;
}

export function redirectToFrontend(res: Response) {
  res.redirect(FRONTEND_URL);
}

