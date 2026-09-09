import type { ProductionState } from './supabaseRepository';

/** Page-facing boundary. Demo and Supabase implementations may differ internally, never in authority rules. */
export interface AppRepository {
  load(): Promise<ProductionState>;
  createRound(scheduledDate: string, totalStakeCents: number): Promise<void>;
  settleRound(roundId: string, grossResultCents: number): Promise<void>;
  deleteRound(roundId: string): Promise<void>;
  restoreRound(roundId: string): Promise<void>;
  changeOwnStake(memberId: string, afterBps: number): Promise<void>;
  submitWithdrawal(amountCents: number): Promise<void>;
  reviewWithdrawal(requestId: string, completed: boolean, rejectReason?: string): Promise<void>;
  moveToPending(memberId: string, amountCents: number): Promise<void>;
  createMember(name: string): Promise<void>;
  renameMember(memberId: string, name: string): Promise<void>;
  setMemberPrincipal(memberId: string, targetCents: number): Promise<void>;
  archiveMember(memberId: string): Promise<void>;
  restoreMember(memberId: string): Promise<void>;
}
