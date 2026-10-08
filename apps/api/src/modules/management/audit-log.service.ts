import type { AuditLogEntry, Page } from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { optionalDateFilter } from './date-range.js';

export interface AuditLogFilters {
  action?: string;
  entityType?: string;
  entityId?: string;
  actor?: string;
  from?: string;
  to?: string;
}

/** Read-only audit log browsing for administrators, newest first. */
export const auditLogService = {
  async list(
    filters: AuditLogFilters,
    page: number,
    pageSize: number,
  ): Promise<Page<AuditLogEntry>> {
    const createdAt = optionalDateFilter(filters);
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId
        ? { entityId: { contains: filters.entityId, mode: 'insensitive' } }
        : {}),
      ...(filters.actor ? { actor: { username: filters.actor } } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { username: true, fullName: true, role: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      page,
      pageSize,
      total,
      items: entries.map((entry) => ({
        id: entry.id,
        at: entry.createdAt.toISOString(),
        action: entry.action,
        actor: entry.actor,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
        ipAddress: entry.ipAddress,
      })),
    };
  },
};
