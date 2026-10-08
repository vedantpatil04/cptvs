import type {
  AuditAction,
  HistoryItem,
  Page,
  ParkingSessionView,
  ParkingUserProfileView,
  PendingCheckout,
  PortalHistoryQuery,
  PortalLayoutResponse,
  PortalOverview,
  ProfileUpdate,
  ReceiptView,
  SessionTimelineResponse,
  TimelineEvent,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import { withTransaction } from '../../db/transaction.js';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { auditRepository } from '../audit/audit.repository.js';
import { accountErrors } from '../accounts/accounts.errors.js';
import { HISTORY_INCLUDE, historyWhere, toHistoryItem } from '../management/history.service.js';
import { feeScheduleService } from '../fees/fee-schedule.service.js';
import { liveContext } from '../parking/live-context.js';
import type { OperationContext } from '../parking/operation-context.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toReceiptView, toSessionView } from '../parking/parking.mappers.js';
import { RECEIPT_INCLUDE, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { timelineService } from '../parking/timeline.service.js';
import { trackingService } from '../parking/tracking.service.js';
import { publicService } from '../public/public.service.js';
import { ownedSessionWhere, portalRepository } from './portal.repository.js';
import { vehicleService } from './vehicle.service.js';

const RECENT_ACTIVITY_COUNT = 5;
/** A completed parking stays the "latest" result on the home page for this long. */
const LAST_COMPLETED_HOURS = 12;

/**
 * What a user may see of a session's audit trail: the parking steps only. No
 * operator names, allocation scores, refusals or other internal detail.
 */
const USER_TIMELINE_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>([
  'VEHICLE_CHECKED_IN',
  'SLOT_ASSIGNED',
  'CHECKOUT_INITIATED',
  'PAYMENT_INITIATED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'PAYMENT_CANCELLED',
  'TRANSACTION_FINALIZED',
  'RECEIPT_GENERATED',
  'SLOT_RELEASED',
]);

const toUserTimelineEvent = (event: TimelineEvent): TimelineEvent => {
  const { score: _score, reason: _reason, ...details } = event.details;
  void _score;
  void _reason;
  return { at: event.at, action: event.action, actor: null, details };
};

/**
 * Live layout for a signed-in viewer. Other people's vehicles are never
 * revealed: only the viewer's own slots (`ownSlots`) keep their occupant, and
 * administrative block reasons are dropped.
 */
export const buildPortalLayout = async (ownSlots: string[]): Promise<PortalLayoutResponse> => {
  const map = await trackingService.getMap();
  const own = new Set(ownSlots);
  return {
    ...map,
    blocks: map.blocks.map((block) => ({
      ...block,
      zones: block.zones.map((zone) => ({
        ...zone,
        slots: zone.slots.map((slot) => ({
          ...slot,
          blockedReason: null,
          occupant: own.has(slot.code) ? slot.occupant : null,
        })),
      })),
    })),
    mySlots: [...own],
  };
};

export const portalService = {
  async getProfile(userId: string): Promise<ParkingUserProfileView> {
    const user = await portalRepository.findProfile(userId);
    const profile = user?.parkingProfile;
    if (!user || !profile) throw accountErrors.userNotFound();
    const schedule = await feeScheduleService.find();
    const rules = schedule?.rules[profile.category];
    return {
      id: user.id,
      fullName: user.fullName,
      email: profile.email,
      phone: profile.phone,
      category: profile.category,
      institutionalId: profile.institutionalId,
      verification: {
        status: profile.verificationStatus,
        note: profile.verificationStatus === 'REJECTED' ? profile.verificationNote : null,
        submittedAt: profile.verificationSubmittedAt.toISOString(),
        reviewedAt: profile.reviewedAt?.toISOString() ?? null,
      },
      preferredLocale: profile.preferredLocale,
      vehicleCount: user._count.vehicles,
      memberSince: user.createdAt.toISOString(),
      pricing: rules ?? null,
    };
  },

  /** Name, phone and language only; category, ID, e-mail and verification are server-controlled. */
  async updateProfile(
    input: ProfileUpdate,
    context: OperationContext,
  ): Promise<ParkingUserProfileView> {
    const userId = context.actor.id;
    const changes = input as { fullName?: string; phone?: string; preferredLocale?: string | null };
    await withTransaction(async (tx) => {
      if (changes.fullName !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { fullName: changes.fullName } });
      }
      if (changes.phone !== undefined || changes.preferredLocale !== undefined) {
        await tx.parkingUserProfile.update({
          where: { userId },
          data: {
            ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
            ...(changes.preferredLocale !== undefined
              ? { preferredLocale: changes.preferredLocale }
              : {}),
          },
        });
      }
      await auditRepository.record(
        {
          action: AUDIT_ACTIONS.profileUpdated,
          actorId: userId,
          entityType: AUDIT_ENTITY_TYPES.user,
          entityId: userId,
          metadata: { fields: Object.keys(changes) },
          request: context.request,
        },
        tx,
      );
    });
    return this.getProfile(userId);
  },

  async listActiveSessions(userId: string): Promise<ParkingSessionView[]> {
    const where = await ownedSessionWhere(userId);
    const [sessions, context] = await Promise.all([
      prisma.parkingSession.findMany({
        where: { AND: [where, { status: 'ACTIVE' }] },
        include: SESSION_INCLUDE,
        orderBy: { entryAt: 'asc' },
      }),
      liveContext(),
    ]);
    return sessions.map((session) => toSessionView(session, context));
  },

  async getSession(userId: string, sessionNumber: string): Promise<ParkingSessionView> {
    const where = await ownedSessionWhere(userId);
    const session = await prisma.parkingSession.findFirst({
      where: { AND: [where, { sessionNumber }] },
      include: SESSION_INCLUDE,
    });
    // Another user's session is indistinguishable from a missing one.
    if (!session) throw parkingErrors.sessionNotFound();
    return toSessionView(session, await liveContext());
  },

  async getOverview(userId: string): Promise<PortalOverview> {
    const [availability, activeSessions, recent, vehicles, pendingCheckouts, lastCompleted] =
      await Promise.all([
        publicService.getAvailability(),
        this.listActiveSessions(userId),
        this.listHistory(userId, { page: 1, pageSize: RECENT_ACTIVITY_COUNT }),
        vehicleService.list(userId),
        this.listPendingCheckouts(userId),
        this.findLastCompleted(userId),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      availability,
      activeSessions,
      recentActivity: recent.items,
      vehicleCount: vehicles.length,
      vehicles,
      pendingCheckouts,
      lastCompleted,
    };
  },

  /** Active sessions whose checkout was started (a payment is waiting) but not completed. */
  async listPendingCheckouts(userId: string): Promise<PendingCheckout[]> {
    const owned = await ownedSessionWhere(userId);
    const payments = await prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING'] },
        session: { AND: [owned, { status: 'ACTIVE' }] },
      },
      include: { session: { select: { sessionNumber: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map((payment) => ({
      sessionNumber: payment.session.sessionNumber,
      paymentId: payment.id,
      amountPaise: payment.amountPaise,
      exitHour: payment.exitHour,
    }));
  },

  /** The user's latest completed parking, while it is still recent. */
  async findLastCompleted(userId: string): Promise<HistoryItem | null> {
    const since = new Date(Date.now() - LAST_COMPLETED_HOURS * 3_600_000);
    const session = await prisma.parkingSession.findFirst({
      where: {
        AND: [await ownedSessionWhere(userId), { status: 'COMPLETED', exitAt: { gte: since } }],
      },
      include: HISTORY_INCLUDE,
      orderBy: { exitAt: 'desc' },
    });
    return session ? toHistoryItem(session) : null;
  },

  /** The parking steps of one of the user's own sessions (no operators, scores or refusals). */
  async getTimeline(userId: string, sessionNumber: string): Promise<SessionTimelineResponse> {
    await this.getSession(userId, sessionNumber);
    const timeline = await timelineService.forSession(sessionNumber);
    return {
      sessionNumber,
      events: timeline.events
        .filter((event) => USER_TIMELINE_ACTIONS.has(event.action))
        .map(toUserTimelineEvent),
    };
  },

  async listHistory(userId: string, query: PortalHistoryQuery): Promise<Page<HistoryItem>> {
    const {
      page = 1,
      pageSize = 25,
      ...filters
    } = query as {
      page?: number;
      pageSize?: number;
      vehicleNumber?: string;
      vehicleType?: HistoryItem['vehicleType'];
      from?: string;
      to?: string;
    };
    const where = { AND: [await ownedSessionWhere(userId), historyWhere(filters)] };
    const [total, sessions] = await Promise.all([
      prisma.parkingSession.count({ where }),
      prisma.parkingSession.findMany({
        where,
        include: HISTORY_INCLUDE,
        orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: sessions.map(toHistoryItem), page, pageSize, total };
  },

  async listReceipts(userId: string, page: number, pageSize: number): Promise<Page<ReceiptView>> {
    const where = { session: await ownedSessionWhere(userId) };
    const [total, receipts] = await Promise.all([
      prisma.receipt.count({ where }),
      prisma.receipt.findMany({
        where,
        include: RECEIPT_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }, { receiptNumber: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: receipts.map(toReceiptView), page, pageSize, total };
  },

  async getReceipt(userId: string, receiptNumber: string): Promise<ReceiptView> {
    const receipt = await prisma.receipt.findFirst({
      where: { receiptNumber, session: await ownedSessionWhere(userId) },
      include: RECEIPT_INCLUDE,
    });
    if (!receipt) throw parkingErrors.receiptNotFound();
    return toReceiptView(receipt);
  },

  async getLayout(userId: string): Promise<PortalLayoutResponse> {
    const sessions = await this.listActiveSessions(userId);
    return buildPortalLayout(sessions.map((session) => session.slotCode));
  },
};
