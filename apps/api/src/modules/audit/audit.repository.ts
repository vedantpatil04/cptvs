import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { RequestMeta } from '../auth/auth.types.js';
import type { AuditAction, AuditEntityType } from './audit-actions.js';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: AuditEntityType;
  entityId?: string;
  metadata?: Prisma.InputJsonObject;
  request?: RequestMeta;
}

const USER_AGENT_MAX = 512;

export const auditRepository = {
  async record(entry: AuditEntry, db: DbClient = prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
        ipAddress: entry.request?.ipAddress ?? null,
        userAgent: entry.request?.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      },
    });
  },
};
