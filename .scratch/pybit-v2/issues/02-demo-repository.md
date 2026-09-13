# 02 演示仓库与权限

Status: ready-for-human
Blocked by: 01-domain-ledger

## Outcome

用三位股东各 B1,000、各30%和 CZH B1,000 建立 V2 演示数据；公开仓库接口完成比赛增删改、直接资产调整和下一场比例调整。

## Acceptance

- CZH／waka 管理全部比赛；普通股东仅完整管理本人单独委托。
- 每人只能改自己的资产和比例；超额比例修改失败并保留旧值。
- 演示状态重置后稳定可复现。
- `pnpm test -- src/v2/repository.test.ts` 通过。

## Comments

- 2026-09-11：演示仓库、三股东数据、权限和 6 个仓库测试完成。
