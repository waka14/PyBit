export type V2Role = 'czh' | 'waka' | 'member';
export type GameType = 'texas' | 'other';
export type MandateType = 'regular' | 'individual';
export type MandateStatus = 'pending' | 'executing' | 'settled' | 'cancelled';

export type V2Member = {
  id: string;
  name: string;
  role: V2Role;
  isCzh: boolean;
  active: boolean;
  ratioBps: number;
  initialAssetCents: number;
};

export type V2Round = {
  id: string;
  displaySequence?: number;
  status: MandateStatus;
  scheduledDate: string;
  occurredAt: string;
  requestedAt: string;
  startedAt?: string;
  settledAt?: string;
  cancelledAt?: string;
  totalStakeCents: number;
  grossResultCents?: number;
  gameType: GameType;
  mandateType: MandateType;
  ownerMemberId?: string;
  lockedRatiosBps?: Record<string, number>;
  createdBy: string;
  revision: number;
};

export type V2CapitalEvent = {
  id: string;
  memberId: string;
  deltaCents: number;
  beforeCents: number;
  targetCents: number;
  occurredAt: string;
  actorId: string;
};

export type V2RatioChange = {
  id: string;
  memberId: string;
  beforeBps: number;
  afterBps: number;
  occurredAt: string;
  actorId: string;
};

export type V2AuditLog = {
  id: string;
  action: 'ROUND_CREATED' | 'ROUND_UPDATED' | 'ROUND_DELETED' | 'ASSET_ADJUSTED' | 'RATIO_CHANGED';
  actorId: string;
  targetId: string;
  occurredAt: string;
};

export type V2Workspace = {
  schemaVersion: 3;
  members: V2Member[];
  rounds: V2Round[];
  capitalEvents: V2CapitalEvent[];
  ratioChanges: V2RatioChange[];
  auditLogs: V2AuditLog[];
  updatedAt: string;
};

export type V2SettlementRow = {
  memberId: string;
  ratioBps: number;
  stakeCents: number;
  grossCents: number;
  rakeCents: number;
  settlementCents: number;
  netProfitCents: number;
  managerRakeIncomeCents: number;
};

export type V2Settlement = {
  feeCents: 0;
  rakeCents: number;
  rows: V2SettlementRow[];
};

export type DerivedMemberRound = V2SettlementRow & {
  roundId: string;
  name: string;
  label: string;
  occurredAt: string;
  gameType: GameType;
  mandateType: MandateType;
  preAssetCents: number;
  endAssetCents: number;
  cumulativeProfitBeforeCents: number;
  cumulativeProfitAfterCents: number;
};

export type AssetEvent = {
  id: string;
  kind: 'round' | 'capital';
  label: string;
  occurredAt: string;
  preAssetCents: number;
  endAssetCents: number;
  deltaCents: number;
  roundId?: string;
};

export type DerivedMember = {
  member: V2Member;
  currentAssetCents: number;
  availableAssetCents: number;
  lockedMandateCents: number;
  cumulativeGameProfitCents: number;
  cumulativeGameStakeCents: number;
  cumulativeReturnBps: number | null;
  managerRakeIncomeCents: number;
  rounds: DerivedMemberRound[];
  mandates: DerivedMandate[];
  assetEvents: AssetEvent[];
};

export type DerivedMandate = V2Round & {
  name: string;
  label: string;
  lockedAssetCents: number;
};

export type DerivedRound = V2Round & {
  name: string;
  label: string;
  rakeCents: number;
  rows: Array<V2SettlementRow & { preAssetCents: number; endAssetCents: number }>;
};

export type MarketShare = { memberId: string; name: string; assetCents: number; shareBps: number | null };
export type MarketBalance = { memberId: string; name: string; assetCents: number };
export type MarketEvent = {
  id: string;
  label: string;
  occurredAt: string;
  totalAssetCents: number;
  preTotalAssetCents: number;
  balances: MarketBalance[];
  source: 'capital' | 'regular' | 'individual';
};

export type DerivedWorkspace = {
  source: V2Workspace;
  members: Record<string, DerivedMember>;
  rounds: DerivedRound[];
  market: { currentTotalCents: number; shares: MarketShare[]; assetEvents: MarketEvent[] };
  commonRecord: {
    rounds: DerivedRound[];
    totalStakeCents: number;
    totalGrossCents: number;
    totalNetProfitCents: number;
  };
};
