import { describe, expect, it } from 'vitest';
import { createV2MemoryStore, MemoryV2Repository } from './repository';
import { v2MockWorkspace } from './mock';

const repo = (actorId: string) => {
  let serial = 0;
  return new MemoryV2Repository(createV2MemoryStore(structuredClone(v2MockWorkspace)), actorId, {
    now: () => `2026-09-11 12:00:0${serial}`,
    id: (prefix) => `${prefix}-${++serial}`,
  });
};

describe('PYBIT V2 repository seam', () => {
  it('starts with exactly three B1,000 shareholders at 30% and CZH at 10%', async () => {
    const state = await repo('waka').load();
    const shareholders = state.members.filter((member) => !member.isCzh);
    expect(shareholders).toHaveLength(3);
    expect(shareholders.map((member) => [member.initialAssetCents, member.ratioBps])).toEqual([[100000, 3000], [100000, 3000], [100000, 3000]]);
    expect(state.members.find((member) => member.isCzh)?.ratioBps).toBe(1000);
  });

  it('lets a member create, edit, and cancel only their own pending mandate', async () => {
    const memberRepo = repo('one');
    const created = await memberRepo.createMandate({ scheduledDate: '2026-09-11', totalStakeCents: 20000, gameType: 'other' });
    expect(created.ownerMemberId).toBe('one');
    expect(created.status).toBe('pending');
    const updated = await memberRepo.updatePendingMandate(created.id, { scheduledDate: created.scheduledDate, totalStakeCents: 30000, gameType: 'other' }, created.revision);
    expect(updated.revision).toBe(2);
    await expect(memberRepo.updatePendingMandate('mandate-waka', { scheduledDate: '2026-09-11', totalStakeCents: 1, gameType: 'texas' }, 1)).rejects.toThrow('FORBIDDEN');
    const cancelled = await memberRepo.cancelMandate(created.id, updated.revision);
    expect(cancelled.status).toBe('cancelled');
    expect((await memberRepo.load()).rounds.some((round) => round.id === created.id)).toBe(false);
  });

  it('lets an admin start and settle a mandate, including a zero-output result', async () => {
    const store = createV2MemoryStore(structuredClone(v2MockWorkspace));
    const memberRepo = new MemoryV2Repository(store, 'one');
    const created = await memberRepo.createMandate({ scheduledDate: '2026-09-11', totalStakeCents: 20000, gameType: 'texas' });
    await expect(memberRepo.settleMandate(created.id, 0, created.revision)).rejects.toThrow('FORBIDDEN');
    const czhRepo = new MemoryV2Repository(store, 'czh');
    const started = await czhRepo.startMandate(created.id, created.revision);
    expect(started.status).toBe('executing');
    const settled = await czhRepo.settleMandate(created.id, 0, started.revision);
    expect(settled.status).toBe('settled');
    expect(settled.grossResultCents).toBe(0);
    const finalState = await memberRepo.load();
    expect(finalState.me.lockedMandateCents).toBe(70000);
    expect(finalState.me.mandates.find((mandate) => mandate.id === created.id)?.lockedAssetCents).toBe(0);
    expect(finalState.me.rounds.find((round) => round.roundId === created.id)?.netProfitCents).toBe(-20000);
  });

  it('lets only an administrator correct an executing mandate within available funds', async () => {
    const store = createV2MemoryStore(structuredClone(v2MockWorkspace));
    const memberRepo = new MemoryV2Repository(store, 'one');
    const czhRepo = new MemoryV2Repository(store, 'czh');
    const created = await memberRepo.createMandate({ scheduledDate: '2026-09-11', totalStakeCents: 20000, gameType: 'texas' });
    const started = await czhRepo.startMandate(created.id, created.revision);
    await expect(memberRepo.updateExecutingMandate(created.id, { scheduledDate: created.scheduledDate, totalStakeCents: 25000, gameType: 'other' }, started.revision)).rejects.toThrow('FORBIDDEN');
    const updated = await czhRepo.updateExecutingMandate(created.id, { scheduledDate: created.scheduledDate, totalStakeCents: 25000, gameType: 'other' }, started.revision);
    expect(updated).toMatchObject({ status: 'executing', totalStakeCents: 25000, gameType: 'other', revision: 3 });
  });

  it('rejects a stale mandate revision so only one transition wins', async () => {
    const store = createV2MemoryStore(structuredClone(v2MockWorkspace));
    const memberRepo = new MemoryV2Repository(store, 'one');
    const czhRepo = new MemoryV2Repository(store, 'czh');
    const created = await memberRepo.createMandate({ scheduledDate: '2026-09-11', totalStakeCents: 20000, gameType: 'texas' });
    await czhRepo.startMandate(created.id, created.revision);
    await expect(memberRepo.cancelMandate(created.id, created.revision)).rejects.toThrow('ROUND_VERSION_CONFLICT');
  });

  it('does not allow a new mandate or manual asset reduction to spend locked funds', async () => {
    const memberRepo = repo('one');
    const state = await memberRepo.load();
    await expect(memberRepo.createMandate({ scheduledDate: '2026-09-11', totalStakeCents: state.me.availableAssetCents + 1, gameType: 'texas' })).rejects.toThrow('ASSET_INSUFFICIENT');
    await expect(memberRepo.adjustOwnAsset(state.me.lockedMandateCents - 1)).rejects.toThrow('ASSET_BELOW_LOCKED');
  });

  it('blocks an ordinary member from regular rounds while waka manages every round', async () => {
    await expect(repo('one').createRound({ scheduledDate: '2026-09-11', totalStakeCents: 100000, grossResultCents: 100000, gameType: 'texas', mandateType: 'regular' })).rejects.toThrow('FORBIDDEN');
    const wakaRepo = repo('waka');
    const round = await wakaRepo.createRound({ scheduledDate: '2026-09-11', totalStakeCents: 100000, grossResultCents: 100000, gameType: 'texas', mandateType: 'regular' });
    expect(round.lockedRatiosBps).toEqual({ waka: 3000, one: 3000, two: 3000, czh: 1000 });
  });

  it('records a fixed delta when a member directly changes their own asset', async () => {
    const memberRepo = repo('one');
    const before = (await memberRepo.load()).me.currentAssetCents;
    await memberRepo.adjustOwnAsset(before + 100000);
    const after = await memberRepo.load();
    expect(after.me.currentAssetCents).toBe(before + 100000);
    expect(after.capitalEvents).toHaveLength(1);
    expect(after.capitalEvents[0]).toMatchObject({ memberId: 'one', deltaCents: 100000, beforeCents: before, targetCents: before + 100000 });
  });

  it('deletes a settled round without restoring a mandate lock', async () => {
    const store = createV2MemoryStore(structuredClone(v2MockWorkspace));
    const wakaRepo = new MemoryV2Repository(store, 'waka');
    const before = (await wakaRepo.load()).me.currentAssetCents;
    const round = await wakaRepo.createRound({ scheduledDate: '2026-09-11', totalStakeCents: 10000, grossResultCents: 10000, gameType: 'texas', mandateType: 'regular' });
    await wakaRepo.deleteRound(round.id, round.revision);
    const after = await wakaRepo.load();
    expect(after.rounds.some((item) => item.id === round.id)).toBe(false);
    expect(after.me.currentAssetCents).toBe(before);
    expect(after.me.lockedMandateCents).toBe(0);
  });

  it('saves a valid ratio immediately and rejects a value above the remaining share', async () => {
    const memberRepo = repo('one');
    await memberRepo.changeOwnRatio(2500);
    expect((await memberRepo.load()).me.member.ratioBps).toBe(2500);
    await expect(memberRepo.changeOwnRatio(5000)).rejects.toThrow('RATIO_EXCEEDS_REMAINDER');
    expect((await memberRepo.load()).me.member.ratioBps).toBe(2500);
  });

  it('shows CZH all capital events but keeps ordinary members on their own records', async () => {
    const store = createV2MemoryStore(structuredClone(v2MockWorkspace));
    await new MemoryV2Repository(store, 'one').adjustOwnAsset(150000);
    await new MemoryV2Repository(store, 'two').adjustOwnAsset(125000);
    expect((await new MemoryV2Repository(store, 'one').load()).capitalEvents.map((event) => event.memberId)).toEqual(['one']);
    expect((await new MemoryV2Repository(store, 'waka').load()).capitalEvents.map((event) => event.memberId)).toEqual([]);
    expect((await new MemoryV2Repository(store, 'czh').load()).capitalEvents.map((event) => event.memberId).sort()).toEqual(['one', 'two']);
  });
});
