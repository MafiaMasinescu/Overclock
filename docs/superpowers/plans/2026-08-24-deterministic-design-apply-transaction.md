# Deterministic Design Apply Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Design Apply preview and atomic `APPLY_DESIGN` transaction through the existing Design Mode command path.

**Architecture:** A pure Design Apply module derives one stable final-layout diff, inventory/salvage/labor/economy/downtime calculation, and typed blocked outcomes. The registered handler validates command precedence, consumes that calculation, and mutates only the command processor’s isolated candidate. No preview data is added to authoritative state and no adjacent-port graph is constructed.

**Tech Stack:** TypeScript strict mode, Vitest, Zod, existing `CommandProcessor`/`SimCore`, content-injected `ContentBundle`.

**Spec:** `C:\Users\Pinciu\.codex\attachments\fa49dd43-55aa-4cb0-8dd1-5ea98555723b\pasted-text.txt`

## Global Constraints

- Implement only Task 5.5; do not commit, push, or begin Task 5.6.
- Reuse the existing content-injected Design Mode registry and command processor.
- Keep public `APPLY_DESIGN` command fields and accepted result shape unchanged.
- Use integer microdollar arithmetic and the ADR-0002 fatal-invariant boundary.
- Preserve sequence counters and RNG; do not build an adjacent-port graph or add tick work.
- Do not edit Word documents, GDD, module content, `content/balancing.json`, or Office lock files.

---

### Task 1: Define and test the pure preview contract

**Files:**
- Create: `src/sim/design/designApplyPreview.ts`
- Create: `tests/unit/designApplyPreview.test.ts`

**Interfaces:**
- Consumes: `GameState`, `ContentBundle`, grid/route/history validators, money helpers.
- Produces: `calculateDesignApplyPreview(state, content)` plus readonly stable plain-data ready and blocked outcomes.

- [ ] **Step 1: Write failing tests** for inactive drafts, unchanged drafts, stable final-diff arrays, route-only changes, history independence, inventory netting/shortfalls, per-unit salvage, labor union charging, and downtime maximum.
- [ ] **Step 2: Run the new test file** and verify failures identify the missing preview API.
- [ ] **Step 3: Implement the minimal pure calculation** with stable IDs/definition ordering, checked microdollar arithmetic, structural invariant validation, and detached JSON-compatible results.
- [ ] **Step 4: Run the new test file** and verify it passes.

### Task 2: Register and test the atomic Apply command

**Files:**
- Modify: `src/sim/commands/contracts.ts`
- Modify: `src/sim/design/designModeCommands.ts`
- Modify: `tests/unit/designApplyTransaction.test.ts`
- Modify: existing deferred-command tests under `tests/unit/`

**Interfaces:**
- Consumes: `calculateDesignApplyPreview`, existing command candidate isolation, content-injected handler factory.
- Produces: production `APPLY_DESIGN` support and `STALE_DESIGN_PREVIEW` rejection.

- [ ] **Step 1: Write failing tests** for validation order, stale preview values, inventory mutation while drafting, credit boundary, overflow, no-change close, reset/preservation fields, detached live records, and rejection hash/RNG atomicity.
- [ ] **Step 2: Run the focused transaction test file** and verify the handler is initially unavailable or behavior is missing.
- [ ] **Step 3: Implement the handler** so it validates payload/revision, calls the shared calculation, compares accepted preview values, validates final arithmetic and credit, then commits live layout/inventory/economy/draft closure atomically.
- [ ] **Step 4: Run focused transaction and existing Design Mode regression tests** and verify they pass.

### Task 3: Prove determinism and FIFO behavior

**Files:**
- Create: `tests/determinism/designApplyDeterminism.test.ts`

**Interfaces:**
- Consumes: registered `SimCore` command stream and preview API.
- Produces: exact-100-run evidence for preview/result/hash/inventory/economy/sequence/RNG equality.

- [ ] **Step 1: Write failing deterministic and FIFO inventory-before-Apply tests.**
- [ ] **Step 2: Run them and verify they fail for the absent transaction behavior.**
- [ ] **Step 3: Complete only the shared implementation needed to make them pass.**
- [ ] **Step 4: Run the determinism file and the existing Task 5.1–5.4 determinism files.**

### Task 4: Add diagnostics and compatibility documentation

**Files:**
- Modify: `tests/performance/designMode.performance.ts`
- Create: `docs/decisions/ADR-0009_DETERMINISTIC_DESIGN_APPLY_TRANSACTION.md`
- Modify: `docs/TDD_VERTICAL_SLICE.md`
- Modify: `docs/phases/01_HEADLESS_SIMULATOR.md`
- Modify: `docs/status/PROJECT_STATUS.md`
- Modify: `content/en/common.json`
- Modify: `content/ro/common.json`

**Interfaces:**
- Consumes: the shared preview and registered handler.
- Produces: 200-sample 24x16 preview/Apply diagnostic, localization for the new rejection, and ADR/TDD/status compatibility record.

- [ ] **Step 1: Write or extend the diagnostic fixture** with valid routes, net inventory consumption, salvage, move/rotate, route change, and valid nonempty history.
- [ ] **Step 2: Run the diagnostic** and verify it reports separate preview and successful Apply distributions.
- [ ] **Step 3: Document the frozen contract** including validation order, no-change behavior, preservation, deferred functional previews, and save/replay consequences.
- [ ] **Step 4: Run content validation and documentation-targeted tests.**

### Task 5: Validate and review without committing

**Files:**
- Verify all files above; do not create a Git commit.

- [ ] **Step 1: Run focused tests, all unit and determinism suites, compatibility vectors, content validation, typecheck, lint, formatting, production build, and `corepack pnpm validate`.**
- [ ] **Step 2: Run Design Mode, routing, grid, tick, and Design Apply performance diagnostics.**
- [ ] **Step 3: Scan production code for forbidden APIs/imports and verify no preview/Apply graph construction.**
- [ ] **Step 4: Inspect complete diff, untracked files, `git diff --check`, and final status; correct all Critical or Important findings.**
