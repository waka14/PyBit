import { allocateLargestRemainder, settleRound, summarizePortfolio } from '../domain/ledger';
import type { ActiveRoundStatus, ActorContext, CashMove, MatchInput, Member, MemberDashboard, MemberRound, Workspace } from './types';

const members: Member[] = [
  { id: 'member-a', name: 'waka', role: 'ADMIN', isCzh: false, ratioBps: 3500, initialDepositCents: 100000, initialInvestmentCents: 100000, initialPendingReturnCents: 0, initialReturnedCents: 0 },
  { id: 'member-b', name: '一号股东', role: 'MEMBER', isCzh: false, ratioBps: 2000, initialDepositCents: 100000, initialInvestmentCents: 100000, initialPendingReturnCents: 0, initialReturnedCents: 0 },
  { id: 'member-c', name: '二号股东', role: 'MEMBER', isCzh: false, ratioBps: 2000, initialDepositCents: 100000, initialInvestmentCents: 100000, initialPendingReturnCents: 0, initialReturnedCents: 0 },
  { id: 'member-d', name: '三号股东', role: 'MEMBER', isCzh: false, ratioBps: 1500, initialDepositCents: 100000, initialInvestmentCents: 100000, initialPendingReturnCents: 0, initialReturnedCents: 0 },
  { id: 'czh', name: 'czh', role: 'ADMIN', isCzh: true, ratioBps: 1000, initialDepositCents: 100000, initialInvestmentCents: 100000, initialPendingReturnCents: 0, initialReturnedCents: 0 }
];
const initialRatios = { 'member-a': 3500, 'member-b': 2000, 'member-c': 2000, 'member-d': 1500, czh: 1000 };
const rounds: MatchInput[] = [
  { id: 'r-001', label: '09-01·1', scheduledDate: '2026-09-01', timezone: 'Asia/Shanghai', sequence: 1, occurredAt: '2026-09-01 20:00', totalStakeCents: 100000, grossResultCents: 92000, status: 'SETTLED', lockedRatiosBps: initialRatios },
  { id: 'r-002', label: '09-02·1', scheduledDate: '2026-09-02', timezone: 'Asia/Shanghai', sequence: 1, occurredAt: '2026-09-02 21:00', totalStakeCents: 100000, grossResultCents: 300000, status: 'SETTLED', lockedRatiosBps: initialRatios },
  { id: 'r-003', label: '09-04·1', scheduledDate: '2026-09-04', timezone: 'Asia/Shanghai', sequence: 1, occurredAt: '2026-09-04 20:30', totalStakeCents: 100000, grossResultCents: 110000, status: 'SETTLED', lockedRatiosBps: initialRatios },
  { id: 'r-004', label: '09-06·1', scheduledDate: '2026-09-06', timezone: 'Asia/Shanghai', sequence: 1, occurredAt: '2026-09-06 19:30', totalStakeCents: 100000, grossResultCents: 70000, status: 'SETTLED', lockedRatiosBps: initialRatios },
  { id: 'r-005', label: '09-06·2', scheduledDate: '2026-09-06', timezone: 'Asia/Shanghai', sequence: 2, occurredAt: '2026-09-06 22:00', totalStakeCents: 100000, grossResultCents: 1000000, status: 'SETTLED', lockedRatiosBps: initialRatios },
  { id: 'r-006', label: '09-08·1', scheduledDate: '2026-09-08', timezone: 'Asia/Shanghai', sequence: 1, occurredAt: '2026-09-08 20:00', totalStakeCents: 100000, status: 'OPEN', lockedRatiosBps: initialRatios }
];
const chinese = ['零','一','二','三','四','五','六','七','八','九','十'];
export const chineseNumber = (value: number) => {
  if (!Number.isInteger(value) || value < 0 || value > 99) return String(value);
  if (value <= 10) return chinese[value];
  if (value < 20) return `十${value % 10 ? chinese[value % 10] : ''}`;
  return `${chinese[Math.floor(value / 10)]}十${value % 10 ? chinese[value % 10] : ''}`;
};
export const roundName = (round: MatchInput) => { const [, month, day] = round.scheduledDate.split('-'); return `${chineseNumber(Number(month))}月${chineseNumber(Number(day))}日第${chineseNumber(round.sequence)}场`; };
const cashMoves: CashMove[] = [
  { id: 'move-001', memberId: 'member-a', afterRoundId: 'r-004', type: 'TO_PENDING', amountCents: 2500, occurredAt: '2026-09-06 21:00' },
  { id: 'move-002', memberId: 'member-a', afterRoundId: 'r-005', type: 'ACTUAL_RETURN', amountCents: 1000, occurredAt: '2026-09-06 23:00' }
];
export const mockWorkspace: Workspace = { schemaVersion: 2, members, rounds, cashMoves, invalidatedSettlementRoundIds: [], invalidatedLedgerRoundIds: [], auditLogs: [], returnRequests: [], ratioChanges: [], fundingAdjustments: [], initialSetupComplete: false, sequenceReservations: Object.fromEntries(rounds.map((round) => [round.scheduledDate, Math.max(round.sequence, 0)])), updatedAt: '2026-09-08 21:16' };
const uniqueId = (prefix: string) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
export const demoActor = (memberId: string): ActorContext => ({ memberId, mode: 'demo' });
const actorId = (actor: ActorContext) => { if (actor.mode !== 'demo' || !actor.memberId) throw new Error('DEMO_ACTOR_REQUIRED'); return actor.memberId; };
/** Makes previously saved MVP data safe after new optional local fields are introduced. */
export function normalizeWorkspace(workspace: Workspace): Workspace {
  if (!workspace || !Array.isArray(workspace.members) || !Array.isArray(workspace.rounds)) throw new Error('WORKSPACE_MIGRATION_UNSAFE');
  const dedupeIds = <T extends { id: string }>(rows: T[], prefix: string) => { const seen = new Set<string>(); return rows.map((row) => { if (!seen.has(row.id)) { seen.add(row.id); return row; } return { ...row, id: uniqueId(`legacy-${prefix}`) }; }); };
  const seenRequestIds = new Set<string>();
  const requests = (workspace.returnRequests ?? []).map((request) => {
    if (!seenRequestIds.has(request.id)) { seenRequestIds.add(request.id); return { ...request, idempotencyKey: request.idempotencyKey ?? `legacy-${request.id}` }; }
    return { ...request, id: uniqueId('legacy-return'), idempotencyKey: `legacy-duplicate-${request.id}`, status: 'needs_review' as const, reviewBlockReason: '旧数据存在重复申请编号，无法可靠对应实际转回流水，已暂停审核。' };
  });
  return {
    ...mockWorkspace, ...workspace, schemaVersion: 2,
    members: workspace.members.map((member) => ({ ...member, initialInvestmentCents: member.initialInvestmentCents ?? member.initialDepositCents, initialPendingReturnCents: member.initialPendingReturnCents ?? 0, initialReturnedCents: member.initialReturnedCents ?? 0 })),
    rounds: dedupeIds(workspace.rounds ?? [], 'round').map((round) => round.lockedRatiosBps && Object.values(round.lockedRatiosBps).reduce((sum, ratio) => sum + ratio, 0) === 10000 ? round : { ...round, needsReviewReason: round.needsReviewReason ?? '历史场次缺少可靠的持股比例快照，已暂停参与资产计算，等待核对。' }), cashMoves: dedupeIds(workspace.cashMoves ?? [], 'cash'), fundingAdjustments: dedupeIds(workspace.fundingAdjustments ?? [], 'funding'), ratioChanges: dedupeIds(workspace.ratioChanges ?? [], 'ratio'), auditLogs: dedupeIds(workspace.auditLogs ?? [], 'audit'), returnRequests: requests, initialSetupComplete: workspace.initialSetupComplete ?? false,
    sequenceReservations: workspace.sequenceReservations ?? (workspace.rounds ?? []).reduce<Record<string, number>>((reservations, round) => ({ ...reservations, [round.scheduledDate]: Math.max(reservations[round.scheduledDate] ?? 0, round.sequence) }), {})
  };
}
const currentShanghai = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(',', '');
const effective = (date: string, now: string) => date <= now;
export const memberRatioBps = (workspace: Workspace, memberId: string, now = currentShanghai()): number => {
  const member = workspace.members.find((row) => row.id === memberId); if (!member) return 0;
  if (member.isCzh) return 10000 - workspace.members.filter((row) => !row.isCzh && row.active !== false).reduce((sum, row) => sum + memberRatioBps(workspace, row.id, now), 0);
  if (member.active === false) return 0;
  const changes = workspace.fundingAdjustments.filter((row) => row.memberId === memberId && row.type === 'NEXT_ROUND_RATIO' && effective(row.effectiveAt, now)).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id));
  return changes.at(-1)?.afterBps ?? member.ratioBps;
};
export const czhRatioBps = (workspace: Workspace, now = currentShanghai()) => memberRatioBps(workspace, 'czh', now);

const ownShare = (totalCents: number, allocations: ReturnType<typeof matchAllocations>, memberId: string) => allocateLargestRemainder(totalCents, allocations).find((row) => row.memberId === memberId)?.settlementCents ?? 0;
const matchAllocations = (workspace: Workspace, round: MatchInput) => {
  const ratios = workspace.members.map((member) => ({ memberId: member.id, ratioBps: round.lockedRatiosBps?.[member.id] ?? memberRatioBps(workspace, member.id, round.occurredAt) }));
  const stakes = allocateLargestRemainder(round.totalStakeCents, ratios.map((row) => ({ ...row, stakeCents: 0 })));
  return ratios.map((row) => ({ ...row, stakeCents: stakes.find((stake) => stake.memberId === row.memberId)!.settlementCents }));
};

/** Replays raw mock inputs, so every screen value and chart point shares one accounting path. */
export function deriveMemberDashboard(workspace: Workspace, memberId: string, now = currentShanghai()): MemberDashboard {
  const member = workspace.members.find((row) => row.id === memberId);
  if (!member) throw new Error('MEMBER_NOT_FOUND');
  let availableInvestmentCents = member.initialInvestmentCents;
  let pendingReturnCents = member.initialPendingReturnCents;
  let returnedCents = member.initialReturnedCents;
  let confirmedDepositCents = member.initialDepositCents;
  let lockedRoundCostCents = 0;
  const derived: MemberRound[] = [];

  const moves = workspace.cashMoves.filter((move) => move.memberId === memberId).slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let nextMoveIndex = 0;
  const applyMovesBefore = (time: string) => {
    while (nextMoveIndex < moves.length && moves[nextMoveIndex].occurredAt < time) {
      const move = moves[nextMoveIndex++];
      if (move.type === 'TO_PENDING') { availableInvestmentCents -= move.amountCents; pendingReturnCents += move.amountCents; }
      else { pendingReturnCents -= move.amountCents; returnedCents += move.amountCents; }
    }
  };
  const validRounds = workspace.rounds.filter((round) => round.status !== 'deleted' && !round.needsReviewReason).slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const round of validRounds) {
    applyMovesBefore(round.occurredAt);
    const allocations = matchAllocations(workspace, round);
    const ownAllocation = allocations.find((row) => row.memberId === memberId)!;
    const preTotalCents = availableInvestmentCents + pendingReturnCents;
    if (round.status === 'OPEN') {
      availableInvestmentCents -= ownAllocation.stakeCents;
      lockedRoundCostCents += ownAllocation.stakeCents;
    derived.push({ id: round.id, label: round.label, name: roundName(round), occurredAt: round.occurredAt, status: 'OPEN', preTotalCents, stakeCents: ownAllocation.stakeCents, endTotalCents: preTotalCents });
      continue;
    }
    const settled = settleRound({ stakeCents: round.totalStakeCents, resultCents: round.grossResultCents!, allocations });
    const ownSettlement = settled.allocations.find((row) => row.memberId === memberId)!;
    const ownFeeCents = ownShare(settled.feeCents, allocations, memberId);
    const ownRakeCents = ownShare(settled.managerFeeCents, allocations, memberId);
    const ownGrossResultCents = ownSettlement.settlementCents + ownFeeCents + ownRakeCents;
    const baseAvailable = availableInvestmentCents - ownAllocation.stakeCents;
    const isCzhFee = member.isCzh ? settled.managerFeeCents : 0;
    const endAvailable = baseAvailable + ownSettlement.settlementCents + isCzhFee;
    const endTotalCents = endAvailable + pendingReturnCents;
    derived.push({ id: round.id, label: round.label, name: roundName(round), occurredAt: round.occurredAt, status: 'SETTLED', preTotalCents, stakeCents: ownAllocation.stakeCents, grossResultCents: ownGrossResultCents, feeCents: ownFeeCents, rakeCents: ownRakeCents, settlementCents: ownSettlement.settlementCents + isCzhFee, assetChangeCents: ownSettlement.settlementCents + isCzhFee - ownAllocation.stakeCents, returnBps: ownAllocation.stakeCents ? Math.round((ownSettlement.settlementCents - ownAllocation.stakeCents) * 10000 / ownAllocation.stakeCents) : null, endTotalCents });
    availableInvestmentCents = endAvailable;
  }
  applyMovesBefore('9999-12-31 23:59');
  // Later funding corrections are append-only and applied after the historical replay.  This preserves
  // every settled round's own balance snapshot instead of rewriting it with today's configuration.
  workspace.fundingAdjustments.filter((row) => row.memberId === memberId && row.type !== 'OPENING_IMPORT' && effective(row.effectiveAt, now)).sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt) || a.id.localeCompare(b.id)).forEach((row) => {
    if (row.type === 'DEPOSIT') { const amount = row.amountCents ?? row.after - row.before; availableInvestmentCents += amount; confirmedDepositCents += amount; }
    if (row.type === 'TO_PENDING') { const amount = row.amountCents ?? 0; availableInvestmentCents -= amount; pendingReturnCents += amount; }
    if (row.type === 'BALANCE_CORRECTION') availableInvestmentCents += row.after - row.before;
    if (row.type === 'CAPITAL_CORRECTION') { const delta = row.after - row.before; availableInvestmentCents += delta; confirmedDepositCents += delta; }
  });
  const summary = summarizePortfolio({ availableInvestmentCents, lockedRoundCostCents, pendingReturnCents, returnedCents, confirmedDepositCents });
  return { member, rounds: derived, availableInvestmentCents, lockedRoundCostCents, pendingReturnCents, returnedCents, confirmedDepositCents, ...summary, openRounds: derived.filter((round): round is Extract<MemberRound, { status: 'OPEN' }> => round.status === 'OPEN'), updatedAt: workspace.updatedAt };
}

/** Local-only MVP state transition used by the administrator settlement form. */
export function settleMockRound(workspace: Workspace, actor: ActorContext, roundId: string, grossResultCents: number): Workspace {
  requireAdmin(workspace, actor); if (!assertCents(grossResultCents)) throw new Error('RESULT_INVALID');
  const round = requireRound(workspace, roundId); if (round.status !== 'OPEN') throw new Error('ROUND_NOT_OPEN');
  return { ...workspace, updatedAt: timestamp(), rounds: workspace.rounds.map((row) => row.id === roundId ? { ...row, status: 'SETTLED', grossResultCents } : row) };
}

const timestamp = () => currentShanghai();
const requireAdmin = (workspace: Workspace, actor: ActorContext) => {
  const memberId = actorId(actor); const actorMember = workspace.members.find((member) => member.id === memberId);
  if (!actorMember || actorMember.role !== 'ADMIN') throw new Error('FORBIDDEN');
  return actorMember;
};
const requireRound = (workspace: Workspace, roundId: string) => {
  const round = workspace.rounds.find((row) => row.id === roundId);
  if (!round) throw new Error('ROUND_NOT_FOUND');
  return round;
};
const audit = (action: Workspace['auditLogs'][number]['action'], by: string, roundId: string, reason?: string) => ({ id: uniqueId('audit'), action, actorId: by, roundId, reason, occurredAt: timestamp() });

/** Data-layer authority check; UI visibility alone is never accepted as authorization. */
export function moveRoundToTrash(workspace: Workspace, actor: ActorContext, roundId: string, deleteReason = '管理员删除'): Workspace {
  const actorMember = requireAdmin(workspace, actor); const round = requireRound(workspace, roundId);
  if (round.status === 'deleted') throw new Error('ROUND_ALREADY_DELETED');
  return { ...workspace, updatedAt: timestamp(), invalidatedSettlementRoundIds: [...new Set([...workspace.invalidatedSettlementRoundIds, roundId])], invalidatedLedgerRoundIds: [...new Set([...workspace.invalidatedLedgerRoundIds, roundId])], rounds: workspace.rounds.map((row) => row.id === roundId ? { ...row, originalStatus: row.status as ActiveRoundStatus, status: 'deleted', deletedAt: timestamp(), deletedBy: actorMember.id, deleteReason: deleteReason.trim() } : row), auditLogs: [...workspace.auditLogs, audit('ROUND_TRASHED', actorMember.id, roundId, deleteReason.trim())] };
}
export function adjustOwnRatio(workspace: Workspace, actor: ActorContext, deltaBps: number): Workspace {
  const memberId = actorId(actor); const member = workspace.members.find((row) => row.id === memberId); if (!member || member.isCzh) throw new Error('FORBIDDEN');
  const beforeBps = memberRatioBps(workspace, memberId); if (!Number.isInteger(deltaBps) || beforeBps + deltaBps < 0 || deltaBps > czhRatioBps(workspace)) throw new Error('RATIO_INVALID');
  const afterBps = beforeBps + deltaBps; const at = timestamp();
  const adjustment = { id: uniqueId('ratio-self'), memberId, type: 'NEXT_ROUND_RATIO' as const, before: beforeBps, after: afterBps, beforeBps, afterBps, actorId: memberId, reason: deltaBps > 0 ? '成员自行加仓' : '成员自行减仓', effectiveAt: at, occurredAt: at };
  return { ...workspace, fundingAdjustments: [...workspace.fundingAdjustments, adjustment], ratioChanges: [...workspace.ratioChanges, { id: uniqueId('ratio-log'), memberId, beforeBps, afterBps, deltaBps, actorId: memberId, occurredAt: at, effectiveAt: at }], updatedAt: at };
}
const requireCzh = (workspace: Workspace, actor: ActorContext) => { const memberId = actorId(actor); const actorMember = workspace.members.find((member) => member.id === memberId); if (!actorMember?.isCzh) throw new Error('FORBIDDEN'); return actorMember; };
export type OpeningFundingInput = { memberId: string; depositCents: number; investmentCents: number; ratioBps?: number };
export type FundingChangeInput = { type: 'DEPOSIT' | 'TO_PENDING' | 'BALANCE_CORRECTION' | 'NEXT_ROUND_RATIO'; amountCents?: number; targetCents?: number; targetBps?: number; reason: string; effectiveAt: string };

const assertCents = (value: number | undefined) => Number.isSafeInteger(value) && (value ?? 0) >= 0;
const nonCzhRatioTotal = (membersToCount: Member[]) => membersToCount.filter((member) => !member.isCzh).reduce((sum, member) => sum + member.ratioBps, 0);

/** One atomic opening import. It is CZH-only and creates a visible opening ledger event for every member. */
export function completeInitialFundingSetup(workspace: Workspace, actor: ActorContext, entries: OpeningFundingInput[]): Workspace {
  const czh = requireCzh(workspace, actor);
  if (workspace.initialSetupComplete || entries.length !== workspace.members.length) throw new Error('OPENING_SETUP_INVALID');
  const byMember = new Map(entries.map((entry) => [entry.memberId, entry]));
  if (byMember.size !== workspace.members.length || workspace.members.some((member) => !byMember.has(member.id))) throw new Error('OPENING_SETUP_INVALID');
  let total = 0;
  for (const member of workspace.members) {
    const entry = byMember.get(member.id)!;
    if (!assertCents(entry.depositCents) || !assertCents(entry.investmentCents) || (!member.isCzh && (!Number.isInteger(entry.ratioBps) || entry.ratioBps! < 0))) throw new Error('CONFIG_INVALID');
    if (!member.isCzh) total += entry.ratioBps!;
  }
  if (total > 10000) throw new Error('RATIO_INVALID');
  const at = timestamp();
  return {
    ...workspace, initialSetupComplete: true, updatedAt: at,
    members: workspace.members.map((member) => {
      const entry = byMember.get(member.id)!;
      return { ...member, initialDepositCents: entry.depositCents, initialInvestmentCents: entry.investmentCents, initialPendingReturnCents: 0, initialReturnedCents: 0, ratioBps: member.isCzh ? 10000 - total : entry.ratioBps! };
    }),
    fundingAdjustments: [...workspace.fundingAdjustments, ...workspace.members.map((member) => {
      const entry = byMember.get(member.id)!;
      return { id: uniqueId('opening'), memberId: member.id, type: 'OPENING_IMPORT' as const, before: 0, after: entry.investmentCents, amountCents: entry.depositCents, beforeBps: 0, afterBps: member.isCzh ? 10000 - total : entry.ratioBps!, actorId: czh.id, reason: '期初录入', effectiveAt: at, occurredAt: at };
    })]
  };
}

/** CZH-only append-only adjustment. Existing balances and settled round snapshots are never overwritten. */
export function adjustMemberFunding(workspace: Workspace, actor: ActorContext, memberId: string, input: FundingChangeInput): Workspace {
  const czh = requireCzh(workspace, actor);
  if (!workspace.initialSetupComplete || !input.reason.trim() || !input.effectiveAt) throw new Error('CONFIG_INVALID');
  const member = workspace.members.find((row) => row.id === memberId); if (!member) throw new Error('MEMBER_NOT_FOUND');
  const dashboard = deriveMemberDashboard(workspace, memberId); const at = timestamp();
  let before = 0; let after = 0; let amountCents: number | undefined; let beforeBps: number | undefined; let afterBps: number | undefined;
  if (input.type === 'DEPOSIT') { if (!assertCents(input.amountCents) || !input.amountCents) throw new Error('CONFIG_INVALID'); before = dashboard.confirmedDepositCents; after = before + input.amountCents; amountCents = input.amountCents; }
  if (input.type === 'TO_PENDING') { if (!assertCents(input.amountCents) || !input.amountCents || input.amountCents > dashboard.availableInvestmentCents) throw new Error('CONFIG_INVALID'); before = dashboard.availableInvestmentCents; after = before - input.amountCents; amountCents = input.amountCents; }
  if (input.type === 'BALANCE_CORRECTION') { if (!assertCents(input.targetCents)) throw new Error('CONFIG_INVALID'); before = dashboard.availableInvestmentCents; after = input.targetCents!; amountCents = Math.abs(after - before); }
  if (input.type === 'NEXT_ROUND_RATIO') {
    if (member.isCzh || !Number.isInteger(input.targetBps) || input.targetBps! < 0) throw new Error('RATIO_INVALID');
    const otherTotal = workspace.members.filter((row) => !row.isCzh && row.id !== memberId).reduce((sum, row) => sum + memberRatioBps(workspace, row.id), 0);
    if (otherTotal + input.targetBps! > 10000) throw new Error('RATIO_INVALID');
    before = member.ratioBps; after = input.targetBps!; beforeBps = before; afterBps = after;
  }
  const adjustment = { id: uniqueId('fund'), memberId, type: input.type, before, after, amountCents, beforeBps, afterBps, actorId: czh.id, reason: input.reason.trim(), effectiveAt: input.effectiveAt, occurredAt: at };
  const ratioChanges = input.type === 'NEXT_ROUND_RATIO' ? [...workspace.ratioChanges, { id: uniqueId('ratio-admin'), memberId, beforeBps: before, afterBps: after, deltaBps: after - before, actorId: czh.id, occurredAt: at, effectiveAt: input.effectiveAt }] : workspace.ratioChanges;
  return { ...workspace, ratioChanges, fundingAdjustments: [...workspace.fundingAdjustments, adjustment], updatedAt: at };
}

/** Simplified CZH member editor: it changes principal, display name and next-round ownership without overwriting investment returns. */
export function saveMemberSummary(workspace: Workspace, actor: ActorContext, memberId: string, input: { name: string; principalCents: number; ratioBps?: number }): Workspace {
  const czh = requireCzh(workspace, actor); const member = workspace.members.find((row) => row.id === memberId); if (!member || !input.name.trim() || !assertCents(input.principalCents)) throw new Error('CONFIG_INVALID');
  if (!member.isCzh && (!Number.isInteger(input.ratioBps) || input.ratioBps! < 0 || workspace.members.filter((row) => !row.isCzh && row.id !== memberId && row.active !== false).reduce((sum, row) => sum + memberRatioBps(workspace, row.id), 0) + input.ratioBps! > 10000)) throw new Error('RATIO_INVALID');
  const dashboard = deriveMemberDashboard(workspace, memberId); const delta = input.principalCents - dashboard.confirmedDepositCents;
  if (delta < 0 && dashboard.availableInvestmentCents < -delta) throw new Error('INSUFFICIENT_INVESTMENT');
  const at = timestamp(); const adjustments = delta === 0 ? workspace.fundingAdjustments : [...workspace.fundingAdjustments, { id: uniqueId('capital'), memberId, type: 'CAPITAL_CORRECTION' as const, before: dashboard.confirmedDepositCents, after: input.principalCents, amountCents: Math.abs(delta), actorId: czh.id, reason: '成员累计投入调整', effectiveAt: at, occurredAt: at }];
  const ratioAdjustment = !member.isCzh && input.ratioBps !== memberRatioBps(workspace, memberId) ? { id: uniqueId('ratio-summary'), memberId, type: 'NEXT_ROUND_RATIO' as const, before: memberRatioBps(workspace, memberId), after: input.ratioBps!, beforeBps: memberRatioBps(workspace, memberId), afterBps: input.ratioBps!, actorId: czh.id, reason: '成员持股比例调整', effectiveAt: at, occurredAt: at } : null;
  return { ...workspace, members: workspace.members.map((row) => row.id === memberId ? { ...row, name: input.name.trim() } : row), fundingAdjustments: ratioAdjustment ? [...adjustments, ratioAdjustment] : adjustments, updatedAt: at };
}
export function addShareholder(workspace: Workspace, actor: ActorContext): Workspace {
  requireCzh(workspace, actor); const used = new Set(workspace.members.map((member) => member.name)); let number = 1; while (used.has(`${chineseNumber(number)}号股东`)) number += 1; const id = uniqueId('member');
  return { ...workspace, members: [...workspace.members, { id, name: `${chineseNumber(number)}号股东`, role: 'MEMBER', isCzh: false, active: true, ratioBps: 0, initialDepositCents: 0, initialInvestmentCents: 0, initialPendingReturnCents: 0, initialReturnedCents: 0 }], updatedAt: timestamp() };
}
export function setShareholderActive(workspace: Workspace, actor: ActorContext, memberId: string, active: boolean): Workspace {
  requireCzh(workspace, actor); const member = workspace.members.find((row) => row.id === memberId); if (!member || member.isCzh || member.role === 'ADMIN') throw new Error('FORBIDDEN'); const dashboard = deriveMemberDashboard(workspace, memberId);
  if (!active) { if (dashboard.lockedRoundCostCents > 0) throw new Error('MEMBER_HAS_OPEN_ROUND'); if (workspace.returnRequests.some((request) => request.memberId === memberId && request.status === 'pending')) throw new Error('MEMBER_HAS_PENDING_RETURN'); if (dashboard.availableInvestmentCents > 0 || dashboard.pendingReturnCents > 0) throw new Error('MEMBER_HAS_BALANCE'); }
  const at = timestamp(); const ratioReset = active ? { id: uniqueId('ratio-restore'), memberId, type: 'NEXT_ROUND_RATIO' as const, before: memberRatioBps(workspace, memberId), after: 0, beforeBps: memberRatioBps(workspace, memberId), afterBps: 0, actorId: actorId(actor), reason: '恢复成员，比例归零', effectiveAt: at, occurredAt: at } : null;
  return { ...workspace, members: workspace.members.map((row) => row.id === memberId ? { ...row, active } : row), fundingAdjustments: ratioReset ? [...workspace.fundingAdjustments, ratioReset] : workspace.fundingAdjustments, updatedAt: at };
}

/** Compatibility entry point retained for callers created during the MVP. */
export function configureMemberFunds(workspace: Workspace, actor: ActorContext, memberId: string, input: { depositCents: number; investmentCents: number; ratioBps?: number; type: 'OPENING_IMPORT' | 'DEPOSIT' | 'TO_PENDING' | 'BALANCE_CORRECTION' | 'NEXT_ROUND_RATIO'; reason: string; effectiveAt: string }): Workspace {
  if (input.type === 'OPENING_IMPORT') return completeInitialFundingSetup(workspace, actor, workspace.members.map((member) => member.id === memberId ? { memberId, depositCents: input.depositCents, investmentCents: input.investmentCents, ratioBps: input.ratioBps } : { memberId: member.id, depositCents: member.initialDepositCents, investmentCents: member.initialInvestmentCents, ratioBps: member.isCzh ? undefined : member.ratioBps }));
  return adjustMemberFunding(workspace, actor, memberId, { type: input.type, amountCents: input.depositCents, targetCents: input.investmentCents, targetBps: input.ratioBps, reason: input.reason, effectiveAt: input.effectiveAt });
}

/** New rounds carry their exact current ratio snapshot, so future edits cannot rewrite history. */
export function createMockRound(workspace: Workspace, actor: ActorContext, scheduledDate: string, totalStakeCents = 100000): Workspace {
  requireAdmin(workspace, actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !assertCents(totalStakeCents) || totalStakeCents <= 0) throw new Error('ROUND_INVALID');
  const sequence = (workspace.sequenceReservations[scheduledDate] ?? 0) + 1;
  const snapshotAt = `${scheduledDate} 00:00:00`;
  const lockedRatiosBps = Object.fromEntries(workspace.members.map((member) => [member.id, memberRatioBps(workspace, member.id, snapshotAt)]));
  if (Object.values(lockedRatiosBps).reduce((sum, ratio) => sum + ratio, 0) !== 10000) throw new Error('RATIO_INVALID');
  for (const member of workspace.members) {
    const stakeCents = allocateLargestRemainder(totalStakeCents, Object.entries(lockedRatiosBps).map(([memberId, ratioBps]) => ({ memberId, ratioBps, stakeCents: 0 }))).find((row) => row.memberId === member.id)!.settlementCents;
    if (deriveMemberDashboard(workspace, member.id).availableInvestmentCents < stakeCents) throw new Error('INSUFFICIENT_INVESTMENT');
  }
  const id = uniqueId('round');
  return { ...workspace, rounds: [...workspace.rounds, { id, label: `${scheduledDate.slice(5)}·${sequence}`, scheduledDate, timezone: 'Asia/Shanghai', sequence, occurredAt: `${scheduledDate} 20:00:00`, totalStakeCents, status: 'OPEN', lockedRatiosBps }], sequenceReservations: { ...workspace.sequenceReservations, [scheduledDate]: sequence }, updatedAt: timestamp() };
}
export function submitReturnRequest(workspace: Workspace, actor: ActorContext, amountCents: number, idempotencyKey: string): Workspace {
  const memberId = actorId(actor); if (!idempotencyKey.trim()) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  if (workspace.returnRequests.some((request) => request.memberId === memberId && request.idempotencyKey === idempotencyKey)) return workspace;
  const dashboard = deriveMemberDashboard(workspace, memberId); const reserved = workspace.returnRequests.filter((request) => request.memberId === memberId && request.status === 'pending').reduce((sum, request) => sum + request.amountCents, 0);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > dashboard.pendingReturnCents - reserved) throw new Error('RETURN_AMOUNT_INVALID');
  return { ...workspace, updatedAt: timestamp(), returnRequests: [...workspace.returnRequests, { id: uniqueId('return'), memberId, amountCents, idempotencyKey, createdAt: timestamp(), status: 'pending' }] };
}
export function reviewReturnRequest(workspace: Workspace, actor: ActorContext, requestId: string, approved: boolean, rejectReason?: string): Workspace {
  const czh = requireCzh(workspace, actor); const request = workspace.returnRequests.find((row) => row.id === requestId);
  if (!request || request.status !== 'pending') throw new Error('REQUEST_ALREADY_REVIEWED');
  const dashboard = deriveMemberDashboard(workspace, request.memberId);
  if (approved && (request.amountCents > dashboard.pendingReturnCents || workspace.cashMoves.some((move) => move.id === `actual-${request.id}`))) throw new Error('RETURN_BALANCE_INVALID');
  const at = timestamp(); const moves = approved ? [...workspace.cashMoves, { id: `actual-${request.id}`, memberId: request.memberId, afterRoundId: 'SYSTEM', type: 'ACTUAL_RETURN' as const, amountCents: request.amountCents, occurredAt: at }] : workspace.cashMoves;
  // Both the status and the transfer entry are returned in one immutable state transition.
  return { ...workspace, updatedAt: at, cashMoves: moves, returnRequests: workspace.returnRequests.map((row) => row.id === requestId ? { ...row, status: approved ? 'approved' : 'rejected', rejectReason: approved ? undefined : rejectReason?.trim() || undefined, reviewedAt: at, reviewedBy: czh.id } : row) };
}

export function restoreRound(workspace: Workspace, actor: ActorContext, roundId: string): Workspace {
  const actorMember = requireAdmin(workspace, actor); const round = requireRound(workspace, roundId);
  if (round.status !== 'deleted') throw new Error('ROUND_NOT_DELETED');
  return { ...workspace, updatedAt: timestamp(), invalidatedSettlementRoundIds: workspace.invalidatedSettlementRoundIds.filter((id) => id !== roundId), invalidatedLedgerRoundIds: workspace.invalidatedLedgerRoundIds.filter((id) => id !== roundId), rounds: workspace.rounds.map((row) => row.id === roundId ? { ...row, status: row.originalStatus ?? 'SETTLED' } : row), auditLogs: [...workspace.auditLogs, audit('ROUND_RESTORED', actorMember.id, roundId)] };
}

export function permanentlyDeleteRound(workspace: Workspace, actor: ActorContext, roundId: string, typedName: string): Workspace {
  const actorMember = requireAdmin(workspace, actor); const round = requireRound(workspace, roundId);
  if (round.status !== 'deleted') throw new Error('ROUND_MUST_BE_IN_TRASH');
  if (typedName !== roundName(round)) throw new Error('ROUND_NAME_CONFIRMATION_REQUIRED');
  return { ...workspace, updatedAt: timestamp(), rounds: workspace.rounds.filter((row) => row.id !== roundId), invalidatedSettlementRoundIds: workspace.invalidatedSettlementRoundIds.filter((id) => id !== roundId), invalidatedLedgerRoundIds: workspace.invalidatedLedgerRoundIds.filter((id) => id !== roundId), auditLogs: [...workspace.auditLogs, audit('ROUND_PERMANENTLY_DELETED', actorMember.id, roundId)] };
}

/** Normal ledger/CSV data intentionally excludes soft-deleted round records. */
export function getNormalLedgerRounds(workspace: Workspace) {
  return workspace.rounds.filter((round) => round.status !== 'deleted');
}

/** A local demo can filter before rendering; a real deployment must repeat this filter on its server. */
export function workspaceForActor(workspace: Workspace, actor: ActorContext): Workspace {
  const memberId = actorId(actor); const member = workspace.members.find((row) => row.id === memberId); if (!member) throw new Error('FORBIDDEN');
  if (member.isCzh || member.role === 'ADMIN') return workspace;
  return { ...workspace, members: [member], cashMoves: workspace.cashMoves.filter((move) => move.memberId === memberId), returnRequests: workspace.returnRequests.filter((request) => request.memberId === memberId), fundingAdjustments: workspace.fundingAdjustments.filter((adjustment) => adjustment.memberId === memberId), ratioChanges: workspace.ratioChanges.filter((change) => change.memberId === memberId) };
}
