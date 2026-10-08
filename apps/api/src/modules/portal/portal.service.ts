import {
  type ActiveSessionsResponse,
  type HistoryItem,
  type Page,
  type ParkingSessionView,
  type PortalHistoryQuery,
  type PortalLayoutResponse,
  type PortalOverview,
  type ReceiptView,
  type SessionTimelineResponse,
} from '@cpvts/shared';

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { HISTORY_INCLUDE, toHistoryItem } from '../management/history.service.js';
import { optionalDateFilter } from '../management/date-range.js';
import { parkingErrors } from '../parking/parking.errors.js';
import { toReceiptView, toSessionView } from '../parking/parking.mappers.js';
import { parkingRepository, SESSION_INCLUDE } from '../parking/parking.repository.js';
import { timelineService } from '../parking/timeline.service.js';
import { liveContext, trackingService } from '../parking/tracking.service.js';
import { publicService } from '../public/public.service.js';
import { findOwnSession, ownedSessionWhere } from './portal-access.js';
import { toUserLayout } from './portal-layout.js';
import { listVehiclesOf } from './vehicle.service.js';

const RECENT_ACTIVITY = 5;

interface PageRequest {
  page: number;
  pageSize: number;
}

/** Reads for a Student / Campus Staff member. Every query is limited to their own sessions. */
export const portalService = {
  async overview(userId: string): Promise<PortalOverview> {
    const scope = ownedSessionWhere(userId);
    const [availability, active, recent, vehicles, live] = await Promise.all([
      publicService.getAvailability(),
      prisma.parkingSession.findMany({
        where: { ...scope, status: 'ACTIVE' },
        include: SESSION_INCLUDE,
        orderBy: [{ entryAt: 'asc' }, { sessionNumber: 'asc' }],
      }),
      prisma.parkingSession.findMany({
        where: scope,
        include: HISTORY_INCLUDE,
        orderBy: [{ entryAt: 'desc' }, { sessionNumber: 'asc' }],
        take: RECENT_ACTIVITY,
      }),
      listVehiclesOf(userId),
      liveContext(),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      availability,
      activeSessions: active.map((session) => toSessionView(session, live)),
      recentActivity: recent.map(toHistoryItem),
      vehicleCount: vehicles.length,
    };
  },

  async layout(userId: string): Promise<PortalLayoutResponse> {
    const [map, active] = await Promise.all([
      trackingService.getMap(),
      prisma.parkingSession.findMany({
        where: { ...ownedSessionWhere(userId), status: 'ACTIVE' },
        select: { slot: { select: { code: true } } },
      }),
    ]);
    return toUserLayout(
      map,
      active.map((session) => session.slot.code),
    );
  },

  async activeSessions(userId: string): Promise<ActiveSessionsResponse> {
    const [sessions, live] = await Promise.all([
      prisma.parkingSession.findMany({
        where: { ...ownedSessionWhere(userId), status: 'ACTIVE' },
        include: SESSION_INCLUDE,
        orderBy: [{ entryAt: 'asc' }, { sessionNumber: 'asc' }],
      }),
      liveContext(),
    ]);
    return {
      currentHour: live.currentHour,
      sessions: sessions.map((session) => toSessionView(session, live)),
    };
  },

  async session(userId: string, sessionNumber: string): Promise<ParkingSessionView> {
    const session = await findOwnSession(userId, sessionNumber);
    return toSessionView(session, await liveContext());
  },

  async timeline(userId: string, sessionNumber: string): Promise<SessionTimelineResponse> {
    await findOwnSession(userId, sessionNumber);
    return timelineService.forSession(sessionNumber, { isOwner: true });
  },

  async history(
    userId: string,
    query: PortalHistoryQuery & PageRequest,
  ): Promise<Page<HistoryItem>> {
    const filters: Prisma.ParkingSessionWhereInput = {
      ...(query.vehicleNumber
        ? { vehicle: { vehicleNumber: { contains: String(query.vehicleNumber) } } }
        : {}),
      ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
    };
    const entryAt = optionalDateFilter({
      from: query.from as string | undefined,
      to: query.to as string | undefined,
    });
    return listSessions(
      userId,
      { ...filters, ...(entryAt ? { entryAt } : {}) },
      query.page,
      query.pageSize,
    );
  },

  /** Finished sessions with their receipts, newest first. */
  async receipts(userId: string, { page, pageSize }: PageRequest): Promise<Page<HistoryItem>> {
    return listSessions(userId, { status: 'COMPLETED', receipt: { isNot: null } }, page, pageSize);
  },

  async receipt(userId: string, receiptNumber: string): Promise<ReceiptView> {
    const receipt = await parkingRepository.findReceiptByNumber(receiptNumber);
    if (!receipt) throw parkingErrors.receiptNotFound();
    const owned = await prisma.parkingSession.count({
      where: { id: receipt.sessionId, ...ownedSessionWhere(userId) },
    });
    // Someone else's receipt looks exactly like one that does not exist.
    if (owned === 0) throw parkingErrors.receiptNotFound();
    return toReceiptView(receipt);
  },
};

const listSessions = async (
  userId: string,
  filters: Prisma.ParkingSessionWhereInput,
  page: number,
  pageSize: number,
): Promise<Page<HistoryItem>> => {
  const where: Prisma.ParkingSessionWhereInput = {
    AND: [ownedSessionWhere(userId), filters],
  };
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
};
