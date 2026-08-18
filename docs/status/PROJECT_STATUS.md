# OVERCLOCK Project Status

Updated: 2026-08-18

## Current phase

- Phase 1: Headless Simulator.
- Completed task: deterministic foundation and final hardening pass.
- No command execution, tick pipeline, or gameplay system has started.

## Implemented foundation

- Seed validation, deterministic string-to-state conversion, and injectable/restorable Mulberry32 RNG.
- Strict canonical JSON serialization with recursive key ordering and authoritative-data rejection checks.
- Stable FNV-1a 64-bit canonical state hashing.
- Content-derived initial `GameState` factory with deterministic collection ordering.
- Recursive JSON-only type contract for design-draft payloads.
- Romanian and English localization coverage for every `*Key` emitted by the initial state.
- Determinism coverage includes 100 repeated runs plus fixed ASCII and Unicode vectors.

## Important files and public APIs

- `src/sim/rng/seededRng.ts`
  - `seedToUint32(seed): number`
  - `createSeededRng(seed): SeededRng`
  - `createSeededRngFromState(state): SeededRng`
  - `SeededRng.nextUint32()`, `nextFloat()`, and `getState()`
- `src/sim/replay/canonicalState.ts`
  - `canonicalSerialize(value): string`
  - `hashCanonicalState(state): string`
- `src/sim/core/createInitialGameState.ts`
  - `createInitialGameState({ content, seed }): GameState`
- `src/sim/core/types.ts`
  - `GameState`, `JsonValue`, and `JsonObject`

## Frozen compatibility decisions

- Seed conversion is FNV-1a 32-bit over each UTF-16 code unit, low byte then high byte.
- RNG is Mulberry32 with serialized unsigned 32-bit state.
- Published ASCII seed vector: `seedToUint32("phase-one") === 2799575867`.
- Canonical objects use locale-independent lexicographic key ordering; array element order is preserved.
- Canonical state accepts only plain objects and arrays whose prototype is exactly `Array.prototype`.
- Canonical serialization rejects cycles, sparse arrays, accessors, custom properties, class instances, non-finite numbers, and unsupported values.
- State hash is FNV-1a 64-bit over UTF-8 canonical JSON, encoded as 16 lowercase hexadecimal characters.
- Published ASCII hash vector: `hashCanonicalState({ a: 1 }) === "9c3e82dd6fcae8b1"`.
- Unicode is hashed exactly as supplied; no Unicode normalization is applied.
- These algorithms and conversions require explicit migration if changed after saves are published.

## Temporary defaults and assumptions

- New games start paused at tick `0`, speed `1`, with Simple Guidance and no active tutorial step.
- Facility name is the stable identifier `facility-alpha`.
- `creditLimitUsd` and `extractionCapacityWatts` start at `0` because content has no source fields yet.
- Starting inventory acquisition cost uses each module's current list price.
- Initial task offers and research availability are derived from validated 1946 content.

## Verification

- `corepack pnpm validate`: PASS.
- Formatting, ESLint, strict TypeScript, content validation, unit tests, and production build: PASS.
- Unit tests: 7 files, 41 tests passed.
- `git diff --check`: PASS.
- Simulator-domain forbidden API/import scan: no `Math.random`, wall-clock, browser, React, or PixiJS dependencies.

## Known risks

- FNV seed and state hashes are deterministic but non-cryptographic and have theoretical collision risk.
- Canonically equivalent Unicode strings in different normalization forms produce different seeds and hashes.
- Save checksum and migration behavior are not implemented; the TDD reserves SHA-256 for save integrity.
- Initial-state localization discovery currently follows the `*Key` property naming convention.

## Exact next task

Await approval for Phase 1 task 2: typed command queue, command receipts, command validation, and atomic rejection/commit. Do not include the 100 ms tick pipeline unless separately approved.

## Explicitly deferred

- 100 ms tick orchestration and system ordering.
- Economy, inventory transactions, tasks, and research progression.
- Grid placement, routing, power delivery, thermal simulation, and overclock behavior.
- Useful Compute, benchmarks, blueprints, replay execution, and balancing bot.
- React/Pixi integration, workers, IndexedDB, save/load, migrations, export, and import.
