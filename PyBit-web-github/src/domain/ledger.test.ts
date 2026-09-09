import { describe, expect, it } from 'vitest';
import { allocateLargestRemainder, calculateRoundTotals, formatB, formatPercent, parseBToCents, settleRound, summarizePortfolio } from './ledger';

const allocations = [
  { memberId: 'a', ratioBps: 3500, stakeCents: 35000 }, { memberId: 'b', ratioBps: 2000, stakeCents: 20000 },
  { memberId: 'c', ratioBps: 2000, stakeCents: 20000 }, { memberId: 'd', ratioBps: 1500, stakeCents: 15000 },
  { memberId: 'czh', ratioBps: 1000, stakeCents: 10000 }
];

describe('exact-cent match settlement', () => {
  it('charges 3% fee and 10% positive gross-profit manager fee before allocation', () => {
    const settled = settleRound({ stakeCents: 100000, resultCents: 300000, allocations });
    expect(settled.feeCents).toBe(9000); expect(settled.managerFeeCents).toBe(20000);
    expect(settled.distributableCents).toBe(271000); expect(settled.allocations[0].settlementCents).toBe(94850);
    expect(settled.allocations.reduce((sum, row) => sum + row.settlementCents, 0) + settled.feeCents + settled.managerFeeCents).toBe(300000);
  });
  it('charges result-based fee for break-even and loss, without a negative manager fee', () => {
    expect(settleRound({ stakeCents: 100000, resultCents: 100000, allocations }).feeCents).toBe(3000);
    const loss = settleRound({ stakeCents: 100000, resultCents: 70000, allocations });
    expect(loss.feeCents).toBe(2100); expect(loss.managerFeeCents).toBe(0);
  });
  it('uses the same integer fee preview totals as settlement', () => {
    expect(calculateRoundTotals(10001, 10001)).toEqual({ feeCents: 300, managerFeeCents: 0, distributableCents: 9701 });
    const settled = settleRound({ stakeCents: 10001, resultCents: 30003, allocations: allocations.map((row) => ({ ...row, stakeCents: row.memberId === 'a' ? 3500 : row.memberId === 'b' || row.memberId === 'c' ? 2000 : row.memberId === 'd' ? 1500 : 1001 })) });
    expect(settled.feeCents).toBe(calculateRoundTotals(10001, 30003).feeCents);
  });
  it('keeps transfer history out of cumulative profit and formats B consistently', () => {
    expect(summarizePortfolio({ availableInvestmentCents: 300000, lockedRoundCostCents: 0, pendingReturnCents: 0, returnedCents: 200000, confirmedDepositCents: 100000 }).cumulativeReturnBps).toBe(40000);
    expect(formatB(-123456)).toBe('-B1,234.56'); expect(formatPercent(0)).toBe('0.00%');
  });
  it('parses administrator settlement input to cents without a float conversion', () => {
    expect(parseBToCents('948.50')).toBe(94850); expect(parseBToCents('B3,000.00')).toBe(300000); expect(parseBToCents('0')).toBe(0); expect(parseBToCents('12.345')).toBeNull(); expect(parseBToCents('3,00.00')).toBeNull();
  });
  it('conserves every cent of B100.01 with stable largest-remainder ordering', () => {
    const shares = allocateLargestRemainder(10001, allocations);
    expect(shares.reduce((sum, row) => sum + row.settlementCents, 0)).toBe(10001);
    expect(shares.map((row) => row.settlementCents)).toEqual([3501, 2000, 2000, 1500, 1000]);
  });
  it('conserves tiny, zero-weight, full-weight and fractional-basis-point allocations', () => {
    const checks = [[1, [{ memberId: 'a', ratioBps: 0, stakeCents: 0 }, { memberId: 'b', ratioBps: 10000, stakeCents: 0 }]], [7, [{ memberId: 'a', ratioBps: 3333, stakeCents: 0 }, { memberId: 'b', ratioBps: 6667, stakeCents: 0 }]], [99999, [{ memberId: 'a', ratioBps: 10000, stakeCents: 0 }]]] as const;
    checks.forEach(([amount, rows]) => expect(allocateLargestRemainder(amount, [...rows]).reduce((sum, row) => sum + row.settlementCents, 0)).toBe(amount));
  });
});
