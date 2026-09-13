import { canManageRound, deriveV2Workspace } from './domain';
import type { DerivedRound, DerivedWorkspace, GameType, MandateType, V2CapitalEvent, V2Member, V2Round, V2Workspace } from './types';

export type SaveRoundInput = {
  scheduledDate: string;
  occurredAt?: string;
  totalStakeCents: number;
  grossResultCents?: number;
  gameType: GameType;
  mandateType: MandateType;
  ownerMemberId?: string;
};

export type PendingMandateInput = {
  scheduledDate: string;
  totalStakeCents: number;
  gameType: GameType;
  ownerMemberId?: string;
};

export type RoundPatch = Partial<SaveRoundInput> & { revision?: number };

export type V2ViewState = {
  actor: V2Member;
  me: DerivedWorkspace['members'][string];
  members: V2Member[];
  rounds: DerivedRound[];
  mandates: DerivedWorkspace['members'][string]['mandates'];
  capitalEvents: V2CapitalEvent[];
  market: DerivedWorkspace['market'];
  commonRecord: DerivedWorkspace['commonRecord'];
  updatedAt: string;
};

export interface V2Repository {
  load(): Promise<V2ViewState>;
  createRound(input: SaveRoundInput): Promise<V2Round>;
  updateRound(roundId: string, input: RoundPatch): Promise<V2Round>;
  deleteRound(roundId: string, revision?: number): Promise<void>;
  createMandate(input: PendingMandateInput): Promise<V2Round>;
  updatePendingMandate(roundId: string, input: PendingMandateInput, revision: number): Promise<V2Round>;
  updateExecutingMandate(roundId: string, input: PendingMandateInput, revision: number): Promise<V2Round>;
  cancelMandate(roundId: string, revision: number): Promise<V2Round>;
  startMandate(roundId: string, revision: number): Promise<V2Round>;
  settleMandate(roundId: string, grossResultCents: number, revision: number): Promise<V2Round>;
  adjustOwnAsset(targetCents: number): Promise<void>;
  changeOwnRatio(afterBps: number): Promise<void>;
}

export type V2MemoryStore = { workspace: V2Workspace };
export const createV2MemoryStore = (workspace: V2Workspace): V2MemoryStore => ({ workspace });

type Runtime = { now: () => string; id: (prefix: string) => string };
const defaultRuntime: Runtime = {
  now: () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(',', ''),
  id: (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
};

const assertCents = (value: number | undefined, allowZero: boolean, label: string) => {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) throw new Error(`${label}_INVALID`);
};

const adminActor = (actor: V2Member) => actor.role === 'czh' || actor.role === 'waka';

export function viewStateFor(workspace: V2Workspace, actorId: string): V2ViewState {
  const actor = workspace.members.find((member) => member.id === actorId && member.active);
  if (!actor) throw new Error('ACTOR_NOT_FOUND');
  const derived = deriveV2Workspace(workspace);
  const admin = adminActor(actor);
  const rounds = derived.rounds
    .filter((round) => admin || round.mandateType === 'regular' || round.ownerMemberId === actorId)
    .map((round) => admin ? round : ({ ...round, rows: round.rows.filter((row) => row.memberId === actorId) }));
  const mandates = workspace.rounds
    .filter((round) => round.mandateType === 'individual' && (admin || round.ownerMemberId === actorId))
    .map((round) => derived.members[round.ownerMemberId ?? '']?.mandates.find((mandate) => mandate.id === round.id))
    .filter((mandate): mandate is NonNullable<typeof mandate> => Boolean(mandate));
  return {
    actor, me: derived.members[actorId], members: workspace.members.filter((member) => member.active), rounds,
    mandates, capitalEvents: workspace.capitalEvents.filter((event) => actor.role === 'czh' || event.memberId === actorId),
    market: derived.market, commonRecord: derived.commonRecord, updatedAt: workspace.updatedAt,
  };
}

export class MemoryV2Repository implements V2Repository {
  constructor(private readonly store: V2MemoryStore, private readonly actorId: string, private readonly runtime: Runtime = defaultRuntime) {}

  async load() { return viewStateFor(this.store.workspace, this.actorId); }

  async createRound(input: SaveRoundInput) {
    const workspace = this.store.workspace;
    const actor = this.actor(workspace);
    const normalized = input.mandateType === 'individual' && !input.ownerMemberId ? { ...input, ownerMemberId: actor.id } : input;
    if (normalized.mandateType === 'regular' && !adminActor(actor)) throw new Error('FORBIDDEN');
    if (normalized.mandateType === 'individual' && !adminActor(actor)) return this.createMandate(normalized);
    this.validateRoundInput(normalized);
    if (normalized.grossResultCents === undefined) throw new Error('RESULT_REQUIRED');
    const round = this.buildRound(workspace, actor, normalized, 'settled');
    this.replaceWorkspace({ ...workspace, rounds: [...workspace.rounds, round] }, 'ROUND_CREATED', round.id);
    return round;
  }

  async updateRound(roundId: string, input: RoundPatch) {
    const workspace = this.store.workspace;
    const original = this.findRound(workspace, roundId);
    const revision = input.revision;
    this.assertRevision(original, revision);
    if (revision === undefined) throw new Error('ROUND_VERSION_CONFLICT');
    const actor = this.actor(workspace);
    if (original.status === 'pending') return this.updatePendingMandate(roundId, {
      scheduledDate: input.scheduledDate ?? original.scheduledDate,
      totalStakeCents: input.totalStakeCents ?? original.totalStakeCents,
      gameType: input.gameType ?? original.gameType,
      ownerMemberId: input.ownerMemberId ?? original.ownerMemberId,
    }, revision);
    if (!adminActor(actor) || original.status !== 'settled') throw new Error('FORBIDDEN');
    const candidateInput: SaveRoundInput = {
      scheduledDate: input.scheduledDate ?? original.scheduledDate,
      occurredAt: input.occurredAt ?? original.occurredAt,
      totalStakeCents: input.totalStakeCents ?? original.totalStakeCents,
      grossResultCents: input.grossResultCents ?? original.grossResultCents,
      gameType: input.gameType ?? original.gameType,
      mandateType: input.mandateType ?? original.mandateType,
      ownerMemberId: input.ownerMemberId ?? original.ownerMemberId,
    };
    this.validateRoundInput(candidateInput);
    if (candidateInput.grossResultCents === undefined) throw new Error('RESULT_REQUIRED');
    const updated: V2Round = {
      ...original, scheduledDate: candidateInput.scheduledDate, occurredAt: candidateInput.occurredAt ?? original.occurredAt,
      totalStakeCents: candidateInput.totalStakeCents, grossResultCents: candidateInput.grossResultCents, gameType: candidateInput.gameType,
      mandateType: candidateInput.mandateType, ownerMemberId: candidateInput.mandateType === 'individual' ? candidateInput.ownerMemberId : undefined,
      lockedRatiosBps: candidateInput.mandateType === 'regular'
        ? original.mandateType === 'regular' ? original.lockedRatiosBps : this.currentRatios(workspace)
        : undefined,
      revision: original.revision + 1,
    };
    this.validateRoundInput(updated);
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((round) => round.id === roundId ? updated : round) }, 'ROUND_UPDATED', roundId);
    return updated;
  }

  async deleteRound(roundId: string, revision?: number) {
    const workspace = this.store.workspace;
    const round = this.findRound(workspace, roundId);
    if (revision !== undefined) this.assertRevision(round, revision);
    const actor = this.actor(workspace);
    if (!adminActor(actor) && !(round.mandateType === 'individual' && round.ownerMemberId === actor.id && round.status === 'pending')) throw new Error('FORBIDDEN');
    if (round.status === 'pending' || round.status === 'executing') {
      const cancelled = { ...round, status: 'cancelled' as const, cancelledAt: this.runtime.now(), revision: round.revision + 1 };
      this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((row) => row.id === roundId ? cancelled : row) }, 'ROUND_DELETED', roundId);
      return;
    }
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.filter((row) => row.id !== roundId) }, 'ROUND_DELETED', roundId);
  }

  async createMandate(input: PendingMandateInput) {
    const workspace = this.store.workspace;
    const actor = this.actor(workspace);
    this.validatePendingInput(input);
    const ownerMemberId = input.ownerMemberId ?? actor.id;
    if (actor.role === 'member' && ownerMemberId !== actor.id) throw new Error('FORBIDDEN');
    const owner = workspace.members.find((member) => member.id === ownerMemberId && member.active && !member.isCzh);
    if (!owner) throw new Error('MANDATE_OWNER_INVALID');
    const requestedAt = this.runtime.now();
    const round: V2Round = {
      id: this.runtime.id('mandate'), status: 'pending', scheduledDate: input.scheduledDate, occurredAt: requestedAt,
      requestedAt, totalStakeCents: input.totalStakeCents, gameType: input.gameType, mandateType: 'individual',
      ownerMemberId, createdBy: actor.id, revision: 1,
    };
    this.replaceWorkspace({ ...workspace, rounds: [...workspace.rounds, round] }, 'ROUND_CREATED', round.id);
    return round;
  }

  async updatePendingMandate(roundId: string, input: PendingMandateInput, revision: number) {
    const workspace = this.store.workspace;
    const original = this.findRound(workspace, roundId);
    this.assertRevision(original, revision);
    const actor = this.actor(workspace);
    if (original.status !== 'pending' || (!adminActor(actor) && original.ownerMemberId !== actor.id)) throw new Error('FORBIDDEN');
    this.validatePendingInput(input);
    const ownerMemberId = input.ownerMemberId ?? original.ownerMemberId;
    if (!ownerMemberId || (!adminActor(actor) && ownerMemberId !== actor.id)) throw new Error('FORBIDDEN');
    const owner = workspace.members.find((member) => member.id === ownerMemberId && member.active && !member.isCzh);
    if (!owner) throw new Error('MANDATE_OWNER_INVALID');
    const updated: V2Round = {
      ...original, scheduledDate: input.scheduledDate, totalStakeCents: input.totalStakeCents, gameType: input.gameType,
      ownerMemberId, revision: original.revision + 1,
    };
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((round) => round.id === roundId ? updated : round) }, 'ROUND_UPDATED', roundId);
    return updated;
  }

  async updateExecutingMandate(roundId: string, input: PendingMandateInput, revision: number) {
    const workspace = this.store.workspace;
    const original = this.findRound(workspace, roundId);
    this.assertRevision(original, revision);
    const actor = this.actor(workspace);
    if (!adminActor(actor) || original.status !== 'executing' || original.mandateType !== 'individual') throw new Error('FORBIDDEN');
    this.validatePendingInput(input);
    if (input.ownerMemberId !== undefined && input.ownerMemberId !== original.ownerMemberId) throw new Error('FORBIDDEN');
    const updated: V2Round = {
      ...original, scheduledDate: input.scheduledDate, totalStakeCents: input.totalStakeCents, gameType: input.gameType,
      revision: original.revision + 1,
    };
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((round) => round.id === roundId ? updated : round) }, 'ROUND_UPDATED', roundId);
    return updated;
  }

  async cancelMandate(roundId: string, revision: number) {
    const workspace = this.store.workspace;
    const round = this.findRound(workspace, roundId);
    this.assertRevision(round, revision);
    const actor = this.actor(workspace);
    if (round.mandateType !== 'individual' || round.status !== 'pending' || (!adminActor(actor) && round.ownerMemberId !== actor.id)) throw new Error('FORBIDDEN');
    const cancelled: V2Round = { ...round, status: 'cancelled', cancelledAt: this.runtime.now(), revision: round.revision + 1 };
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((row) => row.id === roundId ? cancelled : row) }, 'ROUND_UPDATED', roundId);
    return cancelled;
  }

  async startMandate(roundId: string, revision: number) {
    const workspace = this.store.workspace;
    const round = this.findRound(workspace, roundId);
    this.assertRevision(round, revision);
    if (!adminActor(this.actor(workspace)) || round.mandateType !== 'individual' || round.status !== 'pending') throw new Error('FORBIDDEN');
    const started: V2Round = { ...round, status: 'executing', startedAt: this.runtime.now(), revision: round.revision + 1 };
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((row) => row.id === roundId ? started : row) }, 'ROUND_UPDATED', roundId);
    return started;
  }

  async settleMandate(roundId: string, grossResultCents: number, revision: number) {
    const workspace = this.store.workspace;
    const round = this.findRound(workspace, roundId);
    this.assertRevision(round, revision);
    if (!adminActor(this.actor(workspace)) || round.mandateType !== 'individual' || round.status !== 'executing') throw new Error('FORBIDDEN');
    assertCents(grossResultCents, true, 'RESULT');
    const settledAt = this.runtime.now();
    const settled: V2Round = { ...round, status: 'settled', grossResultCents, settledAt, occurredAt: settledAt, revision: round.revision + 1 };
    this.replaceWorkspace({ ...workspace, rounds: workspace.rounds.map((row) => row.id === roundId ? settled : row) }, 'ROUND_UPDATED', roundId);
    return settled;
  }

  async adjustOwnAsset(targetCents: number) {
    assertCents(targetCents, true, 'ASSET');
    const workspace = this.store.workspace;
    const actor = this.actor(workspace);
    const state = viewStateFor(workspace, actor.id);
    if (targetCents < state.me.lockedMandateCents) throw new Error('ASSET_BELOW_LOCKED');
    const deltaCents = targetCents - state.me.currentAssetCents;
    if (deltaCents === 0) return;
    const occurredAt = this.runtime.now();
    const event: V2CapitalEvent = {
      id: this.runtime.id('capital'), memberId: actor.id, deltaCents,
      beforeCents: state.me.currentAssetCents, targetCents, occurredAt, actorId: actor.id,
    };
    this.replaceWorkspace({ ...workspace, capitalEvents: [...workspace.capitalEvents, event] }, 'ASSET_ADJUSTED', event.id);
  }

  async changeOwnRatio(afterBps: number) {
    if (!Number.isInteger(afterBps) || afterBps < 0 || afterBps > 10000) throw new Error('RATIO_INVALID');
    const workspace = this.store.workspace;
    const actor = this.actor(workspace);
    if (actor.isCzh) throw new Error('FORBIDDEN');
    const otherTotal = workspace.members.filter((member) => member.active && !member.isCzh && member.id !== actor.id).reduce((sum, member) => sum + member.ratioBps, 0);
    if (otherTotal + afterBps > 10000) throw new Error('RATIO_EXCEEDS_REMAINDER');
    const occurredAt = this.runtime.now();
    const czhBps = 10000 - otherTotal - afterBps;
    const members = workspace.members.map((member) => member.id === actor.id ? { ...member, ratioBps: afterBps } : member.isCzh ? { ...member, ratioBps: czhBps } : member);
    const change = { id: this.runtime.id('ratio'), memberId: actor.id, beforeBps: actor.ratioBps, afterBps, occurredAt, actorId: actor.id };
    this.replaceWorkspace({ ...workspace, members, ratioChanges: [...workspace.ratioChanges, change] }, 'RATIO_CHANGED', change.id);
  }

  private actor(workspace: V2Workspace) {
    const actor = workspace.members.find((member) => member.id === this.actorId && member.active);
    if (!actor) throw new Error('ACTOR_NOT_FOUND');
    return actor;
  }

  private findRound(workspace: V2Workspace, id: string) {
    const round = workspace.rounds.find((row) => row.id === id);
    if (!round) throw new Error('ROUND_NOT_FOUND');
    return round;
  }

  private assertRevision(round: V2Round, revision: number | undefined) {
    if (!Number.isInteger(revision) || revision !== round.revision) throw new Error('ROUND_VERSION_CONFLICT');
  }

  private validatePendingInput(input: PendingMandateInput) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) throw new Error('DATE_INVALID');
    assertCents(input.totalStakeCents, false, 'STAKE');
    if (!['texas', 'other'].includes(input.gameType)) throw new Error('ROUND_TYPE_INVALID');
  }

  private validateRoundInput(input: SaveRoundInput) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) throw new Error('DATE_INVALID');
    assertCents(input.totalStakeCents, false, 'STAKE');
    if (input.grossResultCents !== undefined) assertCents(input.grossResultCents, true, 'RESULT');
    if (!['texas', 'other'].includes(input.gameType) || !['regular', 'individual'].includes(input.mandateType)) throw new Error('ROUND_TYPE_INVALID');
    if (input.mandateType === 'individual' && !input.ownerMemberId) throw new Error('MANDATE_OWNER_REQUIRED');
  }

  private buildRound(workspace: V2Workspace, actor: V2Member, input: SaveRoundInput, status: 'settled'): V2Round {
    const occurredAt = input.occurredAt ?? `${input.scheduledDate} ${this.runtime.now().slice(11)}`;
    return {
      id: this.runtime.id('round'), status, scheduledDate: input.scheduledDate, occurredAt, requestedAt: occurredAt,
      settledAt: occurredAt, totalStakeCents: input.totalStakeCents, grossResultCents: input.grossResultCents,
      gameType: input.gameType, mandateType: input.mandateType, ownerMemberId: input.mandateType === 'individual' ? input.ownerMemberId : undefined,
      lockedRatiosBps: input.mandateType === 'regular' ? this.currentRatios(workspace) : undefined,
      createdBy: actor.id, revision: 1,
    };
  }

  private currentRatios(workspace: V2Workspace) {
    return Object.fromEntries(workspace.members.filter((member) => member.active).map((member) => [member.id, member.ratioBps]));
  }

  private replaceWorkspace(candidate: V2Workspace, action: V2Workspace['auditLogs'][number]['action'], targetId: string) {
    deriveV2Workspace(candidate);
    const occurredAt = this.runtime.now();
    this.store.workspace = {
      ...candidate, updatedAt: occurredAt,
      auditLogs: [...candidate.auditLogs, { id: this.runtime.id('audit'), action, actorId: this.actorId, targetId, occurredAt }],
    };
  }
}
