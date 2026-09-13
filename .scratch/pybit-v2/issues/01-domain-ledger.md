# 01 账务核心

Status: ready-for-human
Blocked by: none

## Outcome

建立 V2 纯函数账务模块，支持常规比赛、单独委托、逐股东盈利抽水、固定资金事件、动态场次编号和个人／大盘轨迹。

## Public seam

- `settleV2Round(input)`：按已确认案例返回守恒的逐人结算。
- `deriveV2Workspace(workspace)`：从期初、有效比赛和资金事件重放全部可见状态。
- `canManageRound(workspace, actorId, round)`：返回角色权限。

## Acceptance

- B1,000→B5,000、亏损、持平、单独委托均与 spec 第3节一致。
- 删除比赛后固定资金增减额不变，当天显示编号连续。
- `pnpm test -- src/v2/domain.test.ts` 通过。

## Comments

- 2026-09-11：领域纯函数和 7 个核心账务测试完成；完整测试套件通过。
