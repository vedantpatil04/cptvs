import { config } from '../../config/index.js';
import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { VehicleType } from '../../generated/prisma/client.js';
import { newHoldToken } from '../../lib/identifiers.js';
import type { SlotHoldStore } from './allocation.js';

const RELEASED = {
  status: 'AVAILABLE',
  holdToken: null,
  holdUserId: null,
  holdExpiresAt: null,
} as const;

/**
 * Temporary slot holds implemented as atomic compare-and-set updates, so two
 * terminals can never hold or occupy the same slot. Holds expire after
 * `SLOT_HOLD_SECONDS`; expired holds are reclaimed before allocation and reads.
 */
export const slotHoldRepository = {
  /**
   * AVAILABLE → HELD for an in-service slot. Returns the hold token, or null if
   * the slot was not available. Operator allocation uses the short default hold;
   * a self-service "Park now" proposal passes a longer hold and the user's id.
   */
  async acquire(
    slotId: string,
    options: { holdMs?: number; userId?: string } = {},
    db: DbClient = prisma,
  ): Promise<string | null> {
    const token = newHoldToken();
    const { count } = await db.parkingSlot.updateMany({
      where: { id: slotId, status: 'AVAILABLE', isActive: true },
      data: {
        status: 'HELD',
        holdToken: token,
        holdUserId: options.userId ?? null,
        holdExpiresAt: new Date(Date.now() + (options.holdMs ?? config.parking.slotHoldMs)),
      },
    });
    return count === 1 ? token : null;
  },

  /**
   * Final availability check and HELD → OCCUPIED, in the caller's transaction.
   * Succeeds only while this attempt still holds the slot, the hold has not
   * expired and the slot belongs to an active zone for `vehicleType`.
   */
  async confirm(
    slotId: string,
    token: string,
    vehicleType: VehicleType,
    db: DbClient = prisma,
    /** Self-service confirmation: the slot must be held by this user. */
    userId?: string,
  ): Promise<boolean> {
    const { count } = await db.parkingSlot.updateMany({
      where: {
        id: slotId,
        status: 'HELD',
        holdToken: token,
        ...(userId ? { holdUserId: userId } : {}),
        holdExpiresAt: { gt: new Date() },
        isActive: true,
        zone: { vehicleType, isActive: true, block: { isActive: true } },
      },
      data: { status: 'OCCUPIED', holdToken: null, holdUserId: null, holdExpiresAt: null },
    });
    return count === 1;
  },

  /** Returns every slot a user is holding for an unconfirmed "Park now" proposal to AVAILABLE. */
  async releaseHeldBy(userId: string, db: DbClient = prisma): Promise<number> {
    const { count } = await db.parkingSlot.updateMany({
      where: { status: 'HELD', holdUserId: userId },
      data: RELEASED,
    });
    return count;
  },

  /** HELD → AVAILABLE, only for the holder of `token`. */
  async release(slotId: string, token: string, db: DbClient = prisma): Promise<void> {
    await db.parkingSlot.updateMany({
      where: { id: slotId, status: 'HELD', holdToken: token },
      data: RELEASED,
    });
  },

  /** Returns every expired hold to AVAILABLE (e.g. after a crashed request). */
  async releaseExpired(db: DbClient = prisma): Promise<number> {
    const { count } = await db.parkingSlot.updateMany({
      where: { status: 'HELD', holdExpiresAt: { lte: new Date() } },
      data: RELEASED,
    });
    return count;
  },
};

export const slotHoldStore: SlotHoldStore = {
  acquire: (slotId) => slotHoldRepository.acquire(slotId),
  release: (slotId, token) => slotHoldRepository.release(slotId, token),
};
