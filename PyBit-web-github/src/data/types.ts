export type Role = 'ADMIN' | 'MEMBER';
export type ActorContext = { memberId: string; mode: 'demo' };
export type ActiveRoundStatus = 'OPEN' | 'SETTLED';
export type RoundStatus = ActiveRoundStatus | 'deleted';
export type Member = {
  id: string; name: string; role: Role; isCzh: boolean; active?: boolean;
  /** Opening values are integer cents.  Later changes are append-only funding adjustments. */
  initialDepositCents: number; initialInvestmentCents: number; initialPendingReturnCents: number; initialReturnedCents: number;
};
export type MatchInput = { id: string; label: string; scheduledDate: string; timezone: 'Asia/Shanghai'; sequence: number; occurredAt: string; totalStakeCents: number; grossResultCents?: number; status: RoundStatus; originalStatus?: ActiveRoundStatus; deletedAt?: string; deletedBy?: string; deleteReason?: string; lockedRatiosBps?: Record<string, number>; needsReviewReason?: string };
export type CashMove = { id: string; memberId: string; afterRoundId: string; type: 'TO_PENDING' | 'ACTUAL_RETURN' | 'PENDING_RELEASE'; amountCents: number; occurredAt: string };
export type AuditLog = { id: string; action: 'ROUND_TRASHED' | 'ROUND_RESTORED' | 'ROUND_PERMANENTLY_DELETED'; actorId: string; occurredAt: string; roundId: string; reason?: string };
/**
 * Member-initiated withdrawal with double confirmation: requested (funds locked) →
 * transferred (czh confirmed the outgoing transfer) → completed (member confirmed receipt).
 */
export type ReturnRequest = { id: string; memberId: string; amountCents: number; createdAt: string; idempotencyKey: string; status: 'requested' | 'transferred' | 'completed' | 'rejected' | 'needs_review'; reviewBlockReason?: string; rejectReason?: string; transferredAt?: string; transferredBy?: string; completedAt?: string; rejectedAt?: string };
export type FundingAdjustment = {
  id: string; memberId: string; type: 'OPENING_IMPORT' | 'DEPOSIT' | 'TO_PENDING' | 'BALANCE_CORRECTION' | 'CAPITAL_CORRECTION' | 'NEXT_ROUND_RATIO';
  before: number; after: number; amountCents?: number; beforeBps?: number; afterBps?: number;
  actorId: string; reason: string; effectiveAt: string; occurredAt: string;
};
export type Workspace = { schemaVersion: 2; members: Member[]; rounds: MatchInput[]; cashMoves: CashMove[]; invalidatedSettlementRoundIds: string[]; invalidatedLedgerRoundIds: string[]; auditLogs: AuditLog[]; returnRequests: ReturnRequest[]; fundingAdjustments: FundingAdjustment[]; initialSetupComplete: boolean; sequenceReservations: Record<string, number>; updatedAt: string };
type BaseMemberRound = {
  id: string; label: string; name: string; occurredAt: string; status: RoundStatus; preTotalCents: number; stakeCents: number;
};
export type SettledMemberRound = BaseMemberRound & { status: 'SETTLED'; grossResultCents: number; feeCents: number; rakeCents: number; settlementCents: number; assetChangeCents: number; returnBps: number | null; endTotalCents: number };
export type OpenMemberRound = BaseMemberRound & { status: 'OPEN'; endTotalCents: number };
export type MemberRound = SettledMemberRound | OpenMemberRound;
export type MemberDashboard = {
  member: Member; rounds: MemberRound[]; availableInvestmentCents: number; lockedRoundCostCents: number; pendingReturnCents: number;
  returnedCents: number; confirmedDepositCents: number; investmentAssetCents: number; currentTotalCents: number;
  cumulativeProfitCents: number; cumulativeReturnBps: number | null; openRounds: OpenMemberRound[]; updatedAt: string;
};
