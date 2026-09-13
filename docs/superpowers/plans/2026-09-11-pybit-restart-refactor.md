# PyBit Web Refactor Implementation Plan

> **For agentic workers:** Execute this plan task by task with a fresh verification pass after each task. Keep the local Markdown issue tracker and the domain glossary current as decisions are made.

**Goal:** Rebuild the PyBit web app's three real member surfaces so they are clearer, more distinctive, responsive, and safe while preserving existing accounting, authentication, authorization, Supabase, and EdgeOne behavior.

**Architecture:** Keep the existing React + Vite + TypeScript + ordinary CSS architecture. Treat `ProductionApp.tsx` as the production behavior boundary, keep the demo app on its own mock repository, and extract only presentation primitives that are shared without mixing data or permission logic. Use local HTML prototypes to settle the visual world before editing the real pages.

**Tech Stack:** React, Vite, TypeScript, ordinary CSS, Supabase JavaScript client, Vitest, Vite build, local HTML/CSS prototypes, Playwright or the available browser surface for visual verification.

## Global Constraints

- Keep the `收益 / 资产 / 账本` navigation, PYBIT name, B amount display, integer-cent storage, formulas, fees, rake, round locking, request semantics, authentication, export, logout, and role boundaries.
- Production pages live in `src/pages/ProductionApp.tsx`; demo pages remain supported and must not be the only pages changed.
- Do not change the Supabase project, schema, RLS, RPC, authentication strategy, or production deployment settings.
- Do not use real financial actions as tests and do not expose production secrets.
- Preserve production and demo data isolation.
- Validate ordinary member, `waka`, and `czh` at 360, 390, 430, and desktop widths.
- Use clear Chinese copy, readable amounts and charts, keyboard focus, loading, empty, error, disabled, and saving states.
- Do not publish to EdgeOne without a separate final user confirmation.

---

### Task 1: Establish the restart baseline

**Status:** Complete

**Files:**
- Created: `AGENTS.md`
- Created: `CONTEXT.md`
- Created: `docs/agents/issue-tracker.md`
- Created: `docs/agents/triage-labels.md`
- Created: `docs/agents/domain.md`
- Created: `docs/superpowers/plans/2026-09-11-pybit-restart-refactor.md`
- Modified: `.gitignore`

**Deliverable:** The `web` project has a local Markdown workflow, a single-context domain glossary, a Git baseline, and a reproducible Node 24.20.0 + pnpm 11.19.0 development runtime.

**Verification:**

- Git baseline exists at commit `fdc2f43`.
- `pnpm install --frozen-lockfile` completes.
- `pnpm run build` passes.
- Baseline test result is recorded as 26 passing and 1 failing. The failure is isolated to a fixed test timestamp versus a live timestamp in the ratio-adjustment test.

---

### Task 2: Produce three visual directions

**Files:**
- Create: `design-demos/pybit-direction-roll.html`
- Create: `design-demos/pybit-direction-reference.html`
- Create: `design-demos/pybit-direction-custom.html`
- Create: `design-demos/screenshots/desktop-*.png`
- Create: `design-demos/screenshots/mobile-*.png`

**What it delivers:** Three complete, comparable visual prototypes using the real PyBit information hierarchy:收益 overview, assets summary, ledger/admin view, and bottom navigation. Each prototype uses the same synthetic demo data and different layout grammar.

**Direction rules:**

- Direction 1 uses the style roll from the web style library.
- Direction 2 migrates a verified reference from a strong real-world data product or game-like accounting interface.
- Direction 3 is a custom PyBit system built from the product's own round, card, ledger, and chip metaphors.
- Use native HTML/CSS and honest synthetic data. No fake product screenshots and no decorative image assets are needed because this is a data interface.
- Include assumptions at the top of each file and make the layout genuinely different, not three color skins.
- Use readable Chinese text, amount formatting, chart labels, and mobile collapse behavior.

**Verification:** Render all three at 1440x900 and 390x844, inspect each screenshot, and stop for the user's direction choice. Do not edit production UI before the choice is recorded in `direction-approved.md`.

---

### Task 3: Record the selected design contract

**Files:**
- Create: `direction-approved.md`
- Create or modify: `DESIGN.md` after the direction is selected

**What it delivers:** A durable record of the user's selected visual direction, the exact selection wording, screenshots reviewed, typography, palette, radii, chart treatment, motion intensity, and responsive rules.

**Verification:** The file names all three prototypes and screenshots, contains the user's selection wording, and defines enough tokens for another agent to implement without guessing.

---

### Task 4: Build the shared presentation foundation

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/MetricCard.tsx`
- Modify: `src/components/Chart.tsx`
- Modify: `src/components/RoleSwitch.tsx`
- Modify: `src/components/ErrorBoundary.tsx`
- Test: existing component and page behavior through the full test suite and browser checks

**What it delivers:** One consistent presentation layer for the production and demo surfaces, including color tokens, typography, spacing, button states, focus states, panel hierarchy, chart readability, loading/empty/error treatments, and mobile layout rules.

**Implementation sequence:**

- Write a failing test or a deterministic render check for the changed behavior.
- Keep data props and permission decisions in their current owners.
- Make semantic state visible through text and styling, not color alone.
- Use one radius system and one accent family across all three pages.
- Preserve the existing chart data and selection behavior.
- Add reduced-motion behavior and keep the selected chart point legible.
- Run the focused tests, typecheck, and build before moving to page work.

**Verification:** No production or demo data path changes; all existing passing tests remain passing; keyboard focus is visible; buttons and form controls have readable contrast.

---

### Task 5: Rebuild the production收益 surface

**Files:**
- Modify: `src/pages/ProductionApp.tsx`
- Test: add or update focused UI assertions for chart mode, period selection, selected round details, empty state, and loading state

**What it delivers:** The real production收益 page makes current total assets, cumulative profit, cumulative return rate, chart mode, period filters, and eight round-detail metrics scannable on mobile and desktop.

**Verification:** The page keeps the existing formulas, B formatting, selection behavior, chart modes, and role-independent read scope. Test large values, no settled rounds, a selected round, and keyboard operation.

---

### Task 6: Rebuild the production资产 surface

**Files:**
- Modify: `src/pages/ProductionApp.tsx`
- Test: add or update focused assertions for ratio validation, withdrawal validation, pending requests, saving state, offline state, and error recovery

**What it delivers:** The real production资产 page clearly separates current investment balance, pending return, actual returned amount, next-round ratio adjustment, and the three-step return workflow.

**Verification:** Preserve the exact server actions and member scope. Check zero, negative, too-large, fractional, and saving inputs without making any real Supabase writes.

---

### Task 7: Rebuild the production账本 and admin surfaces

**Files:**
- Modify: `src/pages/ProductionApp.tsx`
- Test: add or update focused assertions for member read scope, admin controls, round creation, settlement confirmation, recycle bin, request review, and disabled state

**What it delivers:** The real production账本 page puts current round status, settled records, admin actions, withdrawal review, member management, and recycle-bin recovery in a clear order without exposing member data to ordinary members.

**Verification:** Check `member`, `waka`, and `czh` behavior separately. Preserve confirmation before settlement and permanent deletion, avoid duplicate submissions while saving, and keep export/logout reachable.

---

### Task 8: Wire the PWA update prompt safely

**Files:**
- Modify: `src/pages/ProductionApp.tsx`
- Inspect and test: `src/main.tsx`, `public/sw.js`, `src/DemoApp.tsx`
- Test: add focused update-ready behavior checks where the current test setup supports them

**What it delivers:** Production users see a non-blocking update notice when a waiting service worker is available and can activate it explicitly. The app does not force a refresh while a form is saving.

**Verification:** Check the existing `pybit-update-ready` event, waiting worker message, dismissal/activation behavior, and reduced interruption during a pending save. Keep the current DemoApp behavior intact.

---

### Task 9: Isolate and fix the baseline time-dependent test failure

**Files:**
- Modify: `src/data/mock.ts` only if dependency injection is required
- Modify: `src/data/mock.test.ts`
- Test: `src/data/mock.test.ts`

**What it delivers:** The ratio-adjustment test uses a deterministic clock or an effective date consistent with the generated adjustment, so it tests the intended rule instead of the wall clock.

**Verification:** The focused test passes repeatedly on different dates, the full suite is green, and no accounting rule changes.

---

### Task 10: Final responsive, accessibility, and packaging verification

**Files:**
- Modify only files required by verified findings
- Create: final verification notes in the local issue/spec folder

**What it delivers:** A verified production and demo build ready for the user to review before deployment.

**Verification commands:**

```sh
PATH="/Users/waka/.local/node-v24.20.0-darwin-arm64/bin:$PATH" pnpm test
PATH="/Users/waka/.local/node-v24.20.0-darwin-arm64/bin:$PATH" pnpm run build
PATH="/Users/waka/.local/node-v24.20.0-darwin-arm64/bin:$PATH" pnpm run package:production
```

Also inspect 360, 390, 430, and desktop layouts; verify `prefers-reduced-motion`; test loading, empty, error, disabled, saving, focus, chart selection, long amounts, and all three roles. Confirm the ZIP root layout before offering publication. Do not publish to EdgeOne in this plan without a final explicit user confirmation.

## Self-review notes

- The current project has a real production branch and a separate demo branch; the plan keeps them separate.
- The only baseline failure is time-dependent and has its own task.
- The plan intentionally pauses after the three visual prototypes because the visual direction is a user-owned design decision.
- No Supabase migration, RLS, RPC, authentication, or production setting work is included.
