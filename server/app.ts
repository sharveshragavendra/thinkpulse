import express from 'express';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import { ensureDatabaseSchema } from '../src/db/bootstrapSchema.ts';
import { attachRequestId, requireAuth, type AuthRequest } from './middleware/auth.ts';
import {
  consumeRealtimeTicket,
  issueRealtimeTicket,
  registerSseClient,
} from './realtime/bus.ts';
import authRoutes from './routes/auth.ts';
import hostRoutes from './routes/host.ts';
import studentRoutes from './routes/student.ts';
import adminRoutes from './routes/admin.ts';

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  // Strict CORS (never wildcard on authenticated routes)
  const allowedOrigins = new Set<string>(
    (process.env.APP_ORIGIN || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (process.env.APP_URL) allowedOrigins.add(process.env.APP_URL.trim());
  if (process.env.VERCEL_URL) allowedOrigins.add(`https://${process.env.VERCEL_URL.trim()}`);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    allowedOrigins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`);
  }

  app.use(
    cors((req, callback) => {
      const origin = req.header('Origin');
      if (!origin) {
        return callback(null, { origin: false });
      }

      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return callback(new Error('Origin not allowed by CORS policy'));
      }

      const forwardedHost = req.header('x-forwarded-host')?.split(',')[0]?.trim();
      const requestHost = forwardedHost || req.header('host') || '';
      const isSameOrigin = Boolean(requestHost) && parsed.host === requestHost;
      const isLocalDev =
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
      const isTrustedHosting =
        parsed.protocol === 'https:' &&
        (parsed.hostname.endsWith('.run.app') || parsed.hostname.endsWith('.vercel.app'));

      if (isSameOrigin || allowedOrigins.has(origin) || isLocalDev || isTrustedHosting) {
        return callback(null, {
          origin: true,
          credentials: false,
          methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
          allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Result-Token'],
        });
      }

      return callback(new Error('Origin not allowed by CORS policy'));
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestId);

  // Security headers compatible with AI Studio iframe & Vercel hosting
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Health endpoints
  app.get('/api/v1/health/live', (_req, res) => {
    res.json({ status: 'ok', service: 'thinkpulse-api', timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await ensureDatabaseSchema();
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ready', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('[health] readiness check failed:', err);
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
  });

  // Lazily guarantee PostgreSQL schema on cold starts (e.g., Vercel serverless invocations)
  app.use('/api/v1', async (_req, _res, next) => {
    try {
      await ensureDatabaseSchema();
    } catch (err) {
      console.error('[api] schema ensure warning:', err);
    }
    next();
  });

  // Authenticated SSE real-time stream (two-step one-time ticket avoids putting Bearer tokens in URLs)
  app.post('/api/v1/realtime/ticket', requireAuth, (req: AuthRequest, res) => {
    const ticket = issueRealtimeTicket({
      userId: req.currentUser!.id,
      institutionId: req.currentUser!.institutionId,
      role: req.currentUser!.role,
    });
    res.json({ ticket });
  });

  app.get('/api/v1/realtime/stream', (req, res) => {
    const ticket = typeof req.query.ticket === 'string' ? req.query.ticket : '';
    const session = consumeRealtimeTicket(ticket);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired realtime stream ticket.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const unregister = registerSseClient({
      userId: session.userId,
      institutionId: session.institutionId,
      role: session.role,
      res,
    });

    req.on('close', unregister);
  });

  // Versioned REST API routes
  app.use('/api/v1', authRoutes);
  app.use('/api/v1', hostRoutes);
  app.use('/api/v1', studentRoutes);
  app.use('/api/v1', adminRoutes);

  // API 404 handler
  app.use('/api', (req: AuthRequest, res) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.originalUrl}`,
      requestId: req.requestId,
    });
  });

  // Global error handler
  app.use((err: Error, req: AuthRequest, res: express.Response, _next: express.NextFunction) => {
    console.error('[server] unhandled error:', err);
    res.status(500).json({
      error: 'An unexpected server error occurred.',
      requestId: req.requestId,
    });
  });

  return app;
}
