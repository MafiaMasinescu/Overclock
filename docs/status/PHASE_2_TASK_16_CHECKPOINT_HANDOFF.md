# Phase 2 Task 16 Checkpoint Handoff

Updated: 2026-09-17

## Repository boundary

- Task 16 base and current pre-checkpoint `HEAD`: `00acd280d195f23e6f0beca9560998090b117a5c`.
- The accumulated Task 16.1 through 16.4 implementation is ready to be preserved as one commit.
- The independent CP16 review was interrupted before completion because the two requested independent
  reviewer sessions exhausted their available usage.
- The project owner explicitly requested that the accumulated Task 16 implementation be committed and
  pushed now, with the incomplete checkpoint recorded here.
- This file is a handoff record, not evidence that CP16 passed. Task 17 must not treat this commit as an
  independently certified CP16 baseline until the remaining review is resumed or explicitly waived.

## Work completed before interruption

- Verified the branch was `main`, `HEAD` equalled the Task 16 base, `origin/main` matched, ahead/behind
  was `0/0`, nothing was staged, and all candidate paths belonged to Task 16.
- Read `AGENTS.md`, the complete CP16 prompt, ADR-0023, the Task 16 working status, and the persistence
  contract sections covering schemas, resource limits, codec ordering, migration, and diagnostics.
- Inspected the public schema, external-data traversal, full-state admission, codec, and migration
  boundaries.
- Started two independent read-only reviews, one for schema/admission and one for codec/migration;
  neither returned findings before the usage interruption.

## Reproduced findings that remain open

The interrupted review reproduced two contract gaps through focused tests. The temporary red tests and
partial production edits were removed before this checkpoint commit so the repository does not contain
an unfinished API migration.

1. **Codec entry paths do not compose full-state admission.**
   `encodeSaveEnvelope` accepts a structurally invalid `GameState` and accepts an
   `execution.stateHash` that does not certify the embedded state. `decodeSaveEnvelope` verifies the
   outer SHA and schema/migration shape but returns the migrated payload without invoking
   `admitGameStateForSave` or verifying `simulationContentHash` against an injected validated content
   bundle. This conflicts with the approved Task 16 decode/encode admission ordering.

2. **In-memory traversal does not count primitive values toward the global visited-value limit and
   does not apply the depth limit to primitive leaves.**
   `assertSafeExternalData([1, 2], { maxVisitedValues: 2 })` and
   `assertSafeExternalData([1], { maxDepth: 0 })` are accepted. The strict byte parser counts those
   values, so the in-memory and byte trust boundaries currently enforce different resource limits.

Both issues require regression-first correction. The intended narrow direction is to compose payload
schema parsing, simulation-content fingerprint verification, `execution.stateHash` verification, and
fresh `GameState` admission at public codec boundaries, and to count/check every traversed value before
primitive early returns. API design must preserve browser-safe validated content injection rather than
silently loading or inventing content.

## Verification evidence available before CP16

The completed Task 16 implementation reported and recorded:

- focused Task 16 schema/admission/codec/determinism tests: 35 passed;
- complete tests: 73 unit files / 1,254 tests and 15 determinism files / 23 tests passed;
- `corepack pnpm validate`: passed;
- Chromium E2E: 6/6 passed;
- production build: 848 modules;
- formatting, ESLint, strict TypeScript, content validation, `git diff --check`, forbidden-import/API,
  production-to-devtools, adjacent-port-graph, contract artifact identity, balancing/module/Word drift
  checks: passed;
- the target-host save-codec diagnostic and exact results remain recorded in
  `docs/diagnostics/PHASE_2_SAVE_CODEC.md`.

These are implementation-stage results. The interrupted CP16 session did not rerun the complete
checkpoint matrix twice, did not finish adversarial review, and did not certify the two open findings.

## Exact continuation

1. Start from the commit containing this handoff and verify local `HEAD`, `origin/main`, and remote
   `main` are identical with a clean worktree.
2. Resume the CP16 prompt in
   `docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md` rather than beginning Task 17.
3. Add focused failing tests for both open findings and verify the intended red failures.
4. Implement the narrow fixes, then rerun affected tests and the complete CP16 verification matrix.
5. Reconcile permanent ADR/TDD/phase/status documentation with the final public codec admission API.
6. Remove this handoff and `PHASE_2_TASK_16_WORKING_STATUS.md` only after CP16 is genuinely completed.
