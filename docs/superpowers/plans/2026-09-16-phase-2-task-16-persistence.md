# Phase 2 Task 16 Persistence Execution Plan

> For the implementation agent: use the `superpowers:executing-plans` workflow to execute this plan task-by-task with review checkpoints. Do not start the CP16 checkpoint or any later Phase 2 task in this work session.

**Goal:** Build the detached, strictly validated, deterministic save payload and codec foundation required before IndexedDB, Worker, and client integration.

**Baseline:** `00acd280d195f23e6f0beca9560998090b117a5c` (`origin/main` and remote `main`), clean at entry.

**Normative contract:** `docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md`, especially sections 8, 9, 13, 14 and prompts 16.1–16.4. Existing Phase 1 ADRs and compatibility vectors remain authoritative.

## Execution boundaries

- Implement only Task 16.1 through 16.4.
- Keep save/codec code outside `src/sim`; it may call existing pure simulator validators but must not change GameState or Replay versions.
- Validate external values before cloning; reject accessors, custom prototypes, symbols, cycles, sparse arrays, duplicate JSON keys, unsafe numeric values, and resource-limit violations.
- Preserve existing canonical state serialization/FNV hashing and all Phase 1 semantics.
- Keep wall-clock metadata, settings, local stats, checksum, compression, migrations, and preview outside deterministic GameState and Replay hashes.
- Leave all changes uncommitted and unstaged. Stop before CP16, IndexedDB, Worker, UI, or Task 17.

## Subtask order

1. **16.1 — Contract and schema foundations**
   - Extend `SavePayloadV1` additively with schema and execution metadata.
   - Define strict runtime schemas/constants/errors for envelope metadata, settings, stats, previews, and reports.
   - Add persistence ADR and working status.
   - Prove defaults, unknown-key rejection, descriptor-safe input checks, and unchanged Phase 1 state hashes.

2. **16.2 — Full-state admission and safe traversal**
   - Add bounded descriptor traversal and exact recursive admission for every current `GameState` branch, draft/history shape, and historical Blueprint/Benchmark variant.
   - Reuse existing domain validators after exact shape checks.
   - Construct and validate a fresh production `SimCore` with persisted queue sequence.
   - Add adversarial corruption/depth/count/prototype/accessor tests without recalculating history or repairing malformed input.

3. **16.3 — Canonical codec and copy-only migration**
   - Add strict duplicate-key-aware JSON byte parsing, canonical UTF-8, SHA-256, none/gzip encoding, bounded decompression, and cancellation-safe adapters.
   - Enforce decode ordering and canonical-byte equality.
   - Add the synthetic, explicitly non-historical schema v0 → v1 copy-only migration.
   - Keep all storage and import confirmation side effects deferred.

4. **16.4 — Vectors, diagnostic, and documentation**
   - Freeze independently reviewed ASCII/Romanian/Unicode canonical bytes and digests.
   - Add migration and browser-native codec coverage and complete adversarial tests.
   - Add `docs/diagnostics/PHASE_2_SAVE_CODEC.md` with N/L/A fixtures and honest timing/host reporting.
   - Finalize permanent Task 16 documentation while retaining the working status until CP16.

## Verification after each subtask

- Focused tests plus affected Phase 1 compatibility/domain tests.
- `corepack pnpm format:check`
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm content:validate`
- `corepack pnpm build`
- `git diff --check`
- simulator forbidden API/import scan.

At 16.4 also run the complete unit and determinism suites as appropriate, browser-native codec tests if available, and save-codec diagnostics. Report non-target host timing as informative. Do not weaken fixtures, limits, assertions, sample counts, or determinism repetitions.

## Handoff requirements

After each subtask update `docs/status/PHASE_2_TASK_16_WORKING_STATUS.md` with the base SHA, accumulated ownership, exact changed paths, public APIs, invariants, tests/results, risks, and the exact next subtask. Permanent docs must remain checkpoint-neutral. The final handoff must explicitly say that CP16, Task 17, Worker, IndexedDB, and Phase 3 were not started.
