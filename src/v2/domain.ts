import type {
  AssetEvent, DerivedMandate, DerivedMember, DerivedMemberRound, DerivedRound, DerivedWorkspace,
  V2Member, V2Round, V2Settlement, V2SettlementRow, V2Workspace,
} from './types';

const assertNonNegativeCents = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}_INVALID_CENTS`);
};

const roundHalfUp = (numerator: number, denominator: number) =>
  Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

export function allocateLargestRemainder(totalCents: number, weights: Array<{ memberId: string; weight: number }>) {
  assertNonNegativeCents(totalCents, 'TOTAL');
  const denominator = weights.reduce((sum, row) => sum + row.weight, 0);
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('WEIGHT_TOTAL_INVALID');
  const rows = weights.map((row) => {
    if (!Number.isSafeInteger(row.weight) || row.weight < 0) throw new Error('WEIGHT_INVALID');
    const numerator = totalCents * row.weight;
    return { ...row, cents: Math.floor(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = totalCents - rows.reduce((sum, row) => sum + row.cents, 0);
  [...rows].sort((a, b) => b.remainder - a.remainder || a.memberId.localeCompare(b.memberId)).forEach((row) => {
    if (remaining > 0) { row.cents += 1; remaining -= 1; }
  });
  return rows.map(({ remainder: _remainder, ...row }) => row);
}

export function settleV2Round({ members, round }: { members: V2Member[]; round: V2Round }): V2Settlement {
  if (round.status !== 'settled') throw new Error('ROUND_NOT_SETTLED');
  assertNonNegativeCents(round.totalStakeCents, 'STAKE');
  if (round.grossResultCents === undefined) throw new Error('RESULT_REQUIRED');
  assertNonNegativeCents(round.grossResultCents, 'RESULT');
  if (round.totalStakeCents === 0) throw new Error('STAKE_INVALID_CENTS');
  const czh = members.find((member) => member.isCzh && member.active);
  if (!czh) throw new Error('CZH_NOT_FOUND');

  if (round.mandateType === 'individual') {
    const owner = members.find((member) => member.id === round.ownerMemberId && member.active);
    if (!owner || owner.isCzh) throw new Error('MANDATE_OWNER_INVALID');
    const grossProfit = Math.max(round.grossResultCents - round.totalStakeCents, 0);
    const rakeCents = roundHalfUp(grossProfit * 10, 100);
    const ownerRow: V2SettlementRow = {
      memberId: owner.id, ratioBps: 10000, stakeCents: round.totalStakeCents,
      grossCents: round.grossResultCents, rakeCents,
      settlementCents: round.grossResultCents - rakeCents,
      netProfitCents: round.grossResultCents - rakeCents - round.totalStakeCents,
      managerRakeIncomeCents: 0,
    };
    const czhRow: V2SettlementRow = {
      memberId: czh.id, ratioBps: 0, stakeCents: 0, grossCents: 0, rakeCents: 0,
      settlementCents: rakeCents, netProfitCents: rakeCents, managerRakeIncomeCents: rakeCents,
    };
    return { feeCents: 0, rakeCents, rows: [ownerRow, czhRow] };
  }

  const ratios = round.lockedRatiosBps;
  if (!ratios) throw new Error('ROUND_RATIOS_REQUIRED');
  const participants = members.filter((member) => member.active && ratios[member.id] !== undefined);
  const totalBps = participants.reduce((sum, member) => sum + ratios[member.id], 0);
  if (totalBps !== 10000) throw new Error('RATIO_MUST_EQUAL_100_PERCENT');
  const weights = participants.map((member) => ({ memberId: member.id, weight: ratios[member.id] }));
  const stakes = allocateLargestRemainder(round.totalStakeCents, weights);
  const grosses = allocateLargestRemainder(round.grossResultCents, weights);
  const rows = participants.map<V2SettlementRow>((member) => {
    const stakeCents = stakes.find((row) => row.memberId === member.id)!.cents;
    const grossCents = grosses.find((row) => row.memberId === member.id)!.cents;
    return {
      memberId: member.id, ratioBps: ratios[member.id], stakeCents, grossCents, rakeCents: 0,
      settlementCents: grossCents, netProfitCents: grossCents - stakeCents, managerRakeIncomeCents: 0,
    };
  });
  return { feeCents: 0, rakeCents: 0, rows };
}

const chineseDigits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export function chineseNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 99) return String(value);
  if (value <= 10) return chineseDigits[value];
  if (value < 20) return `十${value % 10 ? chineseDigits[value % 10] : ''}`;
  return `${chineseDigits[Math.floor(value / 10)]}十${value % 10 ? chineseDigits[value % 10] : ''}`;
}

const effectiveRounds = (rounds: V2Round[]) => rounds.filter((round) => round.status === 'settled');
const sortedRounds = (rounds: V2Round[]) => [...effectiveRounds(rounds)].sort((a, b) =>
  a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

export function roundIdentity(rounds: V2Round[], round: V2Round) {
  const sameDay = sortedRounds(rounds.filter((row) => row.scheduledDate === round.scheduledDate));
  const index = sameDay.findIndex((row) => row.id === round.id);
  const sequence = round.displaySequence ?? (index >= 0 ? index + 1 : sameDay.length + 1);
  const [, month, day] = round.scheduledDate.split('-').map(Number);
  const suffix = round.mandateType === 'individual' ? '委托' : round.gameType === 'texas' ? '德州' : '其他';
  return {
    sequence,
    label: `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}·${sequence}`,
    name: `${chineseNumber(month)}月${chineseNumber(day)}日第${chineseNumber(sequence)}场·${suffix}`,
  };
}

export function canManageRound(workspace: V2Workspace, actorId: string, round: V2Round): boolean {
  const actor = workspace.members.find((member) => member.id === actorId && member.active);
  if (!actor) return false;
  if (actor.role === 'czh' || actor.role === 'waka') return true;
  return round.mandateType === 'individual' && round.ownerMemberId === actor.id && round.status === 'pending';
}

type MemberAccumulator = {
  asset: number;
  locked: number;
  locks: Map<string, number>;
  gameProfit: number;
  gameStake: number;
  managerRake: number;
  rounds: DerivedMemberRound[];
  mandates: DerivedMandate[];
  assetEvents: AssetEvent[];
};

const mandateLabel = (round: V2Round, identity: ReturnType<typeof roundIdentity>) => {
  if (round.status === 'pending') return `${identity.label}·待接手委托`;
  if (round.status === 'executing') return `${identity.label}·执行中委托`;
  if (round.status === 'cancelled') return `${identity.label}·已撤销委托`;
  return identity.name;
};

export function deriveV2Workspace(workspace: V2Workspace): DerivedWorkspace {
  const accumulators = Object.fromEntries(workspace.members.map((member) => [member.id, {
    asset: member.initialAssetCents, locked: 0, locks: new Map(), gameProfit: 0, gameStake: 0, managerRake: 0, rounds: [], mandates: [], assetEvents: [],
  } satisfies MemberAccumulator])) as Record<string, MemberAccumulator>;
  const derivedRounds = new Map<string, DerivedRound>();
  const marketEvents: DerivedWorkspace['market']['assetEvents'] = [];
  const shareholderIds = workspace.members.filter((member) => !member.isCzh && member.active).map((member) => member.id);
  const marketTotal = () => shareholderIds.reduce((sum, id) => sum + accumulators[id].asset, 0);
  const marketBalances = () => shareholderIds.map((memberId) => ({ memberId, name: workspace.members.find((member) => member.id === memberId)!.name, assetCents: accumulators[memberId].asset }));
  const addMarketEvent = (id: string, label: string, occurredAt: string, preTotalAssetCents: number, source: 'capital' | 'regular' | 'individual') => {
    marketEvents.push({ id, label, occurredAt, totalAssetCents: marketTotal(), preTotalAssetCents, balances: marketBalances(), source });
  };
  const identities = new Map(workspace.rounds.map((round) => [round.id, roundIdentity(workspace.rounds, round)]));
  type ReplayEvent =
    | { id: string; occurredAt: string; rank: number; kind: 'capital'; capital: V2Workspace['capitalEvents'][number] }
    | { id: string; occurredAt: string; rank: number; kind: 'lock'; round: V2Round }
    | { id: string; occurredAt: string; rank: number; kind: 'round'; round: V2Round };
  const events: ReplayEvent[] = [
    ...workspace.rounds.flatMap((round) => {
      const occurredAt = round.status === 'pending' || round.status === 'executing'
        ? round.requestedAt : round.status === 'cancelled' ? (round.cancelledAt ?? round.occurredAt) : (round.settledAt ?? round.occurredAt);
      const rank = round.status === 'pending' || round.status === 'executing' ? 1 : round.status === 'cancelled' ? 2 : 3;
      const lock = round.mandateType === 'individual' && (round.status === 'pending' || round.status === 'executing' || Boolean(round.startedAt))
        ? [{ id: `${round.id}:lock`, occurredAt: round.requestedAt, rank: 1, kind: 'lock' as const, round }]
        : [];
      return [...lock, { id: round.id, occurredAt, rank, kind: 'round' as const, round }];
    }),
    ...workspace.capitalEvents.map((capital) => ({ id: capital.id, occurredAt: capital.occurredAt, rank: 0, kind: 'capital' as const, capital })),
  ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.rank - b.rank || a.id.localeCompare(b.id));

  for (const round of workspace.rounds.filter((row) => row.mandateType === 'individual')) {
    const owner = round.ownerMemberId ? accumulators[round.ownerMemberId] : undefined;
    if (!owner) continue;
    const identity = identities.get(round.id)!;
    const lockedAssetCents = round.status === 'pending' || round.status === 'executing' ? round.totalStakeCents : 0;
    owner.mandates.push({ ...round, ...identity, name: identity.name, label: mandateLabel(round, identity), lockedAssetCents });
  }

  for (const event of events) {
    if (event.kind === 'capital') {
      const state = accumulators[event.capital.memberId];
      if (!state) throw new Error('MEMBER_NOT_FOUND');
      const preMarketTotalCents = marketTotal();
      const preAssetCents = state.asset;
      const endAssetCents = preAssetCents + event.capital.deltaCents;
      if (endAssetCents < state.locked) throw new Error('ASSET_BELOW_LOCKED');
      state.asset = endAssetCents;
      const label = `${event.capital.occurredAt.slice(5, 10)}·资金${event.capital.deltaCents >= 0 ? '增加' : '减少'}`;
      state.assetEvents.push({ id: event.id, kind: 'capital', label, occurredAt: event.capital.occurredAt, preAssetCents, endAssetCents, deltaCents: event.capital.deltaCents });
      if (shareholderIds.includes(event.capital.memberId)) addMarketEvent(event.id, label, event.capital.occurredAt, preMarketTotalCents, 'capital');
      continue;
    }

    if (event.kind === 'lock') {
      const round = event.round;
      const stateOwner = round.ownerMemberId ? accumulators[round.ownerMemberId] : undefined;
      if (!stateOwner) throw new Error('MANDATE_OWNER_INVALID');
      if (stateOwner.asset - stateOwner.locked < round.totalStakeCents) throw new Error(`ASSET_INSUFFICIENT:${round.ownerMemberId}:${round.id}`);
      stateOwner.locked += round.totalStakeCents;
      stateOwner.locks.set(round.id, round.totalStakeCents);
      continue;
    }
    const round = event.round;
    const stateOwner = round.ownerMemberId ? accumulators[round.ownerMemberId] : undefined;
    if (round.status === 'pending' || round.status === 'executing') {
      continue;
    }
    if (round.status === 'cancelled') {
      if (stateOwner) {
        const lockedForRound = stateOwner.locks.get(round.id) ?? 0;
        if (lockedForRound > 0) { stateOwner.locked -= lockedForRound; stateOwner.locks.delete(round.id); }
      }
      continue;
    }

    const settlement = settleV2Round({ members: workspace.members, round });
    const identity = identities.get(round.id)!;
    const preMarketTotalCents = marketTotal();
    const rows: DerivedRound['rows'] = [];
    for (const row of settlement.rows) {
      const state = accumulators[row.memberId];
      if (!state) throw new Error('MEMBER_NOT_FOUND');
      if (round.mandateType === 'individual') {
        // Historical settled mandates predate the lock lifecycle. New lifecycle
        // records have a matching lock entry, while migrated history settles
        // directly from available funds.
        const lockedForRound = state.locks.get(round.id) ?? 0;
        if (lockedForRound > 0) { state.locked -= lockedForRound; state.locks.delete(round.id); }
        else if (state.asset - state.locked < row.stakeCents) throw new Error(`ASSET_INSUFFICIENT:${row.memberId}:${round.id}`);
      } else if (state.asset - state.locked < row.stakeCents) {
        throw new Error(`ASSET_INSUFFICIENT:${row.memberId}:${round.id}`);
      }
      const preAssetCents = state.asset;
      const endAssetCents = preAssetCents + row.netProfitCents;
      if (endAssetCents < state.locked) throw new Error('ASSET_BELOW_LOCKED');
      const cumulativeProfitBeforeCents = state.gameProfit;
      state.asset = endAssetCents;
      state.gameProfit += row.netProfitCents;
      state.gameStake += row.stakeCents;
      state.managerRake += row.managerRakeIncomeCents;
      const memberRound: DerivedMemberRound = {
        ...row, roundId: round.id, ...identity, occurredAt: round.settledAt ?? round.occurredAt,
        gameType: round.gameType, mandateType: round.mandateType, preAssetCents, endAssetCents,
        cumulativeProfitBeforeCents, cumulativeProfitAfterCents: state.gameProfit,
      };
      state.rounds.push(memberRound);
      state.assetEvents.push({ id: round.id, kind: 'round', label: identity.label, occurredAt: memberRound.occurredAt, preAssetCents, endAssetCents, deltaCents: row.netProfitCents, roundId: round.id });
      rows.push({ ...row, preAssetCents, endAssetCents });
    }
    derivedRounds.set(round.id, { ...round, ...identity, name: identity.name, label: identity.label, rakeCents: settlement.rakeCents, rows });
    if (settlement.rows.some((row) => shareholderIds.includes(row.memberId))) addMarketEvent(round.id, identity.label, round.settledAt ?? round.occurredAt, preMarketTotalCents, round.mandateType);
  }

  const members = Object.fromEntries(workspace.members.map((member) => {
    const state = accumulators[member.id];
    const derived: DerivedMember = {
      member, currentAssetCents: state.asset, availableAssetCents: state.asset - state.locked, lockedMandateCents: state.locked,
      cumulativeGameProfitCents: state.gameProfit, cumulativeGameStakeCents: state.gameStake,
      cumulativeReturnBps: state.gameStake ? Math.round(state.gameProfit * 10000 / state.gameStake) : null,
      managerRakeIncomeCents: state.managerRake, rounds: state.rounds, mandates: state.mandates.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), assetEvents: state.assetEvents,
    };
    return [member.id, derived];
  })) as Record<string, DerivedMember>;
  const currentTotalCents = marketTotal();
  const shares = shareholderIds.map((memberId) => ({
    memberId, name: members[memberId].member.name, assetCents: members[memberId].currentAssetCents,
    shareBps: currentTotalCents ? Math.round(members[memberId].currentAssetCents * 10000 / currentTotalCents) : null,
  }));
  const rounds = sortedRounds(workspace.rounds).map((round) => derivedRounds.get(round.id)!).filter(Boolean);
  const commonRounds = rounds.filter((round) => round.mandateType === 'regular');
  return {
    source: workspace, members, rounds,
    market: { currentTotalCents, shares, assetEvents: marketEvents },
    commonRecord: {
      rounds: commonRounds,
      totalStakeCents: commonRounds.reduce((sum, round) => sum + round.totalStakeCents, 0),
      totalGrossCents: commonRounds.reduce((sum, round) => sum + (round.grossResultCents ?? 0), 0),
      totalNetProfitCents: commonRounds.reduce((sum, round) => sum + round.rows.reduce((inner, row) => inner + row.netProfitCents, 0), 0),
    },
  };
}

export type RoundSummary = {
  count: number;
  winningCount: number;
  totalStakeCents: number;
  netProfitCents: number;
  winningRateBps: number | null;
  regularNetProfitCents: number;
  individualNetProfitCents: number;
  individualRakeCents: number;
  managerRakeIncomeCents: number;
};

export function summarizeRounds(rounds: Array<Pick<DerivedMemberRound, 'stakeCents' | 'netProfitCents' | 'mandateType' | 'rakeCents' | 'managerRakeIncomeCents'>>): RoundSummary {
  // A CZH manager-rake row has no stake. It remains visible in the individual
  // filter as income, but must not inflate CZH's own game count or win rate.
  const countedRounds = rounds.filter((round) => round.stakeCents > 0);
  const count = countedRounds.length;
  const regularNetProfitCents = rounds.filter((round) => round.mandateType === 'regular').reduce((sum, round) => sum + round.netProfitCents, 0);
  const individual = rounds.filter((round) => round.mandateType === 'individual');
  return {
    count, winningCount: countedRounds.filter((round) => round.netProfitCents > 0).length,
    totalStakeCents: countedRounds.reduce((sum, round) => sum + round.stakeCents, 0),
    netProfitCents: rounds.reduce((sum, round) => sum + round.netProfitCents, 0),
    winningRateBps: count ? Math.round(countedRounds.filter((round) => round.netProfitCents > 0).length * 10000 / count) : null,
    regularNetProfitCents, individualNetProfitCents: individual.reduce((sum, round) => sum + round.netProfitCents, 0),
    individualRakeCents: individual.reduce((sum, round) => sum + round.rakeCents, 0),
    managerRakeIncomeCents: individual.reduce((sum, round) => sum + round.managerRakeIncomeCents, 0),
  };
}

export const formatB = (cents: number, signed = false) => {
  const sign = cents < 0 ? '-' : signed && cents > 0 ? '+' : '';
  return `${sign}${(Math.abs(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} B`;
};

export const formatPercent = (bps: number | null) => bps === null ? '暂无' : `${(bps / 100).toFixed(2)}%`;
export const tone = (value: number) => value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';

export function parseBToCents(value: string): number | null {
  const normalized = value.trim().replace(/^B\s*/i, '').replace(/\s*B$/i, '');
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.replaceAll(',', '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}
