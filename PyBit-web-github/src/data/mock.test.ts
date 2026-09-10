import { describe, expect, it } from 'vitest';
import { adjustMemberFunding, completeInitialFundingSetup, confirmReturnReceipt, createMockRound, demoActor, deriveMemberDashboard, getNormalLedgerRounds, mockWorkspace, moveRoundToTrash, nextRoundShares, normalizeWorkspace, permanentlyDeleteRound, restoreRound, reviewReturnRequest, settleMockRound, submitReturnRequest, workspaceForActor } from './mock';
import type { SettledMemberRound } from './types';

const actor = demoActor;
const entries = () => mockWorkspace.members.map((member) => ({ memberId: member.id, depositCents: member.initialDepositCents, investmentCents: member.initialInvestmentCents }));
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
  it('locks balance-derived shares into new rounds with no leftover basis points', () => {
    const shares = nextRoundShares(mockWorkspace); expect(Object.values(shares).reduce((sum, value) => sum + value, 0)).toBe(10000);
    const created = createMockRound(mockWorkspace, actor('member-a'), '2026-12-31', 100001); const round = created.rounds.at(-1);
    expect(round?.sequence).toBe(1); expect(round?.lockedRatiosBps).toEqual(shares);
    expect(settleMockRound(created, actor('member-a'), round!.id, 120000).rounds.at(-1)?.status).toBe('SETTLED');
  });
  it('shrinks a member share after funds move to pending return (取回即减仓)', () => {
    const before = nextRoundShares(mockWorkspace)['member-b']!;
    const withMove = adjustMemberFunding(configured(), actor('czh'), 'member-b', { type: 'TO_PENDING', amountCents: 100000, reason: '转入待转回', effectiveAt: '2026-09-01 00:00:00' });
    const after = nextRoundShares(withMove);
    expect(after['member-b']!).toBeLessThan(before);
    expect(Object.values(after).reduce((sum, value) => sum + value, 0)).toBe(10000);
  });
  it('rejects new rounds when total available balance cannot cover the stake', () => {
    const blank = { ...structuredClone(mockWorkspace), rounds: [], cashMoves: [], sequenceReservations: {} };
    const small = completeInitialFundingSetup(blank, actor('czh'), blank.members.map((member) => ({ memberId: member.id, depositCents: 1000, investmentCents: 1000 })));
    expect(() => createMockRound(small, actor('czh'), '2026-12-31', 100000)).toThrow('INSUFFICIENT_INVESTMENT');
    const created = createMockRound(small, actor('czh'), '2026-12-31', 5000);
    expect(created.rounds.at(-1)?.lockedRatiosBps?.['member-a']).toBe(2000);
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
  it('applies future funding only at its effective time', () => {
    const future = adjustMemberFunding(configured(), actor('czh'), 'member-b', { type: 'DEPOSIT', amountCents: 500, reason: '未来入金', effectiveAt: '2030-01-01 00:00:00' }); expect(deriveMemberDashboard(future, 'member-b', '2029-12-31 23:59:59').confirmedDepositCents).toBe(100000); expect(deriveMemberDashboard(future, 'member-b', '2030-01-01 00:00:00').confirmedDepositCents).toBe(100500);
  });
  it('creates opening and later adjustment records only for CZH', () => {
    const initial = configured(); expect(initial.fundingAdjustments).toHaveLength(5); expect(initial.fundingAdjustments.every((row) => row.type === 'OPENING_IMPORT' && row.actorId === 'czh')).toBe(true); expect(adjustMemberFunding(initial, actor('czh'), 'member-b', { type: 'BALANCE_CORRECTION', targetCents: 70000, reason: '余额核对', effectiveAt: at }).fundingAdjustments.at(-1)).toMatchObject({ type: 'BALANCE_CORRECTION', actorId: 'czh', reason: '余额核对', effectiveAt: at });
  });
  it('runs the member-initiated return lifecycle with double confirmation', () => {
    const before = deriveMemberDashboard(mockWorkspace, 'member-a', at);
    const requested = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'lifecycle-1');
    expect(requested.returnRequests[0]?.status).toBe('requested');
    const held = deriveMemberDashboard(requested, 'member-a', at);
    expect(held.availableInvestmentCents).toBe(before.availableInvestmentCents - 500);
    expect(held.pendingReturnCents).toBe(before.pendingReturnCents + 500);
    const id = requested.returnRequests[0]!.id;
    expect(() => confirmReturnReceipt(requested, actor('member-a'), id)).toThrow('REQUEST_ALREADY_REVIEWED');
    const transferred = reviewReturnRequest(requested, actor('czh'), id, true);
    expect(transferred.returnRequests[0]?.status).toBe('transferred');
    const done = confirmReturnReceipt(transferred, actor('member-a'), id);
    expect(done.returnRequests[0]?.status).toBe('completed');
    const after = deriveMemberDashboard(done, 'member-a', at);
    expect(after.returnedCents).toBe(before.returnedCents + 500);
    expect(after.pendingReturnCents).toBe(before.pendingReturnCents);
    expect(after.availableInvestmentCents).toBe(before.availableInvestmentCents - 500);
  });
  it('releases locked funds back to available when czh rejects the request', () => {
    const before = deriveMemberDashboard(mockWorkspace, 'member-a', at);
    const requested = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'reject-1');
    const rejected = reviewReturnRequest(requested, actor('czh'), requested.returnRequests[0]!.id, false, '账目核对未通过');
    expect(rejected.returnRequests[0]?.status).toBe('rejected');
    expect(rejected.returnRequests[0]?.rejectReason).toBe('账目核对未通过');
    const after = deriveMemberDashboard(rejected, 'member-a', at);
    expect(after.availableInvestmentCents).toBe(before.availableInvestmentCents);
    expect(after.pendingReturnCents).toBe(before.pendingReturnCents);
  });
  it('keeps two return requests independent and makes a retry idempotent', () => {
    const first = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'request-a'); const both = submitReturnRequest(first, actor('member-a'), 500, 'request-b'); expect(both.returnRequests).toHaveLength(2); expect(both.returnRequests[0]?.id).not.toBe(both.returnRequests[1]?.id); expect(submitReturnRequest(both, actor('member-a'), 500, 'request-b')).toEqual(both); const transferred = reviewReturnRequest(both, actor('czh'), both.returnRequests[0]!.id, true); expect(transferred.returnRequests[0]?.status).toBe('transferred'); expect(transferred.returnRequests[1]?.status).toBe('requested'); expect(transferred.cashMoves.filter((move) => move.type === 'ACTUAL_RETURN' && move.amountCents === 500)).toHaveLength(1);
  });
  it('prevents non-CZH and duplicate review, and rejection creates no transfer', () => {
    const requested = submitReturnRequest(mockWorkspace, actor('member-a'), 500, 'review-me'); const id = requested.returnRequests[0]!.id; expect(() => reviewReturnRequest(requested, actor('member-a'), id, true)).toThrow('FORBIDDEN'); const rejected = reviewReturnRequest(requested, actor('czh'), id, false); expect(rejected.returnRequests[0]?.status).toBe('rejected'); expect(rejected.cashMoves.filter((move) => move.type === 'ACTUAL_RETURN' && move.memberId === 'member-a')).toHaveLength(requested.cashMoves.filter((move) => move.type === 'ACTUAL_RETURN' && move.memberId === 'member-a').length); expect(() => reviewReturnRequest(rejected, actor('czh'), id, true)).toThrow('REQUEST_ALREADY_REVIEWED');
  });
  it('filters ordinary-member read data before rendering while admins keep management scope', () => {
    const memberView = workspaceForActor(mockWorkspace, actor('member-b')); expect(memberView.members).toHaveLength(1); expect(memberView.members[0]?.id).toBe('member-b'); expect(memberView.cashMoves.every((move) => move.memberId === 'member-b')).toBe(true); expect(workspaceForActor(mockWorkspace, actor('member-a')).members).toHaveLength(5);
  });
  it('migrates duplicate legacy request IDs into a review-blocked record without dropping it', () => {
    const legacy = structuredClone(mockWorkspace); legacy.returnRequests = [{ id: 'same', memberId: 'member-a', amountCents: 1, createdAt: at, idempotencyKey: 'one', status: 'pending' as unknown as 'requested' }, { id: 'same', memberId: 'member-a', amountCents: 1, createdAt: at, idempotencyKey: 'two', status: 'pending' as unknown as 'requested' }]; const migrated = normalizeWorkspace(legacy); expect(migrated.returnRequests).toHaveLength(2); expect(migrated.returnRequests[1]?.status).toBe('needs_review'); expect(migrated.returnRequests[1]?.reviewBlockReason).toContain('重复申请编号');
  });
});
