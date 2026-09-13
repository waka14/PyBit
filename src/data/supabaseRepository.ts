import { getSupabaseClient, profileFromState, type AuthenticatedProfile } from '../auth/supabaseClient';

export type ProductionRound = {
  id: string; name: string; scheduledDate: string; sequence: number; status: 'open' | 'settled' | 'deleted'; totalStakeCents: number;
  grossResultCents: number | null; feeCents: number; rakeCents: number;
  preTotalCents?: number; endTotalCents?: number;
  myAllocation: null | { ratioBps: number; stakeCents: number; grossCents: number; feeCents: number; rakeCents: number; settlementCents: number; managerRakeIncomeCents: number };
};
export type ProductionMember = { id: string; name: string; isCzh: boolean; active: boolean; ratioBps: number; czhAvailableBps?: number; principalCents: number; investmentCents: number; availableCents: number; pendingCents: number; returnedCents?: number };
export type ProductionWithdrawal = { id: string; memberId: string; memberName: string; amountCents: number; status: 'pending' | 'completed' | 'rejected' | 'needs_review'; requestedAt: string; reviewedAt?: string; rejectReason?: string };
export type ProductionState = { profile: AuthenticatedProfile; me: ProductionMember; rounds: ProductionRound[]; withdrawalRequests: ProductionWithdrawal[]; members: ProductionMember[]; pendingCount: number };

const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const member = (value: unknown): ProductionMember => { const row = object(value); if (typeof row.id !== 'string' || typeof row.name !== 'string') throw new Error('SERVER_STATE_INVALID'); return { id: row.id, name: row.name, isCzh: row.isCzh === true, active: row.active !== false, ratioBps: number(row.ratioBps), czhAvailableBps: typeof row.czhAvailableBps === 'number' ? row.czhAvailableBps : undefined, principalCents: number(row.principalCents), investmentCents: number(row.investmentCents), availableCents: number(row.availableCents), pendingCents: number(row.pendingCents), returnedCents: number(row.returnedCents) }; };
const round = (value: unknown): ProductionRound => { const row = object(value); const allocation = row.myAllocation === null ? null : object(row.myAllocation); if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.scheduledDate !== 'string' || !['open', 'settled', 'deleted'].includes(String(row.status))) throw new Error('SERVER_STATE_INVALID'); return { id: row.id, name: row.name, scheduledDate: row.scheduledDate, sequence: number(row.sequence), status: row.status as ProductionRound['status'], totalStakeCents: number(row.totalStakeCents), grossResultCents: typeof row.grossResultCents === 'number' ? row.grossResultCents : null, feeCents: number(row.feeCents), rakeCents: number(row.rakeCents), preTotalCents: number(row.preTotalCents), endTotalCents: number(row.endTotalCents), myAllocation: allocation && typeof allocation.ratioBps === 'number' ? { ratioBps: number(allocation.ratioBps), stakeCents: number(allocation.stakeCents), grossCents: number(allocation.grossCents), feeCents: number(allocation.feeCents), rakeCents: number(allocation.rakeCents), settlementCents: number(allocation.settlementCents), managerRakeIncomeCents: number(allocation.managerRakeIncomeCents) } : null }; };
const withdrawal = (value: unknown): ProductionWithdrawal => { const row = object(value); if (typeof row.id !== 'string' || typeof row.memberId !== 'string' || typeof row.memberName !== 'string' || !['pending', 'completed', 'rejected', 'needs_review'].includes(String(row.status))) throw new Error('SERVER_STATE_INVALID'); return { id: row.id, memberId: row.memberId, memberName: row.memberName, amountCents: number(row.amountCents), status: row.status as ProductionWithdrawal['status'], requestedAt: String(row.requestedAt ?? ''), reviewedAt: typeof row.reviewedAt === 'string' ? row.reviewedAt : undefined, rejectReason: typeof row.rejectReason === 'string' ? row.rejectReason : undefined }; };

const freshKey = () => crypto.randomUUID();

/** Production transport: all writes are authenticated RPC calls, never browser-side ledger mutations. */
export class SupabaseLedgerRepository {
  async load(): Promise<ProductionState> {
    const client = getSupabaseClient(); const { data, error } = await client.rpc('app_screen_state'); if (error) throw error;
    const row = object(data); const { data: { user } } = await client.auth.getUser(); if (!user) throw new Error('SESSION_EXPIRED');
    const profile = profileFromState(data, user.id); const me = member(row.me);
    if (me.id !== profile.memberId) throw new Error('SERVER_STATE_INVALID');
    return { profile, me, rounds: Array.isArray(row.rounds) ? row.rounds.map(round) : [], withdrawalRequests: Array.isArray(row.withdrawalRequests) ? row.withdrawalRequests.map(withdrawal) : [], members: Array.isArray(row.members) ? row.members.map(member) : [], pendingCount: number(row.pendingCount) };
  }
  private async rpc(name: string, args: Record<string, unknown>) { const { error } = await getSupabaseClient().rpc(name, args); if (error) throw error; }
  createRound(scheduledDate: string, totalStakeCents: number) { return this.rpc('app_create_round', { p_scheduled_date: scheduledDate, p_total_stake_cents: totalStakeCents, p_idempotency_key: freshKey() }); }
  settleRound(roundId: string, grossResultCents: number) { return this.rpc('app_settle_round', { p_round_id: roundId, p_gross_result_cents: grossResultCents, p_idempotency_key: freshKey() }); }
  deleteRound(roundId: string) { return this.rpc('app_delete_round', { p_round_id: roundId }); }
  restoreRound(roundId: string) { return this.rpc('app_restore_round', { p_round_id: roundId }); }
  changeOwnStake(memberId: string, afterBps: number) { return this.rpc('app_change_stake', { p_member_id: memberId, p_after_bps: afterBps, p_idempotency_key: freshKey() }); }
  submitWithdrawal(amountCents: number) { return this.rpc('app_submit_withdrawal', { p_amount_cents: amountCents, p_idempotency_key: freshKey() }); }
  reviewWithdrawal(requestId: string, completed: boolean, rejectReason?: string) { return this.rpc('app_review_withdrawal', { p_request_id: requestId, p_complete: completed, p_reject_reason: rejectReason ?? null }); }
  moveToPending(memberId: string, amountCents: number) { return this.rpc('app_adjust_capital', { p_member_id: memberId, p_kind: 'to_pending', p_amount_cents: amountCents, p_reason: '转入待转回', p_idempotency_key: freshKey() }); }
  createMember(name: string) { return this.rpc('app_create_member', { p_display_name: name, p_idempotency_key: freshKey() }); }
  renameMember(memberId: string, name: string) { return this.rpc('app_rename_member', { p_member_id: memberId, p_display_name: name }); }
  setMemberPrincipal(memberId: string, targetCents: number) { return this.rpc('app_set_member_principal', { p_member_id: memberId, p_target_principal_cents: targetCents, p_idempotency_key: freshKey() }); }
  archiveMember(memberId: string) { return this.rpc('app_archive_member', { p_member_id: memberId }); }
  restoreMember(memberId: string) { return this.rpc('app_restore_member', { p_member_id: memberId }); }
}
