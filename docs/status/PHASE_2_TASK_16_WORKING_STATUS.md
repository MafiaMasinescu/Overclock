# Phase 2 Task 16 Working Status

## Ownership

- Base SHA: `00acd280d195f23e6f0beca9560998090b117a5c`.
- Group: Phase 2 Task 16, persistence contract, full-state admission, codec, and migration.
- Changes are intentionally uncommitted and unstaged until the separate CP16 review.
- The supplied Phase 2 contract is stored at `docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md`.

## Completed subtasks

### 16.1 — persistence contract and schema foundations

- `SavePayloadV1` now carries `schemaVersion`, `simulationContentHash`, and the exact empty-queue
  `execution` boundary without changing `GameState` or Replay versions.
- Strict runtime schemas cover settings, local stats, execution metadata, envelope metadata, preview,
  and sanitized local reports.
- External metadata is descriptor-checked before cloning; accessors, prototypes, symbols, sparse or
  custom arrays, cycles, prototype-pollution keys, unsupported values, limits, coercion, invalid
  timestamps, and negative-zero integer values are rejected.
- Synthetic schema-0 is documented as a teaching/test input whose later migration will add zero-valued
  local stats without repairing or normalizing state.
- Focused schema tests: 9 passed.

### 16.2 — strict full-state admission

Complete. `src/save/stateAdmission.ts` performs descriptor-safe bounded input admission, exact
recursive shape checks for every current GameState branch, and fresh production-core validation with
the persisted queue sequence. It preserves historical domain validation rather than recalculating or
repairing stored results. Focused admission tests: 10 passed.

### 16.3 — canonical codec and migration

Complete. `src/save/codec.ts` provides duplicate-key-aware JSON parsing, canonical UTF-8 bytes,
SHA-256, none/gzip encoding, strict base64, bounded native decompression, cancellation checks, and
checksum-before-payload admission. `src/save/migrations.ts` provides the synthetic schema-0 to v1
copy-only migration with zero-valued local stats. Focused codec tests: 14 passed.

### 16.4 — vectors, diagnostic, and documentation

Complete. Canonical UTF-8 and SHA-256 vectors are frozen in `tests/unit/saveCodec.test.ts`; the
synthetic v0 migration is exercised directly and through the real codec. The diagnostic at
`docs/diagnostics/PHASE_2_SAVE_CODEC.md` measures encode/decode and primitive SHA/gzip paths on N/L
fixtures, reports host identity, and keeps adversarial inputs in correctness tests rather than timing
claims. Browser-native Web Crypto and Compression Streams were available on the documented Node host;
the implementation remains adapter-based for later browser integration.

## Changed paths so far

- `src/save/contracts.ts`
- `src/save/inputSafety.ts`
- `src/save/persistenceErrors.ts`
- `src/save/persistenceLimits.ts`
- `src/save/schema.ts`
- `src/save/stateAdmission.ts`
- `src/save/codec.ts`
- `src/save/migrations.ts`
- `tests/unit/saveSchema.test.ts`
- `tests/unit/saveAdmission.test.ts`
- `tests/unit/saveCodec.test.ts`
- `tests/performance/saveCodec.performance.ts`
- `tests/determinism/saveCodecDeterminism.test.ts`
- `docs/decisions/ADR-0023_DETERMINISTIC_PERSISTENCE_SCHEMA_FOUNDATIONS.md`
- `docs/diagnostics/PHASE_2_SAVE_CODEC.md`
- `docs/phases/02_CONTENT_SAVE.md`
- `docs/status/PROJECT_STATUS.md`
- `docs/TDD_VERTICAL_SLICE.md`
- `docs/status/PHASE_2_TASK_16_WORKING_STATUS.md`
- `docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md`
- `docs/superpowers/plans/2026-09-16-phase-2-task-16-persistence.md`

## Verification so far

- Focused schema tests: PASS, 9 tests.
- Focused admission tests: PASS, 8 tests.
- Focused schema, admission, codec, and save-codec determinism tests: PASS, 35 tests.
- Save-codec performance diagnostic: PASS, N/L encode, decode, SHA-256, and gzip measurements recorded.
- Strict TypeScript: PASS after performance diagnostic typing correction.
- Formatting, ESLint, content validation, production build, and `git diff --check`: PASS.
- Complete `pnpm test`: PASS, 73 unit files / 1,254 tests and 15 determinism files / 23 tests.
- Existing Chromium E2E regression suite: PASS, 6/6 Phase 0 shell tests across the four required
  viewports, canvas lifecycle, and locale switching. No save UI was added in Task 16, so no browser
  save-flow test was invented ahead of the Worker/storage tasks.
- The official suite required an extended process timeout because the repository runs files serially;
  no test timeout or project configuration was changed.
- Latest save-codec diagnostic: N encode/decode p95 `26.1752/31.3344 ms`, L report-only encode/decode
  p95 `51.1146/75.3601 ms`; raw SHA/gzip timings are recorded in the permanent diagnostic.
- The initial 240-second complete-test attempt timed out at the shell boundary and left no active test
  process; the controlled rerun completed successfully with a 600-second command limit.

## Exact next subtask

CP16 is the exact next lifecycle boundary. Preserve all accumulated Task 16 paths and do not begin
IndexedDB, Worker, UI, Phase 3, or Task 17. This working file remains uncommitted and unstaged until
the separate CP16 review.
