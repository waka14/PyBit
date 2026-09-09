import { deriveMemberDashboard, getNormalLedgerRounds, mockWorkspace, moveRoundToTrash, permanentlyDeleteRound, restoreRound } from './mock';
import type { ActorContext, MemberDashboard, Workspace } from './types';

export interface LedgerRepository { getWorkspace(): Promise<Workspace>; getMemberDashboard(memberId: string): Promise<MemberDashboard>; getNormalLedgerRounds(): Promise<Workspace['rounds']>; moveRoundToTrash(actor: ActorContext, roundId: string, reason: string): Promise<Workspace>; restoreRound(actor: ActorContext, roundId: string): Promise<Workspace>; permanentlyDeleteRound(actor: ActorContext, roundId: string, typedName: string): Promise<Workspace>; }
export const localMockRepository: LedgerRepository = {
  async getWorkspace() { return mockWorkspace; },
  async getMemberDashboard(memberId) { return deriveMemberDashboard(mockWorkspace, memberId); },
  async getNormalLedgerRounds() { return getNormalLedgerRounds(mockWorkspace); },
  async moveRoundToTrash(actor, roundId, reason) { return moveRoundToTrash(mockWorkspace, actor, roundId, reason); },
  async restoreRound(actor, roundId) { return restoreRound(mockWorkspace, actor, roundId); },
  async permanentlyDeleteRound(actor, roundId, typedName) { return permanentlyDeleteRound(mockWorkspace, actor, roundId, typedName); }
};
