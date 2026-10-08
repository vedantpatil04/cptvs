import {
  isValidVehicleNumber,
  normalizeVehicleNumber,
  OPAQUE_REFERENCE_PATTERN,
  parseEntryQrPayload,
  SESSION_NUMBER_PATTERN,
  SLOT_CODE_PATTERN,
  ENTRY_QR_PREFIX,
  type ActiveSessionsResponse,
  type ParkingMapResponse,
  type ParkingSessionView,
  type SlotCounts,
  type TrackingResponse,
} from '@cpvts/shared';

import { campusHour } from '../../lib/campus-time.js';
import { AUDIT_ENTITY_TYPES } from '../audit/audit-actions.js';
import { liveContext } from './live-context.js';
import { auditRejection, type OperationContext } from './operation-context.js';
import { parkingErrors } from './parking.errors.js';
import { currentDuration, toBlockSummary, toSessionView } from './parking.mappers.js';
import { parkingRepository, type SessionWithRelations } from './parking.repository.js';
import { slotHoldRepository } from './slot-hold.repository.js';

const found = async (
  matchedBy: TrackingResponse['matchedBy'],
  session: SessionWithRelations,
): Promise<TrackingResponse> => ({
  matchedBy,
  session: toSessionView(session, await liveContext()),
});

/**
 * Vehicle Tracking Center (Master Blueprint §12–§13). Authenticated users only:
 * these views contain vehicle numbers and exact slots.
 */
export const trackingService = {
  /**
   * Finds a session by entry QR text, session number, slot ID or vehicle
   * number. Vehicle and slot searches return only the ACTIVE session.
   */
  async search(query: string, context: OperationContext): Promise<TrackingResponse> {
    const text = query.trim();

    // Entry/session QR: only the opaque reference is trusted, and only after lookup.
    const looksLikeQr = text.toLowerCase().startsWith(ENTRY_QR_PREFIX);
    const reference = looksLikeQr
      ? parseEntryQrPayload(text)
      : OPAQUE_REFERENCE_PATTERN.test(text)
        ? text
        : null;
    if (looksLikeQr || reference) {
      const session = reference
        ? await parkingRepository.findSessionByEntryReference(reference)
        : null;
      if (!session) {
        throw await auditRejection(parkingErrors.invalidQrReference(), context, {
          metadata: { source: 'ENTRY_QR' },
        });
      }
      if (session.status !== 'ACTIVE') {
        throw await auditRejection(parkingErrors.sessionNotActive(), context, {
          entityType: AUDIT_ENTITY_TYPES.parkingSession,
          entityId: session.sessionNumber,
          metadata: { source: 'ENTRY_QR' },
        });
      }
      return found('ENTRY_QR', session);
    }

    const upper = text.toUpperCase();
    if (SESSION_NUMBER_PATTERN.test(upper)) {
      const session = await parkingRepository.findSessionByNumber(upper);
      if (!session) throw parkingErrors.sessionNotFound();
      return found('SESSION_NUMBER', session);
    }

    if (SLOT_CODE_PATTERN.test(upper)) {
      const slot = await parkingRepository.findSlotByCode(upper);
      if (slot) {
        const session = await parkingRepository.findActiveSessionBySlotId(slot.id);
        if (!session) throw parkingErrors.sessionNotFound('No vehicle is parked in this slot.');
        return found('SLOT', session);
      }
    }

    const vehicleNumber = normalizeVehicleNumber(text);
    if (isValidVehicleNumber(vehicleNumber)) {
      const session = await parkingRepository.findActiveSessionByVehicleNumber(vehicleNumber);
      if (!session) throw parkingErrors.sessionNotFound('This vehicle is not currently parked.');
      return found('VEHICLE_NUMBER', session);
    }

    throw parkingErrors.sessionNotFound();
  },

  async getSession(sessionNumber: string): Promise<ParkingSessionView> {
    const session = await parkingRepository.findSessionByNumber(sessionNumber);
    if (!session) throw parkingErrors.sessionNotFound();
    return toSessionView(session, await liveContext());
  },

  async listActive(): Promise<ActiveSessionsResponse> {
    const [sessions, context] = await Promise.all([
      parkingRepository.listActiveSessions(),
      liveContext(),
    ]);
    return {
      currentHour: context.currentHour,
      sessions: sessions.map((session) => toSessionView(session, context)),
    };
  },

  /** Logical parking map: configured blocks, zones and slots with live state. */
  async getMap(): Promise<ParkingMapResponse> {
    await slotHoldRepository.releaseExpired();
    const blocks = await parkingRepository.findMapLayout();
    const currentHour = campusHour();

    return {
      generatedAt: new Date().toISOString(),
      currentHour,
      blocks: blocks.map((block) => ({
        ...toBlockSummary(block),
        description: block.description,
        zones: block.zones.map((zone) => {
          const counts: SlotCounts = { total: 0, available: 0, occupied: 0, blocked: 0, held: 0 };
          const slots = zone.slots.map((slot) => {
            counts.total += 1;
            if (slot.status === 'AVAILABLE') counts.available += 1;
            else if (slot.status === 'OCCUPIED') counts.occupied += 1;
            else if (slot.status === 'BLOCKED') counts.blocked += 1;
            else counts.held += 1;

            const session = slot.sessions[0];
            return {
              code: slot.code,
              status: slot.status,
              blockedReason: slot.status === 'BLOCKED' ? slot.blockedReason : null,
              occupant: session
                ? {
                    sessionNumber: session.sessionNumber,
                    vehicleNumber: session.vehicle.vehicleNumber,
                    vehicleType: session.vehicleType,
                    ownerCategory: session.ownerCategory,
                    entryHour: session.entryHour,
                    currentDurationHours: currentDuration(session.entryHour, currentHour),
                  }
                : null,
            };
          });
          return { code: zone.code, name: zone.name, vehicleType: zone.vehicleType, counts, slots };
        }),
      })),
    };
  },
};
