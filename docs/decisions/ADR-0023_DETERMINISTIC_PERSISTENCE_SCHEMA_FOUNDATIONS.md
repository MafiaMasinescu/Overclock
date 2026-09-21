# ADR-0023: Deterministic Persistence Schema Foundations

## Status

Accepted for Phase 2 Task 16. It defines the detached pre-durable schema and codec boundary; it does
not implement storage, Worker transport, import confirmation, or UI.

## Context

Phase 1 owns the deterministic `GameState`, its FNV-1a canonical state hash, Replay protocol, RNG,
fixed tick semantics, and all gameplay validators. Phase 2 needs a separate persistence schema that can
carry a detached state across a browser boundary without adding wall-clock metadata or transport state
to authoritative simulation.

The pre-Phase-2 `SavePayloadV1` type was only a sketch. It omitted the persistence schema version,
simulation-content fingerprint, queue boundary metadata, and exact settings/statistics contracts.

## Decision

`SavePayloadV1` is refined additively with the exact fields:

```text
schemaVersion: 1
saveVersion: 1
contentVersion
simulationContentHash
createdAtIso
savedAtIso
slotId
gameState
execution
settings
localStats
```

`execution` is exactly:

```text
simulatorProtocolVersion: 1
nextQueueSequence: nonnegative safe integer
pendingCommandCount: 0
stateHash: 16 lowercase hexadecimal characters
```

The payload's `saveVersion` and `contentVersion` must equal the embedded `GameState` values. The
execution state hash is the existing deterministic FNV hash, while the outer envelope later uses
SHA-256 over canonical UTF-8 bytes. Neither checksum changes Phase 1 hashing or Replay protocol.

Settings, local statistics, previews, reports, and persistence errors have strict runtime schemas.
Unknown keys, coercion, invalid ranges, invalid UTC timestamps, negative-zero sequence values, and
descriptor-unsafe external data are rejected before cloning. Returned parsed values are detached and
owned by the persistence boundary.

The synthetic schema-version 0 fixture is a teaching/test format only. It has a complete Phase 1
state and execution boundary but omits `localStats`; the later migration registry supplies zero-valued
stats and changes only the outer schema version. It is not a claim that Phase 1 released schema-0 saves.

Wall-clock timestamps, persistence slot IDs, settings, local stats, checksums, compression metadata,
epochs, request sequences, and preview tokens never enter `GameState` or Replay hashes. No state shape,
`saveVersion`, `contentVersion`, balancing value, module value, or Phase 1 compatibility vector is
changed by this ADR.

## Consequences

- External input can be rejected without invoking getters or trusting structured clone as validation.
- Future codecs can enforce resource limits before expensive parsing and hashing.
- A durable save can be tied to an empty command queue and a verifiable deterministic state hash.
- IndexedDB, migrations, Worker lifecycle, save capture, and UI confirmation remain separate tasks.
- Existing consumers of `SaveRepository` must be updated additively when those tasks become active.

## Task 16 implementation notes

Full-state admission uses descriptor-safe traversal followed by exact recursive shape checks for every
current `GameState` branch and the existing Phase 1 validators. A fresh production `SimCore` validates
the admitted state and captured queue sequence. Historical Benchmark, Blueprint, Replay, and Campaign
data are validated according to their existing contracts and are never recomputed or repaired.

The schema coverage is explicit:

| `GameState` branch | Exact-shape and semantic admission |
| --- | --- |
| root, clock, Campaign, economy | persistence exact-key checks plus production clock/Campaign/economy invariants |
| facility modules, routes, Thermal, Power, Overclock and Compute | kind-specific persistence shapes plus the existing geometry, lifecycle and stored-Compute validators |
| Design Mode draft, Undo and Redo | exact draft shape plus `parseDesignDraftOperation` for every operation variant |
| inventory | exact stack shape plus `assertValidInventoryEconomyState` |
| Tasks and Research | exact current/history shapes plus stored lifecycle validators |
| Benchmarks | exact active/history/best-result shapes plus stored Benchmark validation |
| Blueprints | exact record/local-ID shapes plus `assertValidBlueprintState`; historical content versions remain structural history |
| tutorial, Museum and achievements | exact branch and historical snapshot shapes plus production-core validation |

The runtime payload parser intentionally returns an unadmitted payload type while `gameState` is
still `unknown`. Only `admitSavePayloadForContent` produces `SavePayloadV1`. Public encode and decode
both compose content fingerprint verification, execution-state hash verification and fresh production
admission. Domain failures are translated to stable persistence errors.

The codec parses JSON with duplicate-key detection and depth/value/object/array accounting, encodes
canonical UTF-8, checks SHA-256 before payload parsing, supports `none` and bounded native `gzip`,
requires exactly one gzip member, and requires the received uncompressed bytes to equal their
canonical reserialization. Decompressed output is capped even for injected adapters, and cancellation
is rechecked after asynchronous compression, decompression and hashing boundaries. Synthetic schema 0
migrates only on an owned copy by adding zero-valued local stats. No migration runs in storage
transactions, and no codec operation mutates a source artifact or live simulator state.

The simulation-content fingerprint is cached in a private `WeakMap` keyed by the validated immutable
`ContentBundle`. The cache is derived-only, cannot enter authoritative state or serialization, and
does not change content compatibility semantics.

## Verification

Task 16 coverage includes strict discriminants, exact keys, ranges, timestamps, defaults, ownership,
version agreement, full-state corruption admission, canonical-byte and checksum vectors, gzip
round-trip, decompression limits, cancellation/error boundaries, and 100-run deterministic encoding.
Chromium exercises the real codec with native Web Crypto and Compression Streams. Target-host timing
is recorded separately by `corepack pnpm performance:save-codec`.
