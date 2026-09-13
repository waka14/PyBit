# PYBIT V2 Change Plan 2026-09-12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 PYBIT V2 上加入单独委托的待接手→执行中→已结算流程、锁定资金、常规比赛零抽水，以及新的收益／大盘／图表交互。

**Architecture:** 继续以 `src/v2/domain.ts` 为唯一账务重放边界，扩展为可处理委托生命周期、可用资产和锁定资产；`MemoryV2Repository` 与 Supabase 适配器共享同一 `V2Repository` 公共接口。页面保持单一手机壳，但把收益、资产、账本、委托表单和图表详情拆成小组件，保证本轮功能能在演示和生产共用。

**Tech Stack:** React、TypeScript、Vite、Vitest、Supabase PostgreSQL/RPC、SVG、普通 CSS。

## Global Constraints

- 常规比赛抽水恒为 B0；CZH 只取得自己的比赛份额。
- 单独委托只有正毛盈利抽 10%，亏损、持平和 0 产出不抽；无 3% 手续费。
- 委托未结算时总资产不变，只从可用金额转入锁定金额；未结算收益不进入收益统计。
- 普通股东只能发起并管理自己的待接手委托；开始执行后只能查看；CZH／waka 可接手、结算和维护全部委托。
- 生产历史重算、数据库迁移执行和正式发布不在本轮授权内。
- 所有金额使用整数分，比例使用基点；生产与演示必须调用同一领域规则。
- 继续使用本地 Markdown tracker；本轮任务写入 `.scratch/pybit-v2/issues/`，不覆盖上一轮 issue 完成记录。

---

### Task 1: Lifecycle domain and settlement rules

**Files:**
- Modify: `src/v2/types.ts`
- Modify: `src/v2/domain.ts`
- Test: `src/v2/domain.test.ts`
- Modify: `CONTEXT.md` only if a domain term changes

**Interfaces:**
- `V2Round.status: 'pending' | 'executing' | 'settled' | 'cancelled'` and optional `grossResultCents`.
- `settleV2Round({ members, round }): V2Settlement` accepts only a settled round with a known output.
- `deriveV2Workspace(workspace): DerivedWorkspace` returns settled rounds, all visible mandate lifecycle rows, each member's `currentAssetCents`, `availableAssetCents`, and `lockedMandateCents`.
- `DerivedWorkspace.commonRecord` contains only settled regular rounds and their aggregate totals.

- [ ] **Step 1: Write failing tests for the new public seam.** Add literal cases for regular B1,000→B5,000 with zero rake and B2,200 shareholder balances; individual B700→B1,400 with B70 rake; pending B700 moving B1,000 total into B300 available+B700 locked; pending output omitted; settlement releasing the lock; cancelled mandate restoring available funds with no profit; and common record excluding individual mandates.
- [ ] **Step 2: Run the domain test to verify the new cases fail.**

Run: `pnpm test -- src/v2/domain.test.ts`

Expected: FAIL because the existing round type has no lifecycle status, output is required, and current derivation has no lock/common-record fields.

- [ ] **Step 3: Implement the minimum lifecycle model.** Keep stable IDs and existing settled-round compatibility; introduce request/start/settle/cancel timestamps, a status, optional output, and derived mandate summaries. Replay events in deterministic timestamp/kind/ID order. At mandate creation, validate `availableAssetCents >= stake`; while pending/executing keep total asset unchanged and increment locked; at settlement subtract the lock and apply net profit; at cancellation release only the lock. Reject negative total or output, output-less settlement, and any stake reuse.
- [ ] **Step 4: Run the domain tests to verify they pass.**

Run: `pnpm test -- src/v2/domain.test.ts`

Expected: all domain cases pass, including exact B2,200/B6,600 regular settlement and no-rake loss/break-even cases.

- [ ] **Step 5: Commit the vertical slice.**

```bash
git add src/v2/types.ts src/v2/domain.ts src/v2/domain.test.ts CONTEXT.md
git commit -m "feat: model pybit mandate lifecycle"
```

### Task 2: Repository commands and permissions

**Files:**
- Modify: `src/v2/repository.ts`
- Modify: `src/v2/mock.ts`
- Modify: `src/v2/repository.test.ts`
- Modify: `src/v2/types.ts` if command result types are needed

**Interfaces:**
- `V2Repository.createMandate(input): Promise<V2Round>` creates a pending individual mandate with no output.
- `V2Repository.updatePendingMandate(id, input): Promise<V2Round>` edits only the owner's pending amount/type.
- `V2Repository.cancelMandate(id): Promise<void>` releases the owner's pending lock.
- `V2Repository.startMandate(id): Promise<V2Round>` is admin-only and transitions pending→executing.
- `V2Repository.settleMandate(id, grossResultCents, scheduledDate?, occurredAt?): Promise<V2Round>` is admin-only and transitions executing→settled.
- `V2Repository` retains regular create/update/delete and own asset/ratio operations.

- [ ] **Step 1: Write failing repository tests.** Cover ordinary member one creating a pending mandate without output; exact available/locked values; member one editing/cancelling it; member two being rejected; ordinary users being rejected from start/settle; admin start and settle; 0 output accepted only at settle; repeated transitions rejected; regular creation using zero rake; and a concurrent-equivalent stale revision rejected.
- [ ] **Step 2: Run the repository tests and confirm failure.**

Run: `pnpm test -- src/v2/repository.test.ts`

Expected: FAIL because the command methods and lifecycle permissions do not exist.

- [ ] **Step 3: Implement repository commands through the domain seam.** Use revision checks, preserve target ownership, and call `deriveV2Workspace` after every candidate change. `createMandate` must not accept output; `settleMandate` must require output including zero. Keep cancelled records out of effective rounds while retaining audit data in memory.
- [ ] **Step 4: Run the focused repository tests.**

Run: `pnpm test -- src/v2/repository.test.ts`

Expected: all lifecycle and permission tests pass.

- [ ] **Step 5: Commit the repository slice.**

```bash
git add src/v2/repository.ts src/v2/mock.ts src/v2/repository.test.ts src/v2/types.ts
git commit -m "feat: add mandate workflow commands"
```

### Task 3: Supabase V2 lifecycle migration and adapter seam

**Files:**
- Create: `supabase/migrations/202609120001_pybit_v2_change_plan.sql`
- Create: `supabase/tests/v2-change-plan-smoke.sql`
- Modify: `src/v2/supabaseRepository.ts`
- Modify: `supabase/V2_MIGRATION.md`

**Interfaces:**
- RPCs: `app_v2_create_mandate`, `app_v2_update_pending_mandate`, `app_v2_cancel_mandate`, `app_v2_start_mandate`, `app_v2_settle_mandate`.
- `app_v2_screen_state` returns visible mandates, available/locked fields, common regular record, historical market balances, and global settled sequence.

- [ ] **Step 1: Write failing adapter/RPC contract tests or SQL assertions.** Assert ordinary owners cannot edit after start, cannot set outputs, cannot access another member's mandate; admins can process all; lock cannot be double-spent; idempotent settle is safe; regular allocations store zero rake; and deleted settled mandates do not become pending.
- [ ] **Step 2: Verify the assertions fail against the current migration.**

Run: `pnpm test -- src/v2/repository.test.ts` and inspect `supabase/tests/v2-change-plan-smoke.sql` in a disposable database when available.

Expected: the current migration has no lifecycle columns/RPCs and the adapter has no command methods.

- [ ] **Step 3: Add the isolated migration.** Extend the V2 model with lifecycle timestamps/status and nullable result, add transactional lock/revision checks, expose only authenticated RPCs, and preserve old V1/V2 tables. Add a strict opening/role check, idempotency records, and the pre-stake available-balance check. Update the screen-state JSON so filtered ordinary views still receive global settled sequence but not private capital events.
- [ ] **Step 4: Implement the Supabase adapter and update migration instructions.** Map every command to a fresh idempotency key, reload server state after writes, and return clear error codes to the existing UI.
- [ ] **Step 5: Run build and static SQL checks.**

Run: `pnpm run build` and, if `supabase`/Postgres is installed, apply all migrations to a disposable project and run `supabase/tests/v2-change-plan-smoke.sql`. If unavailable, record the exact unavailable command in issue 10 and do not mark the DB execution check complete.

- [ ] **Step 6: Commit the server seam.**

```bash
git add src/v2/supabaseRepository.ts supabase/migrations/202609120001_pybit_v2.sql supabase/migrations/202609120001_pybit_v2_change_plan.sql supabase/tests/v2-change-plan-smoke.sql supabase/V2_MIGRATION.md
git commit -m "feat: prepare v2 mandate RPCs"
```

### Task 4: Mobile mandate flow and page information layout

**Files:**
- Modify: `src/v2/V2App.tsx`
- Modify: `src/v2/v2.css`
- Modify: `src/v2/V2DemoApp.tsx`
- Modify: `src/v2/mock.ts`

**Interfaces:**
- Shared `MandateCard`, `MandateForm`, `AdminMandateQueue`, `MemberBalanceList`, `RatioBar`, and `ErrorNotice` components remain repository-agnostic.
- `Range` becomes `'5' | '10' | 'all'`.
- Ordinary member flow never renders a result input before an admin starts the mandate.

- [ ] **Step 1: Add UI behavior tests or browser-readable acceptance hooks for pending/edit/cancel/start/settle.** Test labels and visibility through the rendered DOM: pending owner sees edit/cancel; execution owner sees read-only; admin sees queue count and action buttons; settle requires output but accepts `0`.
- [ ] **Step 2: Implement the asset-page order.** Render total asset first; render available/locked decomposition only when locked > 0; render personal asset chart; render shareholder total-asset chart followed by three current-balance rows; render independent ratio bar with CZH remainder; render personal mandate list and admin queue. Keep chart/scroll content above the fixed bottom nav.
- [ ] **Step 3: Implement the ledger workflow.** Keep settled rounds and capital events in separate views; add pending/executing mandate list without duplicating the full settled history; regular admin form requires stake/output; member mandate entry requires stake/type only. Add status copy “待接手／执行中／已结算”.
- [ ] **Step 4: Add inline error, loading, empty, disabled and success states.** Use the existing toast vocabulary but attach errors to the relevant form. Disable action buttons while saving and preserve typed values on failure.
- [ ] **Step 5: Verify the mobile UI.** Run the local Vite app and check 360/390/430 widths, long amounts, fixed nav, form focus, and role switching in the in-app browser.
- [ ] **Step 6: Commit the mobile workflow.**

```bash
git add src/v2/V2App.tsx src/v2/v2.css src/v2/V2DemoApp.tsx src/v2/mock.ts
git commit -m "feat: add mobile mandate workflow"
```

### Task 5: Earnings, common record, and chart interactions

**Files:**
- Modify: `src/v2/V2App.tsx`
- Modify: `src/v2/V2Chart.tsx`
- Modify: `src/v2/v2.css`
- Modify: `src/v2/types.ts`
- Modify: `src/v2/domain.ts`
- Modify: `src/v2/domain.test.ts`

**Interfaces:**
- `V2Chart` supports click, keyboard arrows/Enter/Space, and horizontal pointer dragging while preserving vertical scroll.
- Earnings filters are type `全部／常规／单独委托` plus `近五场／近十场／全部`.
- `V2ViewState.commonRecord` supplies settled regular rounds and aggregate values independent of personal filters.

- [ ] **Step 1: Write failing tests for statistics.** Check filtered windows use the selected type, preserve the pre-window cumulative baseline, count break-even rounds in the denominator, calculate “盈利场次占比”, split regular/individual net profit, exclude rake from member net profit twice, and keep top historical totals unchanged.
- [ ] **Step 2: Implement statistics and filters.** Add `filterRounds`, `summarizeRounds`, and common-record aggregation at the domain/view seam; do not recompute monetary settlement in React. Remove all “近三场” labels.
- [ ] **Step 3: Implement chart interaction.** Map pointer x to nearest node, call selection on drag, keep `touch-action: pan-y`, add focus-visible and keyboard selection. Clear selection whenever filtering removes the selected node. Add details for personal asset, market historical balances/source, personal earnings, common regular record, and ratio preview.
- [ ] **Step 4: Render the earnings page additions.** Add “历史累计”, selected-window record summary, earnings composition, and an independent “常规比赛共同战绩” section with its own range selector. CZH keeps explicit self-play/rake labels.
- [ ] **Step 5: Run focused tests and browser interaction checks.**

Run: `pnpm test -- src/v2/domain.test.ts src/v2/repository.test.ts`; then test tap, drag, keyboard, filter reset, and page scrolling in the browser.

- [ ] **Step 6: Commit the statistics slice.**

```bash
git add src/v2/V2App.tsx src/v2/V2Chart.tsx src/v2/v2.css src/v2/types.ts src/v2/domain.ts src/v2/domain.test.ts
git commit -m "feat: add v2 statistics and chart details"
```

### Task 6: Names, mock fixtures, documentation, and final verification

**Files:**
- Modify: `src/v2/mock.ts`
- Modify: `PRODUCT.md`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `supabase/README.md`
- Modify: `supabase/V2_MIGRATION.md`
- Create: `.scratch/pybit-v2/issues/07-change-plan.md` through `10-final-verification.md`

**Interfaces:**
- Existing member IDs remain `waka`, `one`, `two`, `czh`; display names become `waka`, `lf`, `lbs`, `czh`.
- Documentation explicitly distinguishes total asset, available asset, locked mandate asset, next-game participation ratio, shareholder total-asset curve, and common regular record.

- [ ] **Step 1: Update mock names and old guidance references.** Keep IDs and all historical relations; remove stale near-three ranges, old regular-rake examples, and the assumption that ordinary shareholders submit outputs.
- [ ] **Step 2: Add the new issue files with dependencies and acceptance results.** Leave previous issue files unchanged except for links if needed.
- [ ] **Step 3: Run all automated checks.**

Run: `pnpm test -- --run`, `pnpm run build`, `pnpm run package:production`, and `git diff --check`.

Expected: all tests pass; build and production artifact checks pass; the artifact contains no demo bundle or sensitive configuration.

- [ ] **Step 4: Run the in-app browser acceptance pass.** Verify each role’s mandate controls, 360/390/430 width, drag/keyboard chart selection, scrolling, long amounts, empty state and inline errors. Reset the temporary browser viewport before finishing.
- [ ] **Step 5: Run the Impeccable detector once over changed UI targets and record the result.**

Run: `/Users/waka/.codex/skills/impeccable/scripts/impeccable detect --json src/v2/V2App.tsx src/v2/V2Chart.tsx src/v2/v2.css`

- [ ] **Step 6: Review and commit documentation/status only after checks pass.**

```bash
git add .scratch/pybit-v2/issues docs/superpowers/plans/2026-09-12-pybit-v2-change-plan.md PRODUCT.md CONTEXT.md README.md supabase/README.md supabase/V2_MIGRATION.md src/v2/mock.ts
git commit -m "docs: record pybit change-plan verification"
```

## Self-review gaps

- The exact production member UUIDs are intentionally not invented. The migration must rename existing display names only after a disposable-project/data audit, while preserving IDs.
- Supabase execution and real-device soft-keyboard checks depend on external/local tools and must be reported separately if unavailable.
- Historical V1 reconciliation remains outside this plan; no old record is silently converted to a pending lock.
