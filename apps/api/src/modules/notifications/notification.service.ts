import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationParams,
  type NotificationsResponse,
  type NotificationView,
  type SendNoticeRequest,
  type SendNoticeResponse,
} from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import type { OperationContext } from '../parking/operation-context.js';
import { notificationErrors } from './notification.errors.js';

/** Notifications older than this are not listed (they stay in the table for the audit trail). */
const LISTING_WINDOW_DAYS = 60;

const isKind = (value: string): value is NotificationKind =>
  (NOTIFICATION_KINDS as readonly string[]).includes(value);

const toView = (row: {
  id: string;
  kind: string;
  params: Prisma.JsonValue;
  createdAt: Date;
  readAt: Date | null;
}): NotificationView => ({
  id: row.id,
  kind: isKind(row.kind) ? row.kind : 'PARKING_NOTICE',
  params: (row.params ?? {}) as NotificationParams,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

const listingSince = (): Date => new Date(Date.now() - LISTING_WINDOW_DAYS * 86_400_000);

/**
 * Lightweight in-app notifications for Student / Campus Staff accounts. The
 * server stores a `kind` and its parameters; the client renders the message in
 * the user's language. Notifications are best-effort conveniences: callers
 * pass their transaction so a notification is created only if the event it
 * announces is committed.
 */
export const notificationService = {
  async notify(
    userId: string,
    kind: NotificationKind,
    params: NotificationParams,
    db: DbClient = prisma,
  ): Promise<void> {
    await db.notification.create({
      data: { userId, kind, params: params as Prisma.InputJsonObject },
    });
  },

  async list(
    userId: string,
    { unreadOnly, limit }: { unreadOnly: boolean; limit: number },
  ): Promise<NotificationsResponse> {
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          createdAt: { gte: listingSince() },
          ...(unreadOnly ? { readAt: null } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: rows.map(toView), unreadCount };
  },

  /** Only the owner can mark a notification read; anyone else gets "not found". */
  async markRead(userId: string, id: string): Promise<NotificationView> {
    const row = await prisma.notification.findFirst({ where: { id, userId } });
    if (!row) throw notificationErrors.notFound();
    if (row.readAt) return toView(row);
    const updated = await prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return toView(updated);
  },

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  },

  /** Administrator notice to one user or to all verified, active Students / Campus Staff. */
  async sendNotice(
    request: SendNoticeRequest,
    context: OperationContext,
  ): Promise<SendNoticeResponse> {
    const profileFilter: Prisma.ParkingUserProfileWhereInput = {
      verificationStatus: 'VERIFIED',
      ...(request.audience === 'STUDENTS' ? { category: 'STUDENT' } : {}),
      ...(request.audience === 'STAFF' ? { category: 'STAFF' } : {}),
    };
    const recipients = await prisma.user.findMany({
      where: {
        role: 'PARKING_USER',
        isActive: true,
        ...(request.audience === 'USER'
          ? { id: request.userId }
          : { parkingProfile: { is: profileFilter } }),
      },
      select: { id: true },
    });

    const params: NotificationParams = { title: request.title, message: request.message };
    await withTransaction(async (tx) => {
      if (recipients.length > 0) {
        await tx.notification.createMany({
          data: recipients.map((recipient) => ({
            userId: recipient.id,
            kind: 'PARKING_NOTICE',
            params: params as Prisma.InputJsonObject,
          })),
        });
      }
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.noticeSent,
          actorId: context.actor.id,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: request.audience === 'USER' ? request.userId : request.audience,
          metadata: { audience: request.audience, delivered: recipients.length },
          request: context.request,
        },
        tx,
      );
    });
    return { delivered: recipients.length };
  },
};
