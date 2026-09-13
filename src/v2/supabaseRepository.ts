import { getSupabaseClient } from '../auth/supabaseClient';
import { viewStateFor, type PendingMandateInput, type RoundPatch, type SaveRoundInput, type V2Repository, type V2ViewState } from './repository';
import type { V2Workspace } from './types';
import type { V2Round } from './types';

const requestId = () => globalThis.crypto.randomUUID();

const invoke = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseClient().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
};

export class SupabaseV2Repository implements V2Repository {
  async load() {
    const payload = await invoke<{ actorId: string; workspace: V2Workspace; market: V2ViewState['market'] }>('app_v2_screen_state');
    // The server returns the complete lifecycle ledger. Deriving here keeps
    // locked balances, historical chart points, and visibility rules identical
    // to the local demo while the migration is being staged.
    const derived = viewStateFor(payload.workspace, payload.actorId);
    // Keep the market projection server-side: ordinary members must get the
    // full three-shareholder curve without private mandate rows for others.
    return payload.market?.shares?.length ? { ...derived, market: payload.market } : derived;
  }

  createRound(input: SaveRoundInput) {
    return invoke<V2Round>('app_v2_save_round', {
      p_round_id: null,
      p_scheduled_date: input.scheduledDate,
      p_occurred_at: input.occurredAt ?? null,
      p_total_stake_cents: input.totalStakeCents,
      p_gross_result_cents: input.grossResultCents,
      p_game_type: input.gameType,
      p_mandate_type: input.mandateType,
      p_owner_member_id: input.ownerMemberId ?? null,
      p_expected_revision: null,
      p_idempotency_key: requestId(),
    });
  }

  updateRound(roundId: string, input: RoundPatch) {
    return invoke<V2Round>('app_v2_save_round', {
      p_round_id: roundId,
      p_scheduled_date: input.scheduledDate ?? null,
      p_occurred_at: input.occurredAt ?? null,
      p_total_stake_cents: input.totalStakeCents ?? null,
      p_gross_result_cents: input.grossResultCents ?? null,
      p_game_type: input.gameType ?? null,
      p_mandate_type: input.mandateType ?? null,
      p_owner_member_id: input.ownerMemberId ?? null,
      p_expected_revision: input.revision ?? null,
      p_idempotency_key: requestId(),
    });
  }

  createMandate(input: PendingMandateInput) {
    return invoke<V2Round>('app_v2_create_mandate', {
      p_scheduled_date: input.scheduledDate,
      p_total_stake_cents: input.totalStakeCents,
      p_game_type: input.gameType,
      p_owner_member_id: input.ownerMemberId ?? null,
      p_idempotency_key: requestId(),
    });
  }

  updatePendingMandate(roundId: string, input: PendingMandateInput, revision: number) {
    return invoke<V2Round>('app_v2_update_pending_mandate', {
      p_round_id: roundId, p_scheduled_date: input.scheduledDate, p_total_stake_cents: input.totalStakeCents,
      p_game_type: input.gameType, p_owner_member_id: input.ownerMemberId ?? null,
      p_expected_revision: revision, p_idempotency_key: requestId(),
    });
  }

  updateExecutingMandate(roundId: string, input: PendingMandateInput, revision: number) {
    return invoke<V2Round>('app_v2_update_executing_mandate', {
      p_round_id: roundId, p_scheduled_date: input.scheduledDate, p_total_stake_cents: input.totalStakeCents,
      p_game_type: input.gameType, p_owner_member_id: input.ownerMemberId ?? null,
      p_expected_revision: revision, p_idempotency_key: requestId(),
    });
  }

  cancelMandate(roundId: string, revision: number) {
    return invoke<V2Round>('app_v2_cancel_mandate', { p_round_id: roundId, p_expected_revision: revision, p_idempotency_key: requestId() });
  }

  startMandate(roundId: string, revision: number) {
    return invoke<V2Round>('app_v2_start_mandate', { p_round_id: roundId, p_expected_revision: revision, p_idempotency_key: requestId() });
  }

  settleMandate(roundId: string, grossResultCents: number, revision: number) {
    return invoke<V2Round>('app_v2_settle_mandate', { p_round_id: roundId, p_gross_result_cents: grossResultCents, p_expected_revision: revision, p_idempotency_key: requestId() });
  }

  async deleteRound(roundId: string, revision?: number) {
    if (revision === undefined) throw new Error('ROUND_REVISION_REQUIRED');
    await invoke('app_v2_delete_round', { p_round_id: roundId, p_expected_revision: revision, p_idempotency_key: requestId() });
  }

  async adjustOwnAsset(targetCents: number) {
    await invoke('app_v2_adjust_own_asset', { p_target_cents: targetCents, p_idempotency_key: requestId() });
  }

  async changeOwnRatio(afterBps: number) {
    await invoke('app_v2_change_own_ratio', { p_after_bps: afterBps, p_idempotency_key: requestId() });
  }
}
