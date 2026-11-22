import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import { institutions, profiles } from '../../src/db/schema.ts';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import { verifyAuthToken } from '../utils/crypto.ts';
import type { UserRole } from '../../shared/types.ts';

export const PRIMARY_HOST_EMAILS = new Set<string>([
  'sharveshragavendra252@gmail.com',
  'senthilkumarp@bitsathy.ac.in',
]);

export function isPrimaryHostEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return PRIMARY_HOST_EMAILS.has(email.trim().toLowerCase());
}

export interface HostSettingsSlice {
  addedHosts?: Array<{
    email: string;
    displayName?: string | null;
    addedByEmail?: string;
    addedAt?: string;
  }>;
}

export function isAuthorizedAddedHost(
  email: string | null | undefined,
  institutionSettings?: HostSettingsSlice | null
): boolean {
  if (!email || !institutionSettings?.addedHosts?.length) return false;
  const normalized = email.trim().toLowerCase();
  return institutionSettings.addedHosts.some(
    (entry) => typeof entry?.email === 'string' && entry.email.trim().toLowerCase() === normalized
  );
}

export function resolveEffectiveRole(
  email: string | null | undefined,
  institutionSettings?: HostSettingsSlice | null
): { role: UserRole; serverAdmin: boolean } {
  if (isPrimaryHostEmail(email)) {
    return { role: 'platform_admin', serverAdmin: true };
  }
  if (isAuthorizedAddedHost(email, institutionSettings)) {
    return { role: 'host', serverAdmin: false };
  }
  return { role: 'student', serverAdmin: false };
}

export interface AuthenticatedUser {
  id: string;
  authUid: string;
  email: string;
  displayName: string;
  role: UserRole;
  serverAdmin: boolean;
  institutionId: string;
  institutionName: string;
  status: string;
}

export interface AuthRequest extends Request {
  requestId?: string;
  currentUser?: AuthenticatedUser;
}

export function attachRequestId(req: AuthRequest, res: Response, next: NextFunction) {
  const id = crypto.randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in to continue.',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
  }

  const rawToken = authHeader.slice('Bearer '.length).trim();
  if (!rawToken) {
    return res.status(401).json({
      error: 'Invalid authentication token.',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
  }

  try {
    let profileRow:
      | {
          id: string;
          authUid: string;
          email: string;
          displayName: string;
          role: string;
          serverAdmin: boolean;
          institutionId: string;
          status: string;
          institutionName: string;
          institutionSettings: HostSettingsSlice | null;
        }
      | undefined;

    if (rawToken.startsWith('tp1.')) {
      const payload = verifyAuthToken(rawToken);
      if (!payload) {
        return res.status(401).json({
          error: 'Your session has expired. Please sign in again.',
          code: 'TOKEN_EXPIRED',
          requestId: req.requestId,
        });
      }
      const rows = await db
        .select({
          id: profiles.id,
          authUid: profiles.authUid,
          email: profiles.email,
          displayName: profiles.displayName,
          role: profiles.role,
          serverAdmin: profiles.serverAdmin,
          institutionId: profiles.institutionId,
          status: profiles.status,
          institutionName: institutions.name,
          institutionSettings: institutions.settings,
        })
        .from(profiles)
        .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
        .where(eq(profiles.id, payload.sub))
        .limit(1);
      profileRow = rows[0];
    } else {
      // Verify Firebase Google ID token
      const decoded = await adminAuth.verifyIdToken(rawToken);
      const rows = await db
        .select({
          id: profiles.id,
          authUid: profiles.authUid,
          email: profiles.email,
          displayName: profiles.displayName,
          role: profiles.role,
          serverAdmin: profiles.serverAdmin,
          institutionId: profiles.institutionId,
          status: profiles.status,
          institutionName: institutions.name,
          institutionSettings: institutions.settings,
        })
        .from(profiles)
        .innerJoin(institutions, eq(profiles.institutionId, institutions.id))
        .where(eq(profiles.authUid, decoded.uid))
        .limit(1);
      profileRow = rows[0];
    }

    if (!profileRow) {
      return res.status(401).json({
        error: 'Account profile not found. Please sign in again.',
        code: 'PROFILE_NOT_FOUND',
        requestId: req.requestId,
      });
    }

    if (profileRow.status !== 'active') {
      return res.status(403).json({
        error: 'This account is suspended. Contact your institution administrator.',
        code: 'ACCOUNT_SUSPENDED',
        requestId: req.requestId,
      });
    }

    const { role: enforcedRole, serverAdmin } = resolveEffectiveRole(
      profileRow.email,
      profileRow.institutionSettings
    );

    req.currentUser = {
      id: profileRow.id,
      authUid: profileRow.authUid,
      email: profileRow.email,
      displayName: profileRow.displayName,
      role: enforcedRole,
      serverAdmin,
      institutionId: profileRow.institutionId,
      institutionName: profileRow.institutionName,
      status: profileRow.status,
    };
    return next();
  } catch (err) {
    console.error('[auth] token verification failed:', err);
    return res.status(401).json({
      error: 'Unable to verify authentication credentials.',
      code: 'UNAUTHORIZED',
      requestId: req.requestId,
    });
  }
}

export function requireHost(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
  }
  if (req.currentUser.role !== 'host' && req.currentUser.role !== 'platform_admin') {
    return res.status(403).json({
      error: 'Host permissions are required to access this resource.',
      code: 'FORBIDDEN_ROLE',
      requestId: req.requestId,
    });
  }
  return next();
}

export function requireStudent(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
  }
  if (req.currentUser.role !== 'student') {
    return res.status(403).json({
      error: 'Student portal access is restricted to student accounts.',
      code: 'FORBIDDEN_ROLE',
      requestId: req.requestId,
    });
  }
  return next();
}

export function requireServerAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.currentUser) {
    return res.status(401).json({ error: 'Authentication required.', requestId: req.requestId });
  }
  if (req.currentUser.role !== 'platform_admin' && !req.currentUser.serverAdmin) {
    return res.status(403).json({
      error: 'Platform Administrator or Server Admin permission is required.',
      code: 'FORBIDDEN_SERVER_ADMIN',
      requestId: req.requestId,
    });
  }
  return next();
}

// Simple sliding-window in-memory rate limiter for sensitive endpoints
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(bucketName: string, maxRequests: number, windowMs: number) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userKey = req.currentUser?.id || ip;
    const key = `${bucketName}:${userKey}`;
    const now = Date.now();

    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= maxRequests) {
      const retrySeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      return res.status(429).json({
        error: `Too many requests. Please wait ${retrySeconds} seconds and try again.`,
        code: 'RATE_LIMITED',
        requestId: req.requestId,
      });
    }

    current.count += 1;
    return next();
  };
}
