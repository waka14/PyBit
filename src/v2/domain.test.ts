import { describe, expect, it } from 'vitest';
import { canManageRound, deriveV2Workspace, settleV2Round, summarizeRounds } from './domain';
import type { V2Member, V2Round, V2Workspace } from './types';

const members: V2Member[] = [
  { id: 'waka', name: 'waka', role: 'waka', isCzh: false, ratioBps: 3000, initialAssetCents: 100000, active: true },
  { id: 'one', name: '一号股东', role: 'member', isCzh: false, ratioBps: 3000, initialAssetCents: 100000, active: true },
  { id: 'two', name: '二号股东', role: 'member', isCzh: false, ratioBps: 3000, initialAssetCents: 100000, active: true },
  { id: 'czh', name: 'czh', role: 'czh', isCzh: true, ratioBps: 1000, initialAssetCents: 100000, active: true },
];

const regular = (overrides: Partial<V2Round> = {}): V2Round => ({
  id: 'round-1', status: 'settled', scheduledDate: '2026-09-08', occurredAt: '2026-09-08 20:00:00', requestedAt: '2026-09-08 19:00:00', settledAt: '2026-09-08 20:00:00',
  totalStakeCents: 100000, grossResultCents: 500000, gameType: 'texas', mandateType: 'regular',
  lockedRatiosBps: { waka: 3000, one: 3000, two: 3000, czh: 1000 }, createdBy: 'czh', revision: 1,
  ...overrides,
});

const workspace = (rounds: V2Round[] = []): V2Workspace => ({
  schemaVersion: 3, members, rounds, capitalEvents: [], ratioChanges: [], auditLogs: [], updatedAt: '2026-09-11 12:00:00',
});

describe('PYBIT V2 accounting seam', () => {
  it('settles B1,000 to B5,000 with shareholder-profit rake and no 3% fee', () => {
    const result = settleV2Round({ members, round: regular() });
    expect(result.feeCents).toBe(0);
    expect(result.rakeCents).toBe(0);
    expect(result.rows.find((row) => row.memberId === 'waka')).toMatchObject({ stakeCents: 30000, grossCents: 150000, rakeCents: 0, settlementCents: 150000, netProfitCents: 120000 });
    expect(result.rows.find((row) => row.memberId === 'czh')).toMatchObject({ stakeCents: 10000, grossCents: 50000, rakeCents: 0, settlementCents: 50000, netProfitCents: 40000, managerRakeIncomeCents: 0 });
    expect(result.rows.reduce((sum, row) => sum + row.settlementCents, 0)).toBe(500000);
  });

  it('derives B2,200 per shareholder and B1,400 for CZH after the standard win', () => {
    const derived = deriveV2Workspace(workspace([regular()])).members;
    expect(derived.waka.currentAssetCents).toBe(220000);
    expect(derived.one.currentAssetCents).toBe(220000);
    expect(derived.two.currentAssetCents).toBe(220000);
    expect(derived.czh.currentAssetCents).toBe(140000);
  });

  it('does not charge rake on a loss or break-even result', () => {
    expect(settleV2Round({ members, round: regular({ grossResultCents: 50000 }) }).rakeCents).toBe(0);
    expect(settleV2Round({ members, round: regular({ grossResultCents: 100000 }) }).rakeCents).toBe(0);
  });

  it('settles an individual mandate only for its owner and CZH', () => {
    const result = settleV2Round({ members, round: regular({ mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 70000, grossResultCents: 140000, lockedRatiosBps: undefined }) });
    expect(result.rows).toEqual([
      { memberId: 'one', ratioBps: 10000, stakeCents: 70000, grossCents: 140000, rakeCents: 7000, settlementCents: 133000, netProfitCents: 63000, managerRakeIncomeCents: 0 },
      { memberId: 'czh', ratioBps: 0, stakeCents: 0, grossCents: 0, rakeCents: 0, settlementCents: 7000, netProfitCents: 7000, managerRakeIncomeCents: 7000 },
    ]);
  });

  it('exposes individual rake as owner expense and manager income separately', () => {
    const derived = deriveV2Workspace(workspace([regular({ mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 70000, grossResultCents: 140000, lockedRatiosBps: undefined })]));
    expect(summarizeRounds(derived.members.one.rounds)).toMatchObject({ individualRakeCents: 7000, managerRakeIncomeCents: 0 });
    expect(summarizeRounds(derived.members.czh.rounds)).toMatchObject({ individualRakeCents: 0, managerRakeIncomeCents: 7000 });
  });

  it('keeps a fixed capital delta when an earlier profitable round is removed', () => {
    const withRound = workspace([regular()]);
    withRound.capitalEvents.push({ id: 'capital-1', memberId: 'waka', deltaCents: 100000, beforeCents: 208000, targetCents: 308000, occurredAt: '2026-09-09 09:00:00', actorId: 'waka' });
    expect(deriveV2Workspace(withRound).members.waka.currentAssetCents).toBe(320000);
    expect(deriveV2Workspace({ ...withRound, rounds: [] }).members.waka.currentAssetCents).toBe(200000);
  });

  it('uses only game profit and stake for cumulative return', () => {
    const rounds = [
      regular({ id: 'win', mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 30000, grossResultCents: 41111, lockedRatiosBps: undefined }),
      regular({ id: 'loss', scheduledDate: '2026-09-09', occurredAt: '2026-09-09 20:00:00', mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 30000, grossResultCents: 25000, lockedRatiosBps: undefined }),
    ];
    const derived = deriveV2Workspace(workspace(rounds)).members.one;
    expect(derived.cumulativeGameProfitCents).toBe(5000);
    expect(derived.cumulativeGameStakeCents).toBe(60000);
    expect(derived.cumulativeReturnBps).toBe(833);
  });

  it('renumbers visible same-day rounds after deletion without changing ids', () => {
    const first = regular({ id: 'first' });
    const second = regular({ id: 'second', occurredAt: '2026-09-08 22:00:00' });
    const before = deriveV2Workspace(workspace([first, second]));
    expect(before.rounds.map((round) => round.name)).toEqual(['九月八日第一场·德州', '九月八日第二场·德州']);
    const after = deriveV2Workspace(workspace([second]));
    expect(after.rounds.map((round) => ({ id: round.id, name: round.name }))).toEqual([{ id: 'second', name: '九月八日第一场·德州' }]);
  });

  it('uses a server-provided global sequence when hidden mandates are filtered out', () => {
    const visibleRegular = regular({ id: 'visible', displaySequence: 2 });
    expect(deriveV2Workspace(workspace([visibleRegular])).rounds[0].name).toBe('九月八日第二场·德州');
  });

  it('allows administrators all rounds and members only their own mandates', () => {
    const individual = regular({ status: 'pending', mandateType: 'individual', ownerMemberId: 'one', grossResultCents: undefined });
    expect(canManageRound(workspace(), 'czh', regular())).toBe(true);
    expect(canManageRound(workspace(), 'waka', individual)).toBe(true);
    expect(canManageRound(workspace(), 'one', individual)).toBe(true);
    expect(canManageRound(workspace(), 'two', individual)).toBe(false);
    expect(canManageRound(workspace(), 'one', regular())).toBe(false);
  });

  it('keeps a pending mandate locked without changing total asset and settles only with a known output', () => {
    const pending = regular({ id: 'pending', status: 'pending', mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 70000, grossResultCents: undefined, requestedAt: '2026-09-08 19:00:00', settledAt: undefined, lockedRatiosBps: undefined });
    const pendingState = deriveV2Workspace(workspace([pending])).members.one;
    expect(pendingState).toMatchObject({ currentAssetCents: 100000, availableAssetCents: 30000, lockedMandateCents: 70000 });
    expect(pendingState.rounds).toHaveLength(0);
    expect(pendingState.mandates[0]).toMatchObject({ status: 'pending', lockedAssetCents: 70000 });

    const settled = { ...pending, status: 'settled' as const, grossResultCents: 140000, settledAt: '2026-09-09 20:00:00', occurredAt: '2026-09-09 20:00:00' };
    const settledState = deriveV2Workspace(workspace([settled])).members.one;
    expect(settledState).toMatchObject({ currentAssetCents: 163000, availableAssetCents: 163000, lockedMandateCents: 0 });
    expect(settledState.rounds[0]).toMatchObject({ netProfitCents: 63000, rakeCents: 7000 });
  });

  it('cancels a pending mandate without profit and excludes individual mandates from common record', () => {
    const cancelled = regular({ id: 'cancelled', status: 'cancelled', mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 70000, grossResultCents: undefined, requestedAt: '2026-09-08 19:00:00', cancelledAt: '2026-09-09 10:00:00', occurredAt: '2026-09-09 10:00:00', lockedRatiosBps: undefined });
    const individual = regular({ id: 'individual', status: 'settled', mandateType: 'individual', ownerMemberId: 'one', totalStakeCents: 70000, grossResultCents: 140000, requestedAt: '2026-09-09 19:00:00', settledAt: '2026-09-09 20:00:00', occurredAt: '2026-09-09 20:00:00', lockedRatiosBps: undefined });
    const derived = deriveV2Workspace(workspace([regular({ grossResultCents: 80000 }), cancelled, individual]));
    expect(derived.members.one).toMatchObject({ currentAssetCents: 157000, availableAssetCents: 157000, lockedMandateCents: 0 });
    expect(derived.rounds.map((round) => round.id)).toEqual(['round-1', 'individual']);
    expect(derived.commonRecord.rounds.map((round) => round.id)).toEqual(['round-1']);
    expect(derived.commonRecord.totalNetProfitCents).toBe(-20000);
  });

  it('computes a selected-round summary with break-even rounds in the denominator', () => {
    const first = regular({ id: 'win', totalStakeCents: 30000, grossResultCents: 40000 });
    const second = regular({ id: 'flat', scheduledDate: '2026-09-09', occurredAt: '2026-09-09 20:00:00', requestedAt: '2026-09-09 19:00:00', settledAt: '2026-09-09 20:00:00', totalStakeCents: 30000, grossResultCents: 30000 });
    const selected = deriveV2Workspace(workspace([first, second])).members.one.rounds;
    expect(summarizeRounds(selected)).toMatchObject({ count: 2, winningCount: 1, totalStakeCents: 18000, netProfitCents: 3000, winningRateBps: 5000, managerRakeIncomeCents: 0 });
  });
});
