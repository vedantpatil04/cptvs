import type {
  NotificationData,
  NotificationsResponse,
  NotificationType,
  NotificationView,
} from '@cpvts/shared';

import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';

const LIST_LIMIT = 20;

const notificationNotFound = () =>
  new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.');

const toView = (row: {
  id: string;
  type: string;
  data: Prisma.JsonValue;
  createdAt: Date;
  readAt: Date | null;
}): NotificationView => ({
  id: row.id,
  type: row.type as NotificationType,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
  data: (row.data ?? {}) as NotificationData,
});

/**
 * Lightweight in-app notices for parking users (verification decisions,
 * receipts, a vehicle checked in by security). The client translates a notice
 * by its `type`; only the values the message needs are stored.
 */
export const notificationService = {
  /** Creates a notice. Pass the caller's transaction so it commits with the event it describes. */
  async notify(
    db: DbClient,
    userId: string,
    type: NotificationType,
    data: NotificationData = {},
  ): Promise<void> {
    await db.notification.create({ data: { userId, type, data: data as Prisma.InputJsonObject } });
  },

  async list(userId: string): Promise<NotificationsResponse> {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: LIST_LIMIT,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items: items.map(toView), unreadCount };
  },

  /** A user can only mark their own notices; anything else looks like it does not exist. */
  async markRead(userId: string, id: string): Promise<void> {
    const found = await prisma.notification.count({ where: { id, userId } });
    if (!found) throw notificationNotFound();
    await prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  },

  async markAllRead(userId: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  },
};
