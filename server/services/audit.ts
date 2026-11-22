import { db } from '../../src/db/index.ts';
import { auditLogs } from '../../src/db/schema.ts';
import { sanitizeAuditMetadata } from '../utils/crypto.ts';

export async function recordAuditLog(params: {
  actorId: string | null;
  actorEmail: string | null;
  institutionId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  changedFields?: string[];
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      institutionId: params.institutionId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      changedFields: params.changedFields ?? [],
      metadata: sanitizeAuditMetadata(params.metadata ?? {}),
    });
  } catch (err) {
    console.error('[audit] Failed to persist audit log:', err);
  }
}
