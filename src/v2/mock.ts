import type { V2Workspace } from './types';

const ratios = { waka: 3000, one: 3000, two: 3000, czh: 1000 };

export const v2MockWorkspace: V2Workspace = {
  schemaVersion: 3,
  members: [
    { id: 'waka', name: 'waka', role: 'waka', isCzh: false, active: true, ratioBps: 3000, initialAssetCents: 100000 },
    { id: 'one', name: 'lf', role: 'member', isCzh: false, active: true, ratioBps: 3000, initialAssetCents: 100000 },
    { id: 'two', name: 'lbs', role: 'member', isCzh: false, active: true, ratioBps: 3000, initialAssetCents: 100000 },
    { id: 'czh', name: 'czh', role: 'czh', isCzh: true, active: true, ratioBps: 1000, initialAssetCents: 100000 },
  ],
  rounds: [
    { id: 'regular-loss', status: 'settled', scheduledDate: '2026-09-01', occurredAt: '2026-09-01 20:00:00', requestedAt: '2026-09-01 19:00:00', settledAt: '2026-09-01 20:00:00', totalStakeCents: 100000, grossResultCents: 80000, gameType: 'texas', mandateType: 'regular', lockedRatiosBps: ratios, createdBy: 'czh', revision: 1 },
    { id: 'regular-win', status: 'settled', scheduledDate: '2026-09-08', occurredAt: '2026-09-08 20:00:00', requestedAt: '2026-09-08 19:00:00', settledAt: '2026-09-08 20:00:00', totalStakeCents: 100000, grossResultCents: 500000, gameType: 'texas', mandateType: 'regular', lockedRatiosBps: ratios, createdBy: 'czh', revision: 1 },
    { id: 'mandate-waka', status: 'settled', scheduledDate: '2026-09-10', occurredAt: '2026-09-10 19:30:00', requestedAt: '2026-09-10 18:30:00', settledAt: '2026-09-10 19:30:00', totalStakeCents: 30000, grossResultCents: 42000, gameType: 'other', mandateType: 'individual', ownerMemberId: 'waka', createdBy: 'waka', revision: 1 },
    { id: 'mandate-lf-pending', status: 'pending', scheduledDate: '2026-09-11', occurredAt: '2026-09-11 10:00:00', requestedAt: '2026-09-11 10:00:00', totalStakeCents: 70000, gameType: 'other', mandateType: 'individual', ownerMemberId: 'one', createdBy: 'one', revision: 1 },
  ],
  capitalEvents: [],
  ratioChanges: [],
  auditLogs: [],
  updatedAt: '2026-09-10 20:00:00',
};
