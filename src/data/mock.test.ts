import { describe, expect, it } from 'vitest';
import { adjustMemberFunding, adjustOwnRatio, completeInitialFundingSetup, createMockRound, czhRatioBps, demoActor, deriveMemberDashboard, getNormalLedgerRounds, mockWorkspace, moveRoundToTrash, normalizeWorkspace, permanentlyDeleteRound, restoreRound, reviewReturnRequest, settleMockRound, submitReturnRequest, workspaceForActor } from './mock';
import type { SettledMemberRound } from './types';

const actor = demoActor;
const entries = () => mockWorkspace.members.map((member) => ({ memberId: member.id, depositCents: member.initialDepositCents, investmentCents: member.initialInvestmentCents, ratioBps: member.isCzh ? undefined : member.ratioBps }));
const configured = () => completeInitialFundingSetup(structuredClone(mockWorkspace), actor('czh'), entries());
const at = '2026-09-10 12:00:00';

describe('mock workspace acceptance projection', () => {
  it('derives eight chart fields from a single exact settlement path', () => {
    const row = deriveMemberDashboard(mockWorkspace, 'member-a', at).rounds.find((round): round is SettledMemberRound => round.id === 'r-002' && round.status === 'SETTLED');
    expect(row).toBeDefined(); const settled = row!; expect(settled.settlementCents - settled.stakeCents).toBe(settled.assetChangeCents); expect(settled.endTotalCents).toBe(settled.preTotalCents - settled.stakeCents + settled.settlementCents);
  });
  it('uses actor context for every sensitive action and rejects ordinary members', () => {
    expect(() => createMockRound(mockWorkspace, actor('member-b'), '2026-09-09')).toThrow('FORBIDDEN'); expect(() => settleMockRound(mockWorkspace, actor('member-b'), 'r-006', 100000)).toThrow('FORBIDDEN'); expect(() => moveRoundToTrash(mockWorkspace, actor('member-b'), 'r-002')).toThrow('FORBIDDEN'); expect(() => adjustMemberFunding(configured(), actor('member-a'), 'member-b', { type: 'DEPOSIT', amountCents: 1, reason: 'x', effectiveAt: at })).toThrow('FORBIDDEN');
  });
  it('supports a real create then settle lifecycle with locked allocations', () => {
    const created = createMockRound(mockWorkspace, actor('member-a'), '2026-12-31', 100001); const round = created.rounds.at(-1); expect(round?.sequence).toBe(1); expect(round?.lockedRatiosBps?.['member-a']).toBe(3500); expect(settleMockRound(created, actor('member-a'), round!.id, 120000).rounds.at(-1)?.status).toBe('SETTLED');
  });
  it('names dates and sequences in Chinese, including eleven and thirty-one', () => {
    const december = createMockRound(mockWorkspace, actor('czh'), '2027-12-31'); const decemberId = december.rounds.at(-1)!.id; expect(deriveMemberDashboard(december, 'member-a', '2028-01-01 00:00:00').rounds.find((round) => round.id === decemberId)?.name).toBe('十二月三十一日第一场'); const eleven = createMockRound(december, actor('czh'), '2027-11-11'); const elevenId = eleven.rounds.at(-1)!.id; expect(deriveMemberDashboard(eleven, 'member-a', '2028-01-01 00:00:00').rounds.find((round) => round.id === elevenId)?.name).toBe('十一月十一日第一场');
  });
  it('does not reuse same-day sequences after delete or permanent delete', () => {
    const one = createMockRound(mockWorkspace, actor('member-a'), '2026-09-09'); const removed = moveRoundToTrash(one, actor('member-a'), one.rounds.at(-1)!.id); expect(createMockRound(removed, actor('member-a'), '2026-09-09').rounds.at(-1)?.sequence).toBe(2); const purged = permanentlyDeleteRound(removed, actor('member-a'), one.rounds.at(-1)!.id, '九月九日第一场'); expect(createMockRound(purged, actor('member-a'), '2026-09-09').rounds.at(-1)?.sequence).toBe(2);
  });
  it('soft deletion excludes a round and undo restoration replays it', () => {
    const removed = moveRoundToTrash(mockWorkspace, actor('member-a'), 'r-005'); expect(deriveMemberDashboard(removed, 'member-a', at).rounds.some((round) => round.id === 'r-005')).toBe(false); expect(getNormalLedgerRounds(removed).some((round) => round.id === 'r-005')).toBe(false); expect(deriveMemberDashboard(restoreRound(removed, actor('member-a'), 'r-005'), 'member-a', at).rounds.some((round) => round.id === 'r-005')).toBe(true);
  });
  it('keeps ownership at 100%, blocks excess, and leaves locked history unchanged', () => {
    const before = deriveMemberDashboard(mockWorkspace, 'member-b', at).rounds.find((round) => round.id === 'r-002')!.stakeCents; const changed = adjustOwnRatio(mockWorkspace, actor('member-b'), 500); const effectiveAt = changed.fundingAdjustments.at(-1)!.effectiveAt; expect(czhRatioBps(changed, effectiveAt)).toBe(500); expect(() => adjustOwnRatio(changed, actor('member-b'), 10000)).toThrow('RATIO_INVALID'); expect(deriveMemberDashboard(changed, 'member-b', at).rounds.find((round) => round.id === 'r-002')!.stakeCents).toBe(before);
  });
  it('applies future funding only at its effective time', () => {
    const future = adjustMemberFunding(configured(), actor('czh'), 'member-b', { type: 'DEPOSIT', amountCents: 500, reason: '未来入金', effectiveAt: '2030-01-01 00:00:00' }); expect(deriveMemberDashboard(future, 'member-b', '2029-12-31 23:59:59').confirmedDepositCents).toBe(100000); expect(deriveMemberDashboard(future, 'member-b', '2030-01-01 00:00:00').confirmedDepositCents).toBe(100500);
  });
  it('creates opening and later adjustment records only for CZH', () => {
    const initial = configured(); expect(initial.fundingAdjustments).toHaveLength(5); expect(initial.fundingAdjustments.every((row) => row.type === 'OPENING_IMPORT' && row.actorId === 'czh')).toBe(true); expect(adjustMemberFunding(initial, actor('czh'), 'member-b', { type: 'BALANCE_CORRECTION', targetCents: 70000, reason: '余额核对', effectiveAt: at }).fundingAdjustments.at(-1)).toMatchObject({ type: 'BALANCE_CORRECTION', actorId: 'czh', reason: '余额核对', effectiveAt: at });
  });
  it('keeps two return requests independent and makes a retry idempotent', () => {
    const first = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'request-a'); const both = submitReturnRequest(first, actor('member-a'), 500, 'request-b'); expect(both.returnRequests).toHaveLength(2); expect(both.returnRequests[0]?.id).not.toBe(both.returnRequests[1]?.id); expect(submitReturnRequest(both, actor('member-a'), 500, 'request-b')).toEqual(both); const approved = reviewReturnRequest(both, actor('czh'), both.returnRequests[0]!.id, true); expect(approved.returnRequests[0]?.status).toBe('approved'); expect(approved.returnRequests[1]?.status).toBe('pending'); expect(approved.cashMoves.filter((move) => move.type === 'ACTUAL_RETURN' && move.amountCents === 500)).toHaveLength(1);
  });
  it('prevents non-CZH and duplicate review, and rejection creates no transfer', () => {
    const requested = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'review-me'); const id = requested.returnRequests[0]!.id; expect(() => reviewReturnRequest(requested, actor('member-a'), id, true)).toThrow('FORBIDDEN'); const rejected = reviewReturnRequest(requested, actor('czh'), id, false); expect(rejected.cashMoves).toHaveLength(requested.cashMoves.length); expect(() => reviewReturnRequest(rejected, actor('czh'), id, true)).toThrow('REQUEST_ALREADY_REVIEWED');
  });
  it('filters ordinary-member read data before rendering while admins keep management scope', () => {
    const memberView = workspaceForActor(mockWorkspace, actor('member-b')); expect(memberView.members).toHaveLength(1); expect(memberView.members[0]?.id).toBe('member-b'); expect(memberView.cashMoves.every((move) => move.memberId === 'member-b')).toBe(true); expect(workspaceForActor(mockWorkspace, actor('member-a')).members).toHaveLength(5);
  });
  it('migrates duplicate legacy request IDs into a review-blocked record without dropping it', () => {
    const legacy = structuredClone(mockWorkspace); legacy.returnRequests = [{ id: 'same', memberId: 'member-a', amountCents: 1, createdAt: at, idempotencyKey: 'one', status: 'pending' }, { id: 'same', memberId: 'member-a', amountCents: 1, createdAt: at, idempotencyKey: 'two', status: 'pending' }]; const migrated = normalizeWorkspace(legacy); expect(migrated.returnRequests).toHaveLength(2); expect(migrated.returnRequests[1]?.status).toBe('needs_review'); expect(migrated.returnRequests[1]?.reviewBlockReason).toContain('重复申请编号');
  });
});
