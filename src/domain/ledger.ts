export type AllocationInput = { memberId: string; ratioBps: number; stakeCents: number };
export type SettlementRow = AllocationInput & { settlementCents: number; profitCents: number };
export type Settlement = { feeCents: number; managerFeeCents: number; distributableCents: number; allocations: SettlementRow[] };

const assertCents = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}_INVALID_CENTS`);
};

/** Non-negative integer half-up division; avoids decimal percentage arithmetic. */
const roundHalfUp = (numerator: number, denominator: number) => Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

/** Shared by the settlement preview and the final settlement path. */
export function calculateRoundTotals(stakeCents: number, resultCents: number) {
  assertCents(stakeCents, 'STAKE'); assertCents(resultCents, 'RESULT');
  const feeCents = roundHalfUp(resultCents * 3, 100);
  const managerFeeCents = roundHalfUp(Math.max(resultCents - stakeCents, 0) * 10, 100);
  return { feeCents, managerFeeCents, distributableCents: resultCents - feeCents - managerFeeCents };
}

/** Allocates integer cents without loss: ties resolve by member id for repeatable results. */
export function allocateLargestRemainder(totalCents: number, allocations: AllocationInput[]) {
  assertCents(totalCents, 'TOTAL');
  if (allocations.reduce((sum, row) => sum + row.ratioBps, 0) !== 10000) throw new Error('RATIO_MUST_EQUAL_100_PERCENT');
  const rows = allocations.map((row) => {
    if (!Number.isInteger(row.ratioBps) || row.ratioBps < 0) throw new Error('RATIO_INVALID');
    const numerator = totalCents * row.ratioBps;
    return { ...row, settlementCents: Math.floor(numerator / 10000), remainder: numerator % 10000 };
  });
  let unallocated = totalCents - rows.reduce((sum, row) => sum + row.settlementCents, 0);
  [...rows].sort((a, b) => b.remainder - a.remainder || a.memberId.localeCompare(b.memberId)).forEach((row) => {
    if (unallocated > 0) { row.settlementCents += 1; unallocated -= 1; }
  });
  return rows.map(({ remainder: _ignored, ...row }) => row);
}

export function settleRound(input: { stakeCents: number; resultCents: number; allocations: AllocationInput[] }): Settlement {
  const { stakeCents, resultCents, allocations } = input;
  assertCents(stakeCents, 'STAKE'); assertCents(resultCents, 'RESULT');
  if (allocations.reduce((sum, row) => sum + row.stakeCents, 0) !== stakeCents) throw new Error('STAKE_ALLOCATION_MISMATCH');
  const { feeCents, managerFeeCents, distributableCents } = calculateRoundTotals(stakeCents, resultCents);
  const rows = allocateLargestRemainder(distributableCents, allocations);
  return { feeCents, managerFeeCents, distributableCents, allocations: rows.map((row) => ({ ...row, profitCents: row.settlementCents - row.stakeCents })) };
}

export function summarizePortfolio(input: { availableInvestmentCents: number; lockedRoundCostCents: number; pendingReturnCents: number; returnedCents: number; confirmedDepositCents: number }) {
  const investmentAssetCents = input.availableInvestmentCents + input.lockedRoundCostCents;
  const currentTotalCents = investmentAssetCents + input.pendingReturnCents;
  const cumulativeProfitCents = currentTotalCents + input.returnedCents - input.confirmedDepositCents;
  return { investmentAssetCents, currentTotalCents, cumulativeProfitCents, cumulativeReturnBps: input.confirmedDepositCents ? Math.round(cumulativeProfitCents * 10000 / input.confirmedDepositCents) : null };
}

export const formatB = (cents: number, signed = false) => {
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  return `${sign}B${(Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const formatPercent = (bps: number | null) => bps === null ? '—' : `${(bps / 100).toFixed(2)}%`;
export const tone = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';

/** Parses a B amount without passing a decimal through floating-point arithmetic. */
export function parseBToCents(value: string): number | null {
  const normalized = value.trim().replace(/^B\s*/i, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const match = normalized.match(/^(\d+(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const whole = Number(match[1].replaceAll(',', '')); const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}
