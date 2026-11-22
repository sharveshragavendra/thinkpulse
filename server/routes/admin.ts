import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import { serverRegistry } from '../../src/db/schema.ts';
import { serverRecordInputSchema } from '../../shared/schemas.ts';
import { requireAuth, requireServerAdmin, type AuthRequest } from '../middleware/auth.ts';
import { runControlledHealthCheck, validateServerTarget } from '../utils/ssrf.ts';
import { recordAuditLog } from '../services/audit.ts';
import type { ServerEnvironment, ServerHealthStatus, ServerRecordDTO } from '../../shared/types.ts';

const router = Router();

function serializeServer(s: typeof serverRegistry.$inferSelect): ServerRecordDTO {
  return {
    id: s.id,
    displayName: s.displayName,
    host: s.host,
    port: s.port,
    protocol: s.protocol as 'https' | 'http',
    apiBaseUrl: s.apiBaseUrl,
    environment: s.environment as ServerEnvironment,
    isActive: s.isActive,
    isEnabled: s.isEnabled,
    healthStatus: s.healthStatus as ServerHealthStatus,
    latencyMs: s.latencyMs,
    lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
    hasRollback: Boolean(s.previousConfig),
    previousConfig: s.previousConfig ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

router.use('/admin/servers', requireAuth, requireServerAdmin);

router.get('/admin/servers', async (req: AuthRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(serverRegistry)
      .where(eq(serverRegistry.institutionId, req.currentUser!.institutionId))
      .orderBy(desc(serverRegistry.isActive), desc(serverRegistry.createdAt));

    return res.json({ servers: rows.map(serializeServer) });
  } catch (err) {
    console.error('[admin] list servers error:', err);
    return res.status(500).json({ error: 'Failed to load server registry.' });
  }
});

router.post('/admin/servers', async (req: AuthRequest, res) => {
  const parsed = serverRecordInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid server configuration.',
    });
  }

  try {
    const check = await validateServerTarget(parsed.data);
    if (!check.valid || !check.normalizedUrl) {
      return res.status(400).json({
        error: check.reason || 'Target endpoint rejected by security policy.',
        code: 'DISALLOWED_TARGET',
      });
    }

    const [created] = await db
      .insert(serverRegistry)
      .values({
        institutionId: req.currentUser!.institutionId,
        displayName: parsed.data.displayName,
        host: parsed.data.host.trim().toLowerCase(),
        port: parsed.data.port,
        protocol: parsed.data.protocol,
        apiBaseUrl: check.normalizedUrl,
        environment: parsed.data.environment,
        isEnabled: parsed.data.isEnabled,
        isActive: false,
        healthStatus: 'unknown',
        createdBy: req.currentUser!.id,
        updatedBy: req.currentUser!.id,
      })
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: 'server.registered',
      targetType: 'server',
      targetId: created.id,
      changedFields: ['displayName', 'host', 'port', 'apiBaseUrl', 'environment'],
      metadata: {
        displayName: created.displayName,
        apiBaseUrl: created.apiBaseUrl,
        environment: created.environment,
      },
    });

    return res.status(201).json({ server: serializeServer(created) });
  } catch (err) {
    console.error('[admin] create server error:', err);
    return res.status(500).json({ error: 'Unable to register server endpoint.' });
  }
});

router.patch('/admin/servers/:id', async (req: AuthRequest, res) => {
  const parsed = serverRecordInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid server update.',
    });
  }

  try {
    const [existing] = await db
      .select()
      .from(serverRegistry)
      .where(
        and(
          eq(serverRegistry.id, req.params.id),
          eq(serverRegistry.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: 'Server record not found.' });

    const check = await validateServerTarget(parsed.data);
    if (!check.valid || !check.normalizedUrl) {
      return res.status(400).json({
        error: check.reason || 'Target endpoint rejected by security policy.',
        code: 'DISALLOWED_TARGET',
      });
    }

    const previousConfig = {
      displayName: existing.displayName,
      host: existing.host,
      port: existing.port,
      protocol: existing.protocol,
      apiBaseUrl: existing.apiBaseUrl,
      environment: existing.environment,
      savedAt: new Date().toISOString(),
    };

    const [updated] = await db
      .update(serverRegistry)
      .set({
        displayName: parsed.data.displayName,
        host: parsed.data.host.trim().toLowerCase(),
        port: parsed.data.port,
        protocol: parsed.data.protocol,
        apiBaseUrl: check.normalizedUrl,
        environment: parsed.data.environment,
        isEnabled: parsed.data.isEnabled,
        previousConfig,
        healthStatus: 'unknown',
        latencyMs: null,
        updatedBy: req.currentUser!.id,
        updatedAt: new Date(),
      })
      .where(eq(serverRegistry.id, existing.id))
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: 'server.updated',
      targetType: 'server',
      targetId: updated.id,
      changedFields: ['displayName', 'host', 'port', 'apiBaseUrl', 'environment', 'isEnabled'],
      metadata: { before: previousConfig, after: { apiBaseUrl: updated.apiBaseUrl, environment: updated.environment } },
    });

    return res.json({ server: serializeServer(updated) });
  } catch (err) {
    console.error('[admin] update server error:', err);
    return res.status(500).json({ error: 'Unable to update server configuration.' });
  }
});

router.post('/admin/servers/:id/test', async (req: AuthRequest, res) => {
  try {
    const [existing] = await db
      .select()
      .from(serverRegistry)
      .where(
        and(
          eq(serverRegistry.id, req.params.id),
          eq(serverRegistry.institutionId, req.currentUser!.institutionId)
        )
      )
      .limit(1);

    if (!existing) return res.status(404).json({ error: 'Server record not found.' });

    const probe = await runControlledHealthCheck({
      host: existing.host,
      port: existing.port,
      protocol: existing.protocol as 'https' | 'http',
      apiBaseUrl: existing.apiBaseUrl,
      environment: existing.environment as ServerEnvironment,
    });

    const [updated] = await db
      .update(serverRegistry)
      .set({
        healthStatus: probe.healthStatus,
        latencyMs: probe.latencyMs,
        lastCheckedAt: new Date(probe.checkedAt),
        updatedAt: new Date(),
      })
      .where(eq(serverRegistry.id, existing.id))
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: req.currentUser!.institutionId,
      action: 'server.health_tested',
      targetType: 'server',
      targetId: updated.id,
      metadata: {
        healthStatus: probe.healthStatus,
        latencyMs: probe.latencyMs,
        detail: probe.detail,
      },
    });

    return res.json({
      server: serializeServer(updated),
      probe,
    });
  } catch (err) {
    console.error('[admin] test server error:', err);
    return res.status(500).json({ error: 'Health check failed to execute.' });
  }
});

router.post('/admin/servers/:id/activate', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const [target] = await db
      .select()
      .from(serverRegistry)
      .where(and(eq(serverRegistry.id, req.params.id), eq(serverRegistry.institutionId, instId)))
      .limit(1);

    if (!target) return res.status(404).json({ error: 'Server record not found.' });
    if (!target.isEnabled) {
      return res.status(400).json({ error: 'Cannot activate a disabled server endpoint.' });
    }

    const [previousActive] = await db
      .select()
      .from(serverRegistry)
      .where(and(eq(serverRegistry.institutionId, instId), eq(serverRegistry.isActive, true)))
      .limit(1);

    const updated = await db.transaction(async (tx) => {
      await tx
        .update(serverRegistry)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(serverRegistry.institutionId, instId));

      const [nextActive] = await tx
        .update(serverRegistry)
        .set({
          isActive: true,
          updatedBy: req.currentUser!.id,
          updatedAt: new Date(),
        })
        .where(eq(serverRegistry.id, target.id))
        .returning();
      return nextActive;
    });

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'server.activated',
      targetType: 'server',
      targetId: updated.id,
      changedFields: ['isActive'],
      metadata: {
        activatedName: updated.displayName,
        activatedUrl: updated.apiBaseUrl,
        previousActiveId: previousActive?.id ?? null,
        previousActiveName: previousActive?.displayName ?? null,
      },
    });

    return res.json({ server: serializeServer(updated) });
  } catch (err) {
    console.error('[admin] activate server error:', err);
    return res.status(500).json({ error: 'Unable to activate server endpoint.' });
  }
});

router.post('/admin/servers/:id/rollback', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const [target] = await db
      .select()
      .from(serverRegistry)
      .where(and(eq(serverRegistry.id, req.params.id), eq(serverRegistry.institutionId, instId)))
      .limit(1);

    if (!target) return res.status(404).json({ error: 'Server record not found.' });
    if (!target.previousConfig) {
      return res.status(400).json({ error: 'No previous approved configuration is available to roll back.' });
    }

    const prev = target.previousConfig;
    const [rolledBack] = await db
      .update(serverRegistry)
      .set({
        displayName: prev.displayName,
        host: prev.host,
        port: prev.port,
        protocol: prev.protocol,
        apiBaseUrl: prev.apiBaseUrl,
        environment: prev.environment,
        previousConfig: null,
        healthStatus: 'unknown',
        latencyMs: null,
        updatedBy: req.currentUser!.id,
        updatedAt: new Date(),
      })
      .where(eq(serverRegistry.id, target.id))
      .returning();

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'server.rolled_back',
      targetType: 'server',
      targetId: rolledBack.id,
      changedFields: ['displayName', 'host', 'port', 'apiBaseUrl', 'environment'],
      metadata: { restoredUrl: rolledBack.apiBaseUrl },
    });

    return res.json({ server: serializeServer(rolledBack) });
  } catch (err) {
    console.error('[admin] rollback server error:', err);
    return res.status(500).json({ error: 'Failed to roll back server configuration.' });
  }
});

router.delete('/admin/servers/:id', async (req: AuthRequest, res) => {
  try {
    const instId = req.currentUser!.institutionId;
    const [target] = await db
      .select()
      .from(serverRegistry)
      .where(and(eq(serverRegistry.id, req.params.id), eq(serverRegistry.institutionId, instId)))
      .limit(1);

    if (!target) return res.status(404).json({ error: 'Server record not found.' });
    if (target.isActive) {
      return res.status(409).json({
        error: 'Cannot remove the currently active server endpoint. Activate another server first.',
      });
    }

    await db.delete(serverRegistry).where(eq(serverRegistry.id, target.id));

    await recordAuditLog({
      actorId: req.currentUser!.id,
      actorEmail: req.currentUser!.email,
      institutionId: instId,
      action: 'server.removed',
      targetType: 'server',
      targetId: target.id,
      metadata: { displayName: target.displayName, apiBaseUrl: target.apiBaseUrl },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[admin] delete server error:', err);
    return res.status(500).json({ error: 'Failed to remove server record.' });
  }
});

export default router;
