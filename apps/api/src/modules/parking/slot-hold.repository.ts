import { config } from '../../config/index.js';
import type { DbClient } from '../../db/client.js';
import { prisma } from '../../db/prisma.js';
import type { VehicleType } from '../../generated/prisma/client.js';
import { newHoldToken } from '../../lib/identifiers.js';
import type { SlotHoldStore } from './allocation.js';

const RELEASED = { status: 'AVAILABLE', holdToken: null, holdExpiresAt: null } as const;

/**
 * Temporary slot holds implemented as atomic compare-and-set updates, so two
 * terminals can never hold or occupy the same slot. Holds expire after
 * `SLOT_HOLD_SECONDS`; expired holds are reclaimed before allocation and reads.
 */
export const slotHoldRepository = {
  /** AVAILABLE → HELD. Returns the hold token, or null if the slot was not available. */
  async acquire(slotId: string, db: DbClient = prisma): Promise<string | null> {
    const token = newHoldToken();
    const { count } = await db.parkingSlot.updateMany({
      where: { id: slotId, status: 'AVAILABLE' },
      data: {
        status: 'HELD',
        holdToken: token,
        holdExpiresAt: new Date(Date.now() + config.parking.slotHoldMs),
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
  ): Promise<boolean> {
    const { count } = await db.parkingSlot.updateMany({
      where: {
        id: slotId,
        status: 'HELD',
        holdToken: token,
        holdExpiresAt: { gt: new Date() },
        zone: { vehicleType, isActive: true, block: { isActive: true } },
      },
      data: { status: 'OCCUPIED', holdToken: null, holdExpiresAt: null },
    });
    return count === 1;
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
