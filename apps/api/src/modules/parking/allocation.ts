import type { AllocationCheck, AllocationExplanation } from '@cpvts/shared';

import { parkingErrors } from './parking.errors.js';

/**
 * Explainable, deterministic slot allocation (Master Blueprint §10–§11).
 * Rule-based only — no ML, no randomness. The same state and input always
 * produce the same ranking.
 */

export interface AllocationCandidate {
  slotId: string;
  slotCode: string;
  zoneName: string;
  blockName: string;
  /** Admin-configured preference (higher is preferred). */
  priority: number;
  /** Sessions started in this slot today — spreads use across the zone. */
  usesToday: number;
  /** 0-based position in the configured physical layout (block → zone → slot). */
  layoutPosition: number;
}

export interface RankedCandidate extends AllocationCandidate {
  score: number;
}

/** Score weights. Priority dominates; balanced utilisation beats layout order. */
export const ALLOCATION_WEIGHTS = { priority: 1000, usesToday: 10, layoutPosition: 1 } as const;

export const scoreCandidate = (candidate: AllocationCandidate): number =>
  ALLOCATION_WEIGHTS.priority * candidate.priority -
  ALLOCATION_WEIGHTS.usesToday * candidate.usesToday -
  ALLOCATION_WEIGHTS.layoutPosition * candidate.layoutPosition;

/**
 * Ranks candidates best-first. Ties are broken by layout position and then
 * slot code, so the order is total and reproducible.
 */
export const rankCandidates = (candidates: AllocationCandidate[]): RankedCandidate[] =>
  candidates
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.layoutPosition - b.layoutPosition ||
        a.slotCode.localeCompare(b.slotCode),
    );

/** Server-controlled temporary slot holds (AVAILABLE → HELD → OCCUPIED). */
export interface SlotHoldStore {
  /** Atomically moves an AVAILABLE slot to HELD; returns the hold token, or null if it was not available. */
  acquire(slotId: string): Promise<string | null>;
  /** Returns a slot still held with `token` to AVAILABLE. No-op otherwise. */
  release(slotId: string, token: string): Promise<void>;
}

/**
 * Commits the allocation for a held slot. Must verify the hold one final time
 * (HELD, same token, not expired, compatible zone) and return null if that
 * final check fails, so the next candidate is tried.
 */
export type CommitAllocation<T> = (
  candidate: RankedCandidate,
  holdToken: string,
) => Promise<T | null>;

export interface AllocationOutcome<T> {
  result: T;
  explanation: AllocationExplanation;
}

const CHECKS: AllocationCheck[] = [
  'CORRECT_ZONE',
  'AVAILABLE',
  'NOT_BLOCKED',
  'BEST_SCORE',
  'FINAL_AVAILABILITY_VERIFIED',
];

/**
 * Walks the ranked candidates: hold the best slot, run the final verification
 * and commit; if another terminal claimed the slot first (hold or final check
 * fails), fall back to the next candidate. Errors from `commit` release the
 * hold and propagate.
 */
export const allocateWithHold = async <T>(
  ranked: RankedCandidate[],
  holds: SlotHoldStore,
  commit: CommitAllocation<T>,
): Promise<AllocationOutcome<T>> => {
  let fallbacks = 0;

  for (const candidate of ranked) {
    const token = await holds.acquire(candidate.slotId);
    if (!token) {
      fallbacks += 1;
      continue;
    }

    let result: T | null;
    try {
      result = await commit(candidate, token);
    } catch (error) {
      await holds.release(candidate.slotId, token);
      throw error;
    }

    if (result === null) {
      await holds.release(candidate.slotId, token);
      fallbacks += 1;
      continue;
    }

    return {
      result,
      explanation: {
        slotCode: candidate.slotCode,
        zoneName: candidate.zoneName,
        blockName: candidate.blockName,
        score: candidate.score,
        factors: {
          priority: candidate.priority,
          usesToday: candidate.usesToday,
          layoutPosition: candidate.layoutPosition,
        },
        candidatesConsidered: ranked.length,
        fallbacks,
        checks: CHECKS,
      },
    };
  }

  throw parkingErrors.allocationFailed();
};
