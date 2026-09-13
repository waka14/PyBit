# PYBIT V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有 PYBIT 重构为按新抽水、个人委托和固定资金事件重放的手机网页版。

**Architecture:** 新建 `src/v2/` 深模块，以 `settleV2Round` 和 `deriveV2Workspace` 为稳定接口；演示内存仓库和 Supabase 适配器共享页面与输入接口。数据库通过独立 V2 迁移准备，当前任务不应用到生产。

**Tech Stack:** React、TypeScript、Vite、Vitest、Supabase PostgreSQL/RPC、普通 CSS。

## Global Constraints

- 以 `.scratch/pybit-v2/spec.md` 为产品与账务依据。
- 金额使用整数分；比例使用基点；股东正毛盈利抽水10%；无3%手续费。
- 三位股东大盘排除 CZH；资金事件改变资产但不改变比赛收益。
- CZH／waka 管理全部比赛；普通股东仅完整管理自己的单独委托。
- 生产迁移与发布不在当前授权范围。

---

### Task 1: V2 domain module

**Files:** Create `src/v2/types.ts`, `src/v2/domain.ts`, `src/v2/domain.test.ts`; modify `CONTEXT.md`.

**Interfaces:** `settleV2Round(input: SettlementInput): V2Settlement`; `deriveV2Workspace(workspace: V2Workspace): DerivedWorkspace`; `canManageRound(workspace, actorId, round): boolean`.

- [x] 用 spec 中 B1,000→B5,000 的字面期望编写失败测试。
- [x] 运行 `pnpm test -- src/v2/domain.test.ts`，确认旧代码没有 V2 接口。
- [x] 实现整数分分配、逐股东抽水、单独委托、事件重放和动态编号。
- [x] 补亏损、持平、固定加资后删除比赛、累计收益率和权限测试，每次先红后绿。
- [x] 运行单文件测试及 `pnpm run build`。

### Task 2: Memory repository

**Files:** Create `src/v2/mock.ts`, `src/v2/repository.ts`, `src/v2/repository.test.ts`.

**Interfaces:** `V2Repository` 提供 `load/createRound/updateRound/deleteRound/adjustOwnAsset/changeOwnRatio`；`MemoryV2Repository` 是演示适配器。

- [x] 先写通过仓库接口观察的权限和完整编辑流程测试。
- [x] 实现三股东各 B1,000、各30%及 CZH B1,000 的演示工作区。
- [x] 实现比赛、资金、比例写操作；每次写入后由领域模块重放。
- [x] 运行仓库单测和构建，将 issue 02 标记完成。

### Task 3: Shared mobile application

**Files:** Create `src/v2/V2App.tsx`, `src/v2/V2Chart.tsx`, `src/v2/v2.css`; modify `src/App.tsx`.

**Interfaces:** `V2App` 只依赖 `V2Repository` 与身份信息；演示和生产适配器共用。

- [x] 先接入演示身份切换，完成底部三页和加载／错误／保存反馈。
- [x] 实现收益折线／K线、范围切换和详情；资金事件不得进入收益图。
- [x] 实现个人资产、大盘资产、分段占比、直接资产和比例编辑。
- [x] 实现统一比赛表单及按权限编辑删除，资金记录按可见范围展示。
- [x] 在 360／390／430 视口检查溢出和输入可用性，运行构建。

### Task 4: Supabase adapter and migration

**Files:** Create `src/v2/supabaseRepository.ts`, `supabase/migrations/202609110001_pybit_v2.sql`, `supabase/tests/v2-rls-smoke.sql`; modify `src/App.tsx`.

**Interfaces:** 新 RPC 为 `app_v2_screen_state/app_v2_save_round/app_v2_delete_round/app_v2_adjust_own_asset/app_v2_change_own_ratio`，适配器满足 `V2Repository`。

- [x] 在迁移中新增 V2 比赛、资金、比例和审计模型，保留旧表供迁移核对。
- [x] 用 SECURITY DEFINER RPC 原子校验角色、余额、比例和版本。
- [x] 读取模型只返回调用者可见资金记录，同时返回三股东大盘派生数据。
- [x] 编写隔离 Supabase 权限验收 SQL；当前任务不执行迁移。
- [x] 生产入口使用新适配器并保留认证、导出和登出。

### Task 5: Documentation, review, and verification

**Files:** Modify `PRODUCT.md`, `CONTEXT.md`, `supabase/README.md`, issue status files.

**Interfaces:** 文档解释已实现接口、迁移边界及验收步骤。

- [x] 更新产品事实和领域词汇，移除旧取回、进行中和3%手续费作为当前规则的描述。
- [x] 运行 `pnpm test` 与 `pnpm run build`，修复全部回归。
- [x] 按 spec 自查功能和权限覆盖，执行 code-review 的 Standards 与 Spec 审查。
- [x] 记录生产历史迁移未决项、隔离验证和回退命令。
- [x] 提交所有工作并保持工作树干净。
