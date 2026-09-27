# Phase 2 Closure Audit Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the two independently reproduced Phase 2 correctness defects in the closure audit and reconcile its two non-blocking API/documentation observations without weakening persistence or Unicode contracts.

**Architecture:** Reject malformed Unicode at both in-memory and strict-JSON admission boundaries before save promotion. During recovery, retain every rejected autosave sequence as damaged evidence and carry that quarantine into future autosave rotation, which rotates only verified generations so a valid post-recovery save can commit atomically and future rotations continue.

**Tech Stack:** TypeScript, Vitest, repository transaction adapters, strict save codec, Markdown documentation.

**Spec:** `C:\Users\Pinciu\Downloads\OVERCLOCK_Phase_2_Closure_Audit.md`, findings F1/F2 and §8 observations.

## Global Constraints

- Preserve lone-surrogate rejection for both object keys and string values, including trailing high surrogates.
- Do not normalize or replace malformed Unicode.
- Preserve malformed autosave records as evidence; never silently delete or count them as verified rotations.
- Keep atomic writes, revision/epoch fencing, quota/abort rollback, and exactly three verified autosave rotations.
- Do not change Phase 1 state, Replay, performance thresholds, fixtures, or accepted performance/RAM exceptions.

## Review Focus

- Trailing high, leading high, lone low, valid astral-pair, and malformed dynamic-key strings must be distinguished at both admission boundaries.
- A malformed committed autosave must not prevent a valid post-recovery autosave from committing or later rotations from progressing.
- Corrupt evidence must remain listable by sequence while verified retention stays bounded to three generations.
- TDD must no longer describe obsolete configurable autosave retention or stale benchmark trigger wording.

### Task 1: Unicode admission

**Files:**
- Modify: `src/save/inputSafety.ts`
- Modify: `src/save/codec.ts`
- Test: `tests/unit/saveSchema.test.ts`
- Test: `tests/unit/saveCodec.test.ts`

- [x] Add failing tests for trailing/leading/lone surrogate values, valid astral pairs, and malformed dynamic object keys.
- [x] Run the focused tests and confirm the trailing-high cases fail for the current implementation.
- [x] Change surrogate checks to accept only an actual low-surrogate partner and reject all other code units, including end-of-string `NaN`.
- [x] Run the focused tests and the full unit suite.

### Task 2: Corrupt autosave forward progress

**Files:**
- Modify: `src/save/repository/repository.ts`
- Test: `tests/unit/workerSavePersistence.test.ts`
- Test: `tests/e2e/workerPersistenceCorruption.spec.ts`

- [x] Add failing recovery-then-autosave tests with structurally malformed and checksum-corrupt retained generations and assert new valid captures commit.
- [x] Run them to confirm the current rotation aborts or prunes the damaged generation before the repair.
- [x] Make recovery quarantine rejected autosave sequences and make rotation skip them while retaining their keys and evidence; only verified generations participate in the three-record retention bound.
- [x] Assert repeated post-recovery rotations, sequence retention, atomic abort rollback, fencing, and manual-save independence.
- [x] Run the focused persistence suites and the complete unit/determinism gates.

### Task 3: Documentation/API reconciliation

**Files:**
- Modify: `docs/TDD_VERTICAL_SLICE.md`
- Modify: `src/save/contracts.ts`
- Test: `tests/unit/workerSavePersistence.test.ts` (recovery quarantine and contract behavior remain fixed at three verified rotations)

- [x] Replace the obsolete benchmark sentence with the accepted start/terminal transition wording.
- [x] Remove the unused legacy `SaveRepository` sketch because no consumer exists; ensure no configurable retention contract remains authoritative.
- [x] Run formatting, lint, typecheck, content validation, complete tests, and build.

### Task 4: Final verification

- [x] Run the archived F1/F2 reproduction against the repaired checkout and confirm both probes now reject/commit as intended.
- [x] Run `git diff --check`, inspect the exact diff, and report remaining browser/target-host limitations without relabelling accepted exceptions.
