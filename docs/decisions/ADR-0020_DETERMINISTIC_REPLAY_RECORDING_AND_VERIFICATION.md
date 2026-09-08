# ADR-0020: Deterministic Replay Recording and Verification

Status: accepted for Phase 1 Task 14 implementation

## Context

OVERCLOCK already has a deterministic headless `SimCore`, a fixed 100 ms tick, typed commands,
transactional command and tick processing, and canonical state hashes. Replay must describe the
public calls that caused those results without becoming a second simulator, adding authoritative
state, or depending on browser, filesystem, wall-clock, or random APIs.

The original build-pack numbered Blueprint, Replay, and the milestone bot as Tasks 14, 15, and 16.
The implemented stream absorbed the initial-state foundation into Task 1, so the active numbering
is Task 13 Blueprint, Task 14 Replay recording and verification, and Task 15 milestone-timing bot.
Historical commit subjects and ADR identifiers are not renumbered.

`TASK_14_BASE` is `2ec2fe03ba6c6f43490709dad94d7dd4ac63be7e`, the independently checkpointed
Task 13.7 route-allocation ordering repair. The earlier Task 13 checkpoint
`355a03bb900af394fc2856fc1c8874dc02b1404e` is not the Task 14 base.

## Decision

Task 14 is implemented in this fixed order:

1. 14.1 — contracts, strict parser, and simulation-content fingerprint;
2. 14.2 — production composition and safe command-queue position;
3. 14.3 — recording session, checkpoints, and fatal boundaries;
4. 14.4 — strict runner and first-divergence diagnostics;
5. 14.5 — verified empty-queue resume and cross-domain determinism;
6. 14.6 — performance diagnostics, complete verification, and permanent documentation;
7. one independent final checkpoint after 14.6.

Task 14 does not implement Task 15, persistence repositories, workers, UI, events, analytics,
leaderboards, or save-file transport.

### Replay compatibility header

`ReplayLog` uses replay version `1` and simulator protocol version `1` independently. It stores the
seed, content version, a lowercase 16-character canonical simulation-content hash, the complete
initial state hash, initial tick, initial queue sequence, ordered entries, checkpoints, and a
completed or fatal terminal marker.

The simulation-content projection is exactly `{ contentVersion, modules, tasks, research, era,
balancing }`. Locales are excluded, object keys use the existing canonical ordering, and content
array order is preserved. The FNV-based result is a deterministic compatibility checksum, not a
security signature.

### Ordered operation journal

Replay entries are contiguous positive sequences beginning at `1`. The journal preserves the exact
order and channel of `enqueue(command)`, `clock(command)` for `SET_PAUSED` or `SET_SPEED`,
`process-pending`, and `step(ticks)`, including `step(0)` and the original grouping.

Each entry stores `tickBefore`, `tickAfter`, the parsed operation, and the strictly paired receipt,
clock result, command-results array, step result, or normalized fatal outcome. Duplicate command
IDs remain separate occurrences. A queued clock command remains an ordinary queued command and is
not rerouted to the host clock path during replay.

### Production composition and queue ownership

`createProductionSimCore` composes each current production command-handler factory once and each
current tick-system factory once. It uses the combined `advance-tasks-and-benchmarks` stage, then
Research, in the existing fixed stage order. Direct `new SimCore` remains source-compatible and is
not made dependent on Replay.

The command queue remains non-authoritative. It accepts a validated initial next sequence, exposes
only a detached `{ nextSequence, pendingCount }` position, and rejects exhaustion before mutation.
The default starts at zero. State replacement cannot reset the queue sequence and pending command
contents are never exported.

### Recording and fatal behavior

A recorder owns a detached initial state and a fresh production core. It calls the real public
`SimCore` entry points exactly once per operation and does not implicitly flush commands. Ordinary
append does not hash or clone the full state. Checkpoints are explicit, require an empty queue, and
hash the complete authoritative state. Sequence zero is mandatory; the final terminal boundary is
mandatory; repeated checkpoints at one boundary are deduplicated.

Recoverable command rejections are ordinary recorded results. A `SimulatorInvariantError` becomes
one normalized terminal fatal outcome containing only its origin, stable code, command ID or tick
system stage, and authoritative completed tick. Stack, cause, localized text, host paths, and
timestamps are excluded. The existing simulator rollback semantics remain authoritative: earlier
accepted work remains committed, the failing tick is rolled back, and pending tail commands remain
pending. The recorder freezes after fatal termination. Unexpected non-invariant errors are
recorder-internal failures and are never certified as replay-fatal outcomes.

### Verification and divergence

The runner validates the complete unknown log before constructing a core or executing an entry. It
compares exact receipts, results, step grouping, ticks, queue positions, checkpoints, and terminal
behavior in journal order. It never installs expected values into the actual simulator.

Reports distinguish `matched`, `matched-fatal`, `invalid-log`, `incompatible`,
`invalid-initial-state`, `limit-exceeded`, `diverged`, and `internal-error`. Divergence reports the
first deterministic entry or checkpoint mismatch and the last matching checkpoint; it does not
invent a first divergent tick where only an interval is evidenced. Default verifier budgets are
100,000 entries and 100,000 requested ticks.

### Resume

Resume is an in-memory operation only. A `ReplayResumeArtifact` binds a detached full state
snapshot and queue sequence at an existing nonfatal empty-queue checkpoint to the hash of the
complete finalized log. Resumption validates the entire log, artifact, state, checkpoint, content,
seed, and queue position, then constructs a cold independent production core and executes only the
remaining entries. Fatal or pending-queue boundaries cannot resume. Caches, witnesses, registries,
pending commands, and scratch data are never serialized.

### Trusted data, ownership, and performance

Replay-owned inputs are checked for canonical serializability before strict parsing. Exact object
keys, standard prototypes, dense arrays, finite values, safe integer arithmetic, and consistent
operation/outcome/checkpoint relationships are required. Parsed commands, results, entries,
artifacts, and snapshots are detached and immutable at their public boundaries. Replay data stays
outside `GameState`, save snapshots, state hashes, RNG state, command receipts, and tick systems.

Replay must preserve the existing warm production tick p95 below 4 ms. The recorded and playback
warm production paths have a p95 hard target below 5 ms. Setup, content fingerprinting, checkpoint
hashing, parsing, finalization, cold construction, and resume construction are measured separately.
No formula, gameplay validation, fixture work, determinism repetition, or threshold is weakened for
performance.

### Checkpoint hardening

The independent checkpoint audit added three boundary protections without changing the Replay
wire format or gameplay semantics. Incompatible-header classification inspects only own data
descriptors, so an accessor-bearing malformed log is rejected without invoking user code. A
failure while capturing the mandatory fatal checkpoint permanently marks that recording session
unusable, and no artifact can subsequently be exported from it. Resume-boundary input also rejects
negative zero explicitly. Regression coverage exercises these cases together with same-tick
ordering, duplicate UUID occurrences, exact optional result fields, fatal partial commits,
checkpoint tampering, resume binding, full Peak and Sustained traces, and the Task 13.7 route-ID
padding boundary.

## Consequences

The simulator has a durable, inspectable journal for deterministic debugging and regression
verification. Replay incurs no work in a direct unwrapped `SimCore` and no authoritative-state
growth. Content-localization edits remain compatible, while simulation content or protocol changes
are explicit incompatibilities. A replay is an integrity and determinism tool, not a cryptographic
signature or anti-cheat authority.
