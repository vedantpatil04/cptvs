import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../src/lib/errors.js';
import {
  allocateWithHold,
  rankCandidates,
  type AllocationCandidate,
  type SlotHoldStore,
} from '../src/modules/parking/allocation.js';

const candidate = (
  code: string,
  overrides: Partial<AllocationCandidate> = {},
): AllocationCandidate => ({
  slotId: `id-${code}`,
  slotCode: code,
  zoneName: 'Two-Wheeler Zone',
  blockName: 'Two-Wheeler Parking Block',
  priority: 0,
  usesToday: 0,
  layoutPosition: Number(code.slice(2)) - 1,
  ...overrides,
});

const codes = (ranked: { slotCode: string }[]) => ranked.map((c) => c.slotCode);

describe('rankCandidates', () => {
  it('prefers layout order when everything else is equal', () => {
    expect(
      codes(rankCandidates([candidate('T-03'), candidate('T-01'), candidate('T-02')])),
    ).toEqual(['T-01', 'T-02', 'T-03']);
  });

  it('prefers less-used slots today (balanced utilisation)', () => {
    const ranked = rankCandidates([candidate('T-01', { usesToday: 2 }), candidate('T-02')]);
    expect(codes(ranked)).toEqual(['T-02', 'T-01']);
  });

  it('applies admin-configured priority above everything else', () => {
    const ranked = rankCandidates([
      candidate('T-01'),
      candidate('T-09', { priority: 1, usesToday: 5 }),
    ]);
    expect(codes(ranked)[0]).toBe('T-09');
  });

  it('is deterministic for the same input regardless of order', () => {
    const input = [
      candidate('T-04', { usesToday: 1 }),
      candidate('T-02', { usesToday: 1 }),
      candidate('T-07'),
      candidate('T-05'),
    ];
    const first = codes(rankCandidates(input));
    for (let i = 0; i < 20; i += 1) {
      expect(codes(rankCandidates([...input].reverse()))).toEqual(first);
    }
  });
});

const store = (overrides: Partial<SlotHoldStore> = {}): SlotHoldStore => ({
  acquire: vi.fn(async (slotId: string) => `token-${slotId}`),
  release: vi.fn(async () => {}),
  ...overrides,
});

describe('allocateWithHold', () => {
  const ranked = rankCandidates([candidate('T-01'), candidate('T-02'), candidate('T-03')]);

  it('commits the best candidate and explains the decision', async () => {
    const holds = store();
    const outcome = await allocateWithHold(ranked, holds, async (c) => c.slotCode);
    expect(outcome.result).toBe('T-01');
    expect(outcome.explanation).toMatchObject({
      slotCode: 'T-01',
      candidatesConsidered: 3,
      fallbacks: 0,
      checks: [
        'CORRECT_ZONE',
        'AVAILABLE',
        'NOT_BLOCKED',
        'BEST_SCORE',
        'FINAL_AVAILABILITY_VERIFIED',
      ],
    });
    expect(holds.release).not.toHaveBeenCalled();
  });

  it('falls back when another terminal holds the best slot first', async () => {
    const holds = store({
      acquire: vi.fn(async (slotId: string) => (slotId === 'id-T-01' ? null : `token-${slotId}`)),
    });
    const outcome = await allocateWithHold(ranked, holds, async (c) => c.slotCode);
    expect(outcome.result).toBe('T-02');
    expect(outcome.explanation.fallbacks).toBe(1);
  });

  it('falls back when the final availability check fails, releasing the hold', async () => {
    const holds = store();
    const outcome = await allocateWithHold(ranked, holds, async (c) =>
      c.slotCode === 'T-01' ? null : c.slotCode,
    );
    expect(outcome.result).toBe('T-02');
    expect(holds.release).toHaveBeenCalledWith('id-T-01', 'token-id-T-01');
  });

  it('releases the hold and propagates errors from the commit', async () => {
    const holds = store();
    await expect(
      allocateWithHold(ranked, holds, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(holds.release).toHaveBeenCalledWith('id-T-01', 'token-id-T-01');
  });

  it('fails cleanly when every candidate is lost', async () => {
    const holds = store({ acquire: vi.fn(async () => null) });
    await expect(allocateWithHold(ranked, holds, async () => 'never')).rejects.toMatchObject({
      code: 'ALLOCATION_FAILED',
    });
    await expect(allocateWithHold(ranked, holds, async () => 'never')).rejects.toBeInstanceOf(
      AppError,
    );
  });
});
