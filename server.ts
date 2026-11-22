import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import { ensureDatabaseSchema } from './src/db/bootstrapSchema.ts';
import { attachRequestId, requireAuth, type AuthRequest } from './server/middleware/auth.ts';
import {
  consumeRealtimeTicket,
  issueRealtimeTicket,
  registerSseClient,
} from './server/realtime/bus.ts';
import authRoutes from './server/routes/auth.ts';
import hostRoutes from './server/routes/host.ts';
import studentRoutes from './server/routes/student.ts';
import adminRoutes from './server/routes/admin.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  try {
    await ensureDatabaseSchema();
  } catch (err) {
    console.error('[server] initial schema check failed (will retry on request):', err);
  }

  const app = express();
  app.set('trust proxy', 1);

  // Strict CORS (never wildcard on authenticated routes)
  const allowedOrigins = (process.env.APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.APP_URL) allowedOrigins.push(process.env.APP_URL.trim());

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.endsWith('.run.app')) {
          return callback(null, true);
        }
        return callback(new Error('Origin not allowed by CORS policy'));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(attachRequestId);

  // Security headers compatible with AI Studio iframe hosting
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
      await db.execute(sql`SELECT 1`);
      res.json({ status: 'ready', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
      console.error('[health] readiness check failed:', err);
      res.status(503).json({ status: 'degraded', database: 'unavailable' });
    }
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

  // Mount Vite middleware in development or serve built dist/ in production
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ThinkPulse server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ThinkPulse server:', err);
  process.exit(1);
});
