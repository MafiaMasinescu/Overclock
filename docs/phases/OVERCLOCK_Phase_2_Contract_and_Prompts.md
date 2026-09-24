# OVERCLOCK Phase 2 Contract and Prompts

Planning artifact, 2026-09-16. No Phase 2 code has been implemented by this planning session.

Recommended repository destination when Task 16.1 begins: `docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md`.

## 1. Evidence, authority and readiness

Repository: <https://github.com/MafiaMasinescu/Overclock>.

The approved Phase 1 base is `00acd280d195f23e6f0beca9560998090b117a5c`, parent `09ecfa90e3a8176ceecc90c0b178b36ff045769b`. Subject: `fix: enforce campaign timeline coherence and reconcile phase closure`. The review checkout was fast-forwarded to the public checkpoint. HEAD, origin/main and remote main matched, ahead/behind was 0/0, and the worktree was clean. No source file was edited. The complete 28-file change and relevant current public APIs were inspected. Focused execution passed 4 files / 59 tests: Campaign foundation, timeline coherence, host classification and exact Campaign timeline determinism. An initial Vitest invocation used an unsupported project filter; the corrected invocation above passed. This is a bounded checkpoint review, not a new claim that all Phase 1 gates were independently rerun here.

The published ADR-0022 records 1,220 unit tests and 22 determinism tests twice, six Chromium E2E cases, production build and the canonical milestone evidence. Those are checkpoint evidence. The pure Benchmark measurements 0.1035/0.1559 ms remain technical misses against 0.10 ms. The owner permits proceeding with Phase 2 planning. Keep that exception visible; do not classify it as a pass, expand it to combined/production paths, or quietly waive a newly introduced regression. Repeat isolated measurement at Phase 2 closure; this same pre-existing pure miss alone does not prevent planning or intermediate work under the owner's current instruction.

Sources inspected: AGENTS.md, README, PROJECT_STATUS, ADR-0022 and the changed ADR-0020/0021 clauses, applicable Phase 1 ADR contracts, active Phase 2 outline, Markdown TDD, GDD roadmap and relevant public source interfaces. Current Git and ADRs govern. Word documents remain archival.

No unresolved product question requires an answer before this planning document can be used. The architectural choices below are explicit proposed Phase 2 decisions, not claims about existing implementation. Task 16.1 records them in new ADRs before code depends on them. If a newly discovered accepted Phase 1 semantic contract conflicts with them, stop and report that concrete conflict. Do not stop for the listed refinements of unimplemented Phase 0 interface sketches or future TDD text: this document explicitly decides those refinements.

### 1.1 Actual inventory of the old Phase 2 scope

| Old outline item                         | Status   | Evidence and remaining work                                                          |
| ---------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Complete content loader/cross-references | Complete | Existing loader/schema validates and freezes content; preserve it                    |
| 12 modules, 8 Tasks, 10 Research nodes   | Complete | Also 2 Benchmarks and 2 locales; do not recreate                                     |
| Balancing and milestone fixtures         | Complete | Task 15 bot and duplicate baseline exist                                             |
| Worker protocol and SimWorkerHost        | Partial  | Type unions only in `src/app/game-client/contracts.ts`; worker directory has no host |
| GameClientStore/selectors                | Partial  | GameClient interface, React hook, static fake; selectors absent                      |
| IndexedDB repository                     | Absent   | SaveRepository interface only                                                        |
| Three autosave rotations                 | Absent   | Future TDD policy only                                                               |
| Export/import envelope                   | Partial  | SavePayloadV1/SaveEnvelope types exist, no codec or flow                             |
| Checksum/input limits                    | Absent   | FNV Replay hashes exist; they are not a save codec                                   |
| Save round-trip/migration demo           | Absent   | Detached GameState and in-memory Replay resume are prerequisites only                |
| Local playtest report                    | Partial  | Dev milestone reports exist; browser report schema/storage does not                  |

Additional foundations: 26 production gameplay handlers, explicit clock commands, fixed 100 ms ticks, queue sequence introspection, exact Campaign year, immutable owned GameState, historical domain validation, generation evidence, strict Replay parsing/recording/verification/resume. The actual methods are `enqueue`, `processPendingCommands`, `step`, `applyClockCommand`, `getStateForSave`, `getCommandQueuePosition`, `replaceState`; snapshot/event methods in old TDD are target signatures, not existing production methods.

## 2. Goal, deliverable and phase boundaries

Deliver a browser application in which the existing deterministic simulator runs in a dedicated Worker, a real GameClient exposes owned immutable presentation data, and verified saves survive reload, import, migration and Worker failure. The Phase 0 shell receives the real bridge plus a minimal usable persistence/recovery control panel. Phase 3/4 gameplay UI is not part of this phase.

Entry: clean approved base; ADR-0022 and the documented Benchmark exception; validated content; reproducible Phase 1 tests; agreement to execute this plan one checkpoint group at a time.

Exit: all six groups checkpointed; real browser direct/Worker parity; verified mid-Replay save continuation; atomic import/rotation/recovery; strict external schemas; bounded resources; production has no devtools imports; required performance evidence and frozen compatibility; current docs and no unresolved Critical/Important defect. Phase 3 still requires a separate contract.

In scope: host scheduling, transport, selectors, revision patches, store, persistence worker services, bounded local reports, minimal shell integration and infrastructure tests.

Deferred: Offline Assist, background progress, new gameplay formulas, workload-dependent Power/Heat, energy settlement, semantic tutorial/achievement/alert systems, chart history/downsampling UI, A*/auto-connect, renderer/heatmap UI, blueprint standalone import/export, cloud/accounts/authentication, cryptographic signing, service workers, SharedArrayBuffer, cross-device sync, Tauri, full-game eras. Preserve already implemented Museum data; do not generate thumbnails.

## 3. Decision register and explicit gates

| ID     | Decision fixed for Phase 2                                                                             | Reason / compatibility consequence                                                              |
| ------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| P2-D01 | Use active Git phases 0–5; Task 16–21 belong to Phase 2                                                | No renumbering of Phase 1 tasks                                                                 |
| P2-D02 | One active SimCore inside one dedicated simulation Worker per client                                   | No authoritative copy on UI thread                                                              |
| P2-D03 | Put codec and IndexedDB services in that Worker; serialize mutation barriers                           | Keep large synchronous parse work off UI; maintenance time earns no simulated time              |
| P2-D04 | UI keeps only presentation/settings copies and transport promises                                      | SimCore alone owns gameplay                                                                     |
| P2-D05 | Browser host uses 100 ms fixed steps, 20-tick maximum burst, explicit suspension                       | ADR-0003 preserved                                                                              |
| P2-D06 | No Offline Assist or background advancement in this phase                                              | Refines unimplemented TDD delegation; no hidden command or reward                               |
| P2-D07 | Commands execute FIFO at host operation boundaries using existing command-only API                     | Paused commands remain usable; Replay records actual operations                                 |
| P2-D08 | Save only at an empty simulator queue, persist nextQueueSequence                                       | Receipts stay continuous after load; no inferred/replayed pending commands                      |
| P2-D09 | Recovery restores last verified durable save, then waits for Continue                                  | No automatic replay of uncertain work; possible loss since checkpoint is explicit               |
| P2-D10 | New loads recover exact saved state but scheduler is held                                              | Do not mutate serialized pause/speed as a side effect of load                                   |
| P2-D11 | Keep GameState.saveVersion=1, contentVersion and Replay protocol unchanged                             | Add separately versioned persistence payload/transport contracts                                |
| P2-D12 | Current save payload schemaVersion=1; a documented synthetic schemaVersion=0 migration demo            | Never claim the demo is a historical released format                                            |
| P2-D13 | Exact contentVersion plus existing simulation-content fingerprint match                                | No automatic content remap or old-domain history reinterpretation                               |
| P2-D14 | SHA-256 covers canonical uncompressed payload UTF-8; envelope uses none or gzip                        | Integrity only; not authentication                                                              |
| P2-D15 | Import preview is read-only, confirmation is bound to bytes and destination revision                   | Prevent preview/commit substitution and stale overwrite                                         |
| P2-D16 | One writer per slot using Web Locks plus IndexedDB revision/fencing checks                             | Multiple tabs cannot silently overwrite each other                                              |
| P2-D17 | Autosaves retain the newest three successful distinct captures per slot                                | First two successes yield one/two records; do not invent copies                                 |
| P2-D18 | Snapshot transport has one unacknowledged publication plus latest pending state                        | No unbounded patch queue; loss triggers full resync                                             |
| P2-D19 | Derive limited fact notifications in host observers, not new simulation stages                         | Semantic event design stays Phase 4; no state-hash changes                                      |
| P2-D20 | Replace placeholder VM guesses with explicit null/not-available values                                 | No invented deadline forecasts, memory usage or route utilization                               |
| P2-D21 | Autosave at accepted Benchmark start and terminal transition replaces vague before/after-final wording | Handles unpredictable failures; explicit target-policy refinement, no Benchmark behavior change |
| P2-D22 | Import preserves current device settings by default; explicit checkbox may apply imported settings     | Run-local stats travel with run; display policy is not gameplay                                 |
| P2-D23 | Finite local report allowlist, no raw save/seed/name/path/stack/command payload                        | Local-first and no personal-data collection                                                     |
| P2-D24 | Luna xhigh for implementation prompts; Sol High for independent checkpoints                            | Bounded tasks and explicit gates; no claim about model quota or benchmark superiority           |

Architecture gates: Task 16.1 records these choices; Task 16.4 verifies strict state-schema completeness; Task 18.3 freezes the projection mapping; Task 19.4 proves real Worker behavior; Task 20.3 proves durable recovery; Task 21.2 collects target-host evidence. A gate failure causes repair in the current group, not an invented fallback or silent threshold change.

## 4. Ownership and permitted dependency directions

| Owner                       | Owns                                                                                               | Must never own/do                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SimCore                     | GameState, RNG, queue, private domain runtimes                                                     | timers, IndexedDB, DOM, React, Worker messaging, crypto metadata  |
| Pure presentation projector | derived immutable VM values, private last-published comparison cache                               | gameplay writes, duplicated allocation/formula implementation     |
| SimWorkerHost               | core lifecycle, serial operation queue, scheduler, current transport epoch, projection publication | change dt/order or infer offline rewards                          |
| Worker persistence service  | detached capture, strict codec, migration, IndexedDB transactions, confirmed import tokens         | reach into live authority or publish before transaction commit    |
| GameClientStore             | immutable snapshots/grid state, pending promises, listener sets, connection status                 | mutable GameState, speculative gameplay updates                   |
| UI thread                   | local selection/camera, dialogs, file picker/download, visibility and writer-lock lifecycle        | simulate ticks or treat cached previews as authority              |
| Replay                      | deterministic operation trace and verification                                                     | wall time, durable slot management or automatic retry of commands |

Pure projection types live in a simulator-neutral module under `src/sim/selectors` (or a small existing neutral contracts boundary). Existing app snapshot imports re-export/adapt those types. `src/sim` must not import `src/app`. Add a narrow SimCore presentation method that invokes the pure projector internally and returns detached/owned VM values. It must not expose mutable GameState or call getStateForSave per snapshot. No arbitrary externally supplied callback is allowed to capture authoritative references. This additive read API must preserve Phase 1 behavior/hashes and keep its private projector cache out of saves.

Capture uses existing `getStateForSave()` only at save/checkpoint barriers. It returns detached data. Captured state and queue position belong to one synchronous empty-queue boundary; no await between their reads. Restoring constructs a fresh production core with captured nextQueueSequence before promotion. Candidate failure keeps the old core, store and slot untouched. Never use replacement to inject a state that bypasses production validation.

## 5. Worker transport and lifecycle

### 5.1 Strict wire contract

Transport version is independently `1`. Every request is a plain exact-key record `{protocolVersion:1, epoch, requestSequence, kind, body}`. Epoch is a UI-generated opaque session token, 1–64 ASCII alphanumeric/hyphen characters; it never enters GameState or Replay. Request sequence starts at 0 and is a nonnegative safe integer. Per-direction outbound sequence is also monotonic. The receiver accepts only the expected next request sequence within the current epoch. Duplicates/gaps are protocol errors, never repeated gameplay. A new epoch invalidates every old message, acknowledgement and import token.

Replies carry `{protocolVersion, epoch, outboundSequence, requestSequence:null|number, kind, body}`. COMMAND_RESULT carries the unchanged domain CommandResult and echoed commandId; Promise correlation uses epoch/requestSequence, not commandId alone. Phase 1 command-ID semantics remain unchanged. No retries on timeout. A syntactically invalid command produces a transport request error and no simulator receipt; a valid rejected command returns the existing domain rejection.

Request kinds: INITIALIZE_NEW(seed, contentVersion, fingerprint); LOAD_SLOT(slotId); COMMAND(command); REQUEST_FULL_SNAPSHOT; ACK_PUBLICATION(publicationSequence); ACK_RESULT(outboundSequence); SET_PRESENTATION_CONTEXT(selected IDs, inspected entity, heatmapEnabled); SET_HOST_VISIBILITY(visible); CONTINUE_HOST; REQUEST_SAVE(reason); LIST_SLOTS; PREVIEW_IMPORT(owned file bytes); CONFIRM_IMPORT(token, destination, expectedRevision, applySettings); EXPORT_SLOT(slotId, expectedRevision); DELETE_SLOT(slotId, expectedRevision); UPDATE_SETTINGS; REQUEST_REPORT; LIST_REPORTS; DELETE_REPORT; RECOVER; SHUTDOWN. ACK_RESULT is a one-way transport acknowledgement: it has no reply and releases the bounded host result slot for that outbound sequence. READY, COMMAND_RESULT, REQUEST_RESULT/REQUEST_ERROR, SAVE_COMMITTED(metadata), SESSION_REPLACED and SHUTDOWN_COMPLETE are terminal results; intermediate receipts, publications, facts and lifecycle controls are not. SAVE_COMMITTED carries `{metadata:{slotId,savedAtIso,tick,sizeBytes}}`. SAVE/LOAD/IMPORT operations return typed terminal replies. The client surfaces a user-confirmation API; Worker confirmation tokens alone are not an authentication boundary against malicious same-origin code.

Responses: READY, COMMAND_RECEIPT (optional public receipt exposure, once only), COMMAND_RESULT, SNAPSHOT_PUBLICATION, EVENT_BATCH, REQUEST_RESULT/REQUEST_ERROR, SAVE_COMMITTED, RECOVERY_AVAILABLE, SESSION_REPLACED, FATAL_ERROR, SHUTDOWN_COMPLETE. Narrow bodies are discriminated unions; no generic unchecked JSON bag. Store connection errors separately from SimEvent. No production STEP_DEBUG message: tests use an injected manual scheduler driver around the same host implementation; dev entry may expose stepping but production must exclude it.

Use descriptor-based plain-data checks before cloning in public JS adapters. Reject cycles, custom prototypes, accessors, functions, symbols and non-enumerable extras. Then schema-parse and detach. Revalidate received cloned wire data. Structured clone alone is not schema validation and may execute accessors at the sending call if unvalidated. Do not claim JavaScript Proxy traps can be detected without executing traps; supported untrusted external artifacts are bytes, and an already executing same-origin Proxy is outside the data-only threat model.

Limits: at most 256 outstanding requests and 2 MiB aggregate ordinary request bytes; individual ordinary request 256 KiB, except import up to its file limit. Only one import preview/load/save maintenance operation active; excess returns BUSY. The host reserves one result slot when admitting each request that requires a terminal response and retains it until ACK_RESULT. Reserved plus unacknowledged terminal results never exceed 512; a request beyond capacity stops admission and emits a fatal transport overflow rather than dropping accepted command outcomes. Presentation messages have separate coalescing. Safe-integer sequence exhaustion closes the epoch at a quiescent boundary. No unbounded duplicate-ID cache.

### 5.2 Ordering, pause and fatal handling

All gameplay/clock/load/save operations share one serial executor. Each gameplay command enqueues, obtains its receipt, and runs processPendingCommands immediately in that executor before another request or scheduler step. This is an existing legal command-only boundary at the current tick, even while paused. Clock commands use applyClockCommand and consume no simulator queue sequence. The simulator queue is normally empty outside one command operation. Scheduler ticks invoke step(1) individually so completed facts and partial fatal boundaries remain observable.

Capture/load/shutdown barriers wait behind earlier requests and ahead of later ones. Async maintenance may hold the executor; it must not interleave state promotion with ticks. Paused state is not permission to skip command parsing or validation. Timed-out requests become outcome-unknown; never automatically resubmit them.

Lifecycle: NEW -> INITIALIZING -> READY_HELD or RUNNING; RUNNING/READY_HELD may enter MAINTENANCE; FATAL ends scheduling/admission; RECOVERING constructs a new epoch/core; STOPPED releases resources. The persisted clock.paused flag and transient host-held/hidden state are distinct. A loaded unpaused save remains unmodified but waits for CONTINUE_HOST. New game may start automatically only after the shell has mounted and READY is acknowledged.

On domain fatal: preserve actual Phase 1 partial-command/prior-tick commits, stop further work, settle unresolved requests as failed/outcome-unknown accurately, keep the last durable checkpoint untouched, emit a sanitized code/tick/stage report and recovery choice. Never autosave the fatal candidate. Worker error/messageerror or heartbeat loss follows the same recovery UI with unknown outcomes. No automatic recovery loop: one explicit recovery attempt, then user action if it fails. Send host heartbeats once per real second while visible; a 5-second missing heartbeat marks the outcome unknown only outside declared bounded maintenance. Hidden-tab suspension disables heartbeat timeout. A 5-second maintenance operation timeout cancels pre-commit work; do not declare a transaction cancelled after it has committed. Before transaction creation cancellation prevents writing; once a transaction starts, resolve its actual completion/abort outcome before reporting cancellation. Never report a committed save as rolled back merely because its response timed out.

## 6. Scheduler contract

Inject a monotonic clock and timer into the host. Browser adapters use performance.now outside sim. Timer target wake is 25 ms; scheduling correctness never depends on exact timer delivery. On a normal wake, add elapsedRealMs times the speed that applied during that elapsed interval to an accumulator. Run floor(accumulator/100) ordinary ticks, at most 20; subtract 100 per successfully completed tick. Yield to message processing after each burst. Speed changes settle elapsed time under the previous speed at the operation barrier, then use the new speed. Pausing/host holds reset lastNow and accumulator to zero; discarded fractions are host timing policy, not GameState time.

If elapsed real time exceeds 2000 ms, visibility becomes hidden, or accumulated debt would exceed 20 ticks, enter suspended hold, discard catch-up debt and publish SUSPENDED. No reward, deadline advancement, calendar advance or background ticks occur for that interval. On visibility return, reset the clock/accumulator and resume only if not user-paused and not load/recovery-held. Long-gap suspension requires explicit Continue, avoiding surprise bursts. Maintenance/save/import CPU time likewise resets scheduling origin on exit; it earns no catch-up. Hide/show does not issue SET_PAUSED or mutate Replay.

No Offline Assist in Phase 2. The GDD's 30-minute/35% concept remains deferred to a future explicit gameplay contract; update future TDD text that currently assumes delegation exists.

## 7. Presentation, revisions and delivery

### 7.1 Projection policy

Presentation facts for Phase2 are limited to COMMAND_REJECTED, DESIGN_APPLIED, MODULE_PURCHASED, MODULE_SHUTDOWN, TASK_ACCEPTED/COMPLETED/FAILED, RESEARCH_STARTED/COMPLETED, BLUEPRINT_SAVED/INSTANTIATED, BENCHMARK_STARTED/COMPLETED/FAILED, MUSEUM_SNAPSHOT_CREATED and TRANSISTOR_REVEALED when those facts are directly evidenced by committed state/results. Do not emit THERMAL_WARNING, TASK_DEADLINE_AT_RISK, tutorial or achievement events by guessing future rules. Fact IDs are epoch plus monotonic eventSequence, external to GameState. Publish facts only after commit; a throwing later subscriber cannot undo a committed fact. Batch at most128 facts and buffer at most512. On an event gap, expose an EVENTS_GAP control notification and recover display from the next snapshot; never silently drop command results or use event replay for gameplay. Autosave/local-stat observers consume each committed fact before presentation coalescing, so a slow UI cannot lose persistence triggers. A Benchmark event score maps to its stored averageUsefulComputeFlops, the unit is explicit and it does not replace the existing type-specific best-run comparator. Cancellation has no invented failure fact; internal persistence observes active-to-null/history directly.

Publish UiSnapshot at no more than 10 Hz, including command-only changes. READY and lifecycle/fatal control messages are exempt; they do not trigger an unbounded telemetry stream. A foreground ordinary command is reflected within 200 ms under the normal fixture. Charts/history UI remains deferred; do not create 3600-sample series in GameState. Existing seriesRevision is 0 until a later chart contract supplies data.

Projection reads current immutable state, content and presentation context. Never reimplement thermal, Power, Compute, Research eligibility or cost formulas in UI. Reuse pure domain selectors where available. For derived arithmetic not already provided, document the exact read-only definition and verify it independently.

Required field mapping:

- Header year/objective/pause/speed/cash: direct current state; useful/theoretical compute: facility Compute totals; draw/headroom: stored Power; capacity: contracted facility value; thermal mean/max: all authoritative thermal tiles.
- Task cards: deterministic ID ordering, definition labels/tags, exact phase progress from existing Task operations/requirements, stored allocation delivery. Forecast completion and deadlineRisk are null when no accepted forecast exists; do not invent a forecast formula.
- Research: current active node/progress, status/evidence and existing pure eligibility rules. Build availability uses current content/research rules.
- Inspector: selected module/route/tile/task data and stored Compute breakdown; absent/stale selection gives empty inspector. No gameplay calculation on selection.
- Telemetry memory fields: map only to quantities actually recorded by Compute; otherwise null. Retry rate uses authoritative stored aggregate if present; otherwise null. Never silently display 0 for unknown usage or average unweighted module rates. Power headroom remains stored. Bottleneck may select the stored breakdown entry with greatest lostComputeFlops, with factor lexical order as tie-break, from the inspected entity; no selection yields null.
- Grid: mode explicitly `live` or `draft`. Geometry comes from the selected authoritative live/draft layout. Physics always references live results, not a recalculated draft prediction. For draft-only entities, operational metrics are null; selection is local presentation state. Grid draft thermal background still represents the unchanged live field.
- Module temperature is mean temperature of its live occupied tiles; no live footprint gives null. Warning priority thermal > power > route > none, using existing shutdown/Power limiting reason and actual invalid-route diagnostics, not guessed thresholds.
- Route utilization: stored Power byRoute utilization for power; data utilization null unless authoritative evidence exists.
- Placement preview/diagnostic highlights/semantic alerts remain null/empty until their later UI contracts, except presentation of existing explicit domain diagnostics. Tutorial fields reflect stored state; no progression is invented.
- commandAvailability is a conservative availability hint derived from state/pure guards, never a substitute for command validation. Unknown kinds omitted. Actions remain dispatchable through the API and receive actual domain rejection.

Document every changed nullable VM field and update fake client/shell consumers. These interface refinements affect presentation only.

### 7.2 Patches and ownership

Worker keeps independent presentation revisions, starting at 0 in each epoch. Do not put them in GameState. Grid patch envelope includes epoch, publicationSequence, baseGridRevision, nextGridRevision, viewMode, source live/draft/thermal revisions, upsert/remove module and route lists, and heatmap patch. Full snapshot on first READY, load/recovery, mode/dimension change or explicit resync. Removals are explicit; lists sorted by existing lexical ID rules.

Heatmap deltas compare each current temperature to the last ACKNOWLEDGED transmitted temperature, not just the immediately previous simulation tick. Include a tile once accumulated absolute change reaches dirtyEpsilonC (0.05 currently). A full resync sends exact values for every tile. Epsilon controls presentation only. Thermal source revision may advance even when the patch has no changed tile. Do not lose drift through repeated sub-epsilon comparisons.

One publication may be in flight. Further changes coalesce into the latest pending state; never concatenate patches whose base was not acknowledged. ACK only after the store atomically applies the entire UI/grid publication. Wrong epoch is discarded. Wrong base/sequence requests full resync and applies nothing. After 1000 ms without ACK, retain a single latest full-resync candidate and signal degraded transport; do not allocate repeated snapshots. FATAL/command results bypass this coalescing channel.

GameClientStore owns/freeze-checks received values, preserves equal section references, and exposes stable getSnapshot/getGridViewModel results until publication changes. Selector subscriptions use Object.is by default with optional equality and unsubscribe cleanup. React selection/camera state stays outside authoritative snapshots. No per-tile React components. Event subscriptions cannot mutate the store or simulator.

## 8. Durable save schemas and codec

### 8.1 Versions and capture

Refine the unimplemented SavePayloadV1 type additively before its first durable release. Current exact keys:
`schemaVersion:1`, `saveVersion:1`, `contentVersion`, `simulationContentHash`, `createdAtIso`, `savedAtIso`, `slotId`, `gameState`, `execution`, `settings`, `localStats`.
`execution` is exact `{simulatorProtocolVersion:1, nextQueueSequence, pendingCommandCount:0, stateHash}`. State hash uses the existing FNV canonical function for deterministic diagnosis; it does not replace envelope SHA-256. Outer saveVersion/contentVersion must equal GameState fields; fingerprint must equal current validated content; execution hash must equal GameState canonical hash. Capture creates both from one empty-queue state boundary. No runtime cache, pending request, epoch, clock accumulator, preview token or witness is serialized.

Outer persistence schemaVersion is separate from GameState.saveVersion. Preserve GameState layout/version and all Phase 1 compatibility vectors. Wall-clock metadata never enters GameState or Replay hashes.

Slots: IDs match `[a-z0-9][a-z0-9-]{0,63}`; new app slots use an external random UUID-based ID. At most 20 manual slots. File slotId is metadata only on import: destination is newly allocated or explicitly selected after preview. Rebinding slotId requires a fresh canonical payload/checksum, leaving source bytes untouched.

Timestamps are exact UTC ISO strings `YYYY-MM-DDTHH:mm:ss.sssZ` with valid calendar components. They are external metadata from an injected wall clock. savedAt may precede createdAt after OS clock correction; do not reject deterministic progress or reorder saves by time. Repository generation determines ordering.

Settings exact fields match current PlayerSettings: language ro/en; telemetryPreset compact/standard/diagnostics; reducedEffects/reducedMotion booleans; frameCap 30/45/60; five named volumes finite 0..1. Default en, standard, false, false, 60, and all volumes 1. No unknown keys or implicit coercion. Current UI preferences survive import unless applying imported settings was explicitly confirmed.

LocalStats exact current fields: realPlayTimeSeconds finite 0..Number.MAX_SAFE_INTEGER; the exact counter fields are: taskCompletions, taskAbandons, emergencyShutdowns, benchmarkAttempts, designApplications, all nonnegative safe integers. There are five counters plus realPlayTimeSeconds. Accumulate real time only while visible/running/unpaused outside maintenance; use monotonic elapsed time, not savedAt differences. Increment counters from committed transition facts/accepted command outcomes once. Do not reconstruct them from current history on each snapshot. Cap at representable maximum with a host diagnostic; never corrupt gameplay for counter overflow.

Preview exact fields: source schemaVersion/saveVersion/contentVersion, simulatedYear, tick, cashUsd, verticalSliceCompleted, savedAtIso, migrationRequired, compatibility (`compatible` or stable unsupported reason), destination suggestion, byte sizes. Derive values after verification and state admission. Listing may show stored cached preview with status `unchecked`; load never trusts it. No source filename/path is retained in reports. Stable persistence errors include INVALID_FORMAT, LIMIT_EXCEEDED, CHECKSUM_MISMATCH, UNSUPPORTED_VERSION, UNSUPPORTED_COMPRESSION, INCOMPATIBLE_CONTENT, INVALID_STATE, MIGRATION_FAILED, STALE_REVISION, STALE_WRITER, SLOT_BUSY, SLOT_ACTIVE, QUOTA_EXCEEDED, STORAGE_ABORTED, UPGRADE_BLOCKED, TOKEN_EXPIRED, TOKEN_CONSUMED and CANCELLED. Transport errors are separate from domain CommandRejectionCode and never added as fake SimCommand outcomes.

### 8.2 Strict input and resource limits

File input <=8 MiB UTF-8 JSON envelope. Uncompressed canonical payload <=16 MiB. Compressed binary <=6 MiB before base64; full envelope limit still applies. Envelope depth <=4. Payload depth <=64, <=1,000,000 total visited values, <=100,000 entries in any array/map, <=256 UTF-16 units per object key, and <=16,384 units per ordinary string unless a stricter domain limit exists. Count limits before recursive expensive canonicalization/validators. Every string is well-formed Unicode; reject lone surrogates. Use existing domain limits when tighter. Runtime captures exceeding export limits fail visibly without clipping legitimate state; production gameplay is not capped to make saves pass.

Descriptor traversal for in-memory inputs rejects accessors without reading them, prototypes except plain/null-prototype records, nonstandard arrays, cycles, holes, symbols, custom array props and unsupported primitives. Exact recursive state schemas cover every current GameState branch and allowed historical record variant; explicitly defined Record maps are allowed but their values/keys are validated. Dynamic JSON DesignDraftOperation payloads use their actual kind-specific Phase 1 shapes, not an arbitrary unknown bag. Unknown state fields are rejected, not stripped. Reject prototype-pollution keys (`__proto__`, `constructor`, `prototype`) at external maps. Strict JSON duplicate-key detection is required for envelope/payload before semantic admission; use a small reviewed tokenizer with depth/node accounting, no eval or regex-only parser. Parse without coercion. Preserve canonical Phase 1 number behavior for valid states; enforce negative-zero rejection wherever current domain contracts and new integer fields require it, not by silently changing the global Phase 1 canonical serializer.

After schema validation, admit through fresh production SimCore and getStateForSave validation, using the captured queue sequence. Reuse existing structural/historical validators. Do not reinterpret stored historical results, discard incompatible historical Blueprints that Phase 1 allows, or recompute cached historical records to make import valid. New field schemas must accept valid checkpoint history exactly.

### 8.3 Envelope and checksum pipeline

Envelope exact keys stay `{format:"overclock-save", compression:"none"|"gzip", checksumAlgorithm:"sha-256", checksum, payload}`. Checksum is lowercase 64-hex SHA-256 of the exact uncompressed canonical payload UTF-8 bytes. For none, payload is that JSON text. For gzip, payload is standard padded RFC4648 base64 of gzip bytes. Strictly reject invalid/noncanonical base64, truncated/invalid gzip and trailing compressed garbage. Native CompressionStream/DecompressionStream are the chosen browser primitives; no remote service. If gzip encode support is unavailable, export none; if decode support is unavailable, return UNSUPPORTED_COMPRESSION, never reinterpret it.

Decode order: file-byte bound -> strict envelope parse/schema -> compression/base64 bounds -> streamed decompression with cumulative uncompressed byte cap -> SHA-256 verification before parsing payload -> bounded strict payload parse -> exact schema/version dispatch -> canonical reserialization must equal received uncompressed bytes -> copy-only migration if needed -> current schema/content/domain admission -> detached verified preview/candidate. Absolute output cap is enforced per chunk before concatenation; expansion ratio is reported, not used as a reason to accept data beyond the cap. Terminate decoding after 5 seconds in the host operation timeout policy; cancelled work may not later mutate slots/live state. No promise-race that leaves an unchecked background commit running.

Encode is the inverse using existing canonicalSerialize semantics, guarded by resource/schema validation first. Do not rely on compressed-byte identity across browser versions; golden vectors compare canonical uncompressed bytes and digest, plus successful gzip round-trip. Default export/storage none for predictability; explicit gzip export supported and measured. Both encoding modes must satisfy the full envelope byte cap; a payload that fits the uncompressed cap can still exceed the none-envelope cap. Return LIMIT_EXCEEDED and offer explicit gzip where it can fit, never silently truncate. Large fixtures record this distinction. Compression does not authenticate data.

Browser API constraints: IndexedDB transactions become inactive outside their active request lifecycle; prepare hashing/compression/validation before opening a readwrite transaction and acknowledge on transaction completion, not put success. [IndexedDB specification](https://www.w3.org/TR/IndexedDB/). Native compression defines gzip stream handling; bound output in the consumer. [Compression Streams specification](https://compression.spec.whatwg.org/). Worker transport follows platform lifecycle/message rules, with the stricter application ordering above. [HTML Workers specification](https://html.spec.whatwg.org/multipage/workers.html).

## 9. Migration, import, export and atomic load

Migration registry keys are outer schemaVersion, each transform `v -> v+1`, pure on an owned copy, deterministic, output revalidated and bounded. Unknown future schema/saveVersion rejects. No automatic downgrade. contentVersion/fingerprint mismatches reject as INCOMPATIBLE_CONTENT unless a separately approved explicit content migration exists; none is introduced in Phase 2.

Demonstration v0 is explicitly a synthetic teaching/test export format, never a claim that Phase 1 published saves. It has the same complete GameState, execution/queue metadata, fingerprint and settings as v1, but omits localStats and carries schemaVersion 0. Its defined semantics are that local stats were not tracked; migration supplies the exact zero-valued stats and schemaVersion 1. It must never infer missing queue position, normalize Campaign year or rewrite state. Support importing this well-defined demo fixture via the real migration registry; exports always emit v1. Mark its provenance in docs. Migration failure leaves input, DB and live core unchanged; migrations do not run inside readwrite transactions.

PREVIEW_IMPORT fully validates once and returns a private one-use token plus detached preview. Token binds source byte digest, migrated candidate digest, epoch, content fingerprint, destination plan and expected revision. Retain at most one candidate for 5 minutes of monotonic host time; stale/consumed token rejects. Confirmation cannot replace candidate bytes or destination silently. Destination changes require a fresh confirmation binding. Default creates a new slot; overwrite requires the actual UI confirmation with slot/revision shown. Confirmation rechecks content and destination generation in the write transaction. Only after the durable transaction commits may the slot list change. Import itself never changes the active live run; an explicit load does that separately.

LOAD_SLOT reads/verifies candidate, constructs a fresh core/projector privately and promotes only after success. Previous core, request sequence and presentation remain valid until promotion. Any old queued gameplay request is rejected as SESSION_REPLACED at the barrier; it must not leak into the newly loaded run. Load creates a fresh epoch handshake and scheduler hold. At the load barrier the client stops new submissions. The Worker settles the LOAD request in the old epoch with SESSION_REPLACED carrying a fresh nextEpoch, then sends READY at outboundSequence 0 in that new epoch. The client accepts this transition only for its pending LOAD/RECOVER operation, rejects every other old pending request, resets next requestSequence to 0 and acknowledges the new READY. No unsolicited epoch switch is accepted. A failed load stays in the old epoch and keeps the old core/store. Import of an inactive slot leaves the live session untouched. If applySettings is confirmed, update the global settings record and its revision in the same transaction as the imported slot; publish the new device settings only after that transaction commits. Settings application is a separate explicit option coordinated with the successful import/settings transaction, not an implicit load mutation.

EXPORT_SLOT reads and verifies the requested committed generation. Export produces new owned bytes/download Blob. It never changes stored source bytes, save timestamps or live state. Export of current unsaved progress is explicitly a save-capture operation first, never an undocumented mutation of EXPORT_SLOT. On quota/corruption/incompatibility, return stable errors and preserve old records.

## 10. IndexedDB and concurrency

Database `overclock`, version 1. Stores:

- `saves`, key slotId: latest manual save envelope, verified derived preview and slot generation;
- `autosaves`, compound key [slotId, captureSequence]: envelope and verified preview;
- `slotMeta`, key slotId: monotonic revision, nextCaptureSequence, writerEpoch, latest recovery locator;
- `settings`, key `global`: settings and revision;
- `reports`, key reportId: bounded sanitized local report;
- `blueprints`: reserved empty store only if preserving the TDD schema simplifies v1, no standalone blueprint persistence behavior.

Manual saves and autosaves both consume the same per-slot monotonic captureSequence; manual records carry it too, even though only autosaves participate in three-rotation pruning. An initial manual save creates the slot identity; a slot with only autosaves must still have metadata and a listable verified recovery preview. A saved GameState already contains its Blueprints; never split their authority across stores. All writes perform revision/fencing checks and update slotMeta atomically with affected records. Use an immutable operation token so cancelled async preparations cannot write after the user changes session. Persist a locator only in the same transaction as its referenced envelope. Choose latest valid recovery by captureSequence, not timestamp. On delete, remove slot, rotations and metadata in one transaction after confirmation; no related slot is touched.

UI acquires a Web Lock named `overclock-slot:<slotId>` before an active writable session. While another tab holds it, offer read-only listing/export or a new slot; no force takeover/lease timeout. Missing Web Locks capability means no multi-tab writable session in supported production mode: show a capability error rather than fall back to an unsafe lock. On acquiring a lock, increment stored writerEpoch and bind Worker writes to it. Each mutation checks writerEpoch plus expected revision in the transaction. Old Worker messages from a released session cannot commit even if delivered late. Import overwrite/delete of an actively simulated slot is rejected with SLOT_ACTIVE; offer a new slot or explicit close of the active run first. Repository mutations for inactive slots acquire the same short-lived Web Lock before preparing the revision-bound transaction. Switching active slots uses nonblocking lock acquisition for the destination: if unavailable, retain the current session; if candidate load fails, release the destination lock and retain the old lock/core; only successful promotion releases the old slot lock. The UI holds the active lock until its Worker stops; tab death releases it through platform lifecycle. Test two real browser contexts/tabs.

Observe versionchange by closing connections and blocking further mutations until reopened. blocked upgrades show an actionable close-other-tab message. Aborted upgrades preserve prior stores. Never delete the database to recover an upgrade error. No async crypto or arbitrary await inside a live IDB transaction. Handle QuotaExceededError, AbortError and version errors with typed failures. A successful request is not a durable-save acknowledgment; wait for oncomplete. Browser transaction completion is the application durability boundary, not an absolute guarantee against hardware/browser data loss. No claim of cloud backup or durable writes during abrupt page close.

## 11. Autosave, transition facts and recovery

Autosave every 60 seconds of foreground monotonic time when capture generation is dirty. Dirty means committed gameplay/clock state, queue sequence, settings or local stats changed since last committed capture. Commands and counters at the same simulation tick can be dirty. Do not hash all state every tick to detect it. Private host generation increments on successful operations and relevant host metadata changes.

Coalesced transition requests follow committed Task completion, Research completion, Benchmark start/terminal, year transition and vertical-slice completion. Observe actual pre/post committed lifecycle summaries through the read-only projection boundary, without changing simulator stages or relying on semantic UI event delivery. Every successful durable distinct capture increments captureSequence. In one transaction insert the new autosave, prune older than the newest three for that slot, update locator/meta. Failed write changes none of those. Keep 0/1/2 records until three distinct successes exist; thereafter retain exactly three. Manual saves do not count as a rotation. If multiple triggers hit the same capture generation, combine reasons and save once. When unchanged successful no-op commands still consume nextQueueSequence, queue metadata makes that boundary a distinct capture generation; timestamps alone never create a rotation. One write plus one newest pending capture request; no unbounded save queue. Visibility hide requests one best-effort dirty save without waiting indefinitely. It is not a guarantee against forced close.

Refinement of old TDD: save at Benchmark start and terminal result/cancellation, not an unimplementable guaranteed instant before every possible fatal/failure. Full-state pre-tick buffering on every Benchmark tick is prohibited. A lifecycle fatal is never a valid autosave trigger. Old durable records remain available after corruption or quota failure.

Recovery: user chooses Recover; terminate/disconnect failed Worker, reject pending promises as outcome-unknown, acquire/retain writer ownership, increment epoch, read newest locator and reverify checksum/schema/content/full production admission. If corrupt, try older autosave generations then latest valid manual save in captureSequence order. Report skipped corrupt generations without deleting them. If none works, remain in failure UI and offer import/new slot. Recovery restores GameState, RNG and nextQueueSequence exactly, clears private caches via fresh core, publishes full snapshot, and waits for Continue. It does not reconstruct transport requests after the durable boundary. Display recovered tick/year and the last-known live tick if available as a possible-loss interval; do not promise exact loss when Worker response was unknown.

Replay resume artifact remains a separately verified exact-log-bound in-memory object. Do not store it as the save payload or trust an artifact's hash as proof of a durable slot. Mid-Replay continuation test takes a quiescent operation boundary, saves GameState+queue sequence, reconstructs a fresh core and applies the exact suffix operations, comparing outcomes/final state/RNG. Keep original Replay version and verification semantics unchanged.

## 12. Local reports and minimal browser surface

Report exact schema: reportVersion 1, random external reportId, appVersion, contentVersion, category (`manual`/`fatal`/`recovery`/`storage`), safe errorCode or null, tick/year or null, timestamp metadata, allowlisted counter snapshot, bounded numeric duration summary, and boolean capabilities (worker/indexedDB/crypto/gzip/webLocks). Maximum 64 KiB/report, 20 reports total; insert/prune atomically by repository sequence. No free text, seed, command payload, raw GameState, blueprint/system name, file name/path, stack trace, URL, user agent, CPU model, device identifier, or personal identifier. No automatic upload, network request or analytics. Copy/export report only on explicit user action; list/delete/clear locally. Diagnostic benchmark tooling may log host CPU separately; browser playtest reports may not.

Minimal shell controls: new game/Continue, pause/speed, connection/saving/error indicators, save/load slot list, import preview with destination/overwrite/settings confirmation, export, delete confirmation, recovery choice and report list/delete. Use existing React shell and RO/EN localization. No final dashboard/layout redesign, gameplay grid interaction, chart or Research UI. Fake client remains available only for isolated shell tests/stories; production must initialize the real client. A production test harness may drive public APIs from Playwright without importing devtools into the bundle.

## 13. Performance, fixtures and compatibility

All new numbers are planning acceptance targets, not measured achievements. Use i7-2600/GTX1050/8 GB/Windows10 and the repository's pinned Chromium for gating. Report CPU/OS/Node/browser/build, visibility, power mode and concurrency. Non-target results are informative only. The owner-authorized pre-existing pure Benchmark miss remains labelled as such.

Fixtures:

- N, normal persistence/bridge fixture: reuse the audited 24x16 >=75% occupied production fixture, active thermal/Power/Compute, two configured Tasks and Boost where legal; add active Research in a compatible scenario, 8 valid Blueprints and representative Benchmark/history. No mutually exclusive workloads. Expected payload <=2 MiB; if real fixture exceeds it, report and revisit budget class rather than deleting work to fit.
- L, large-state fixture: reuse existing 128-Blueprint stress fixture plus valid histories within 16 MiB. Test cold load/replacement separately.
- A, adversarial byte/depth/count/decompression limits; no realistic-performance claim from rejected tiny inputs.

| Path                                         | Target-host p95 budget    | Measurement                                                |
| -------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| Existing direct production tick              | <4 ms                     | Unchanged Phase 1 fixtures/gates                           |
| Existing recording/playback                  | <5 ms each                | Unchanged Replay fixtures                                  |
| Pure projector warm N                        | <1 ms                     | 500 samples, 100 warm-up                                   |
| Project + encode ordinary publication N      | <2 ms                     | 500/100; exclude sim tick but report combined separately   |
| Combined Worker tick with due projection N   | <6 ms                     | 500/100; retain direct <4 ms separately                    |
| Idle transport round-trip, ordinary <=64 KiB | <10 ms                    | 200/20 real browser samples                                |
| Command visible latency foreground N         | <200 ms                   | 200 actions; includes 10 Hz publication cap                |
| Canonical payload encode N                   | <40 ms                    | 200/20; includes detached capture separately in save total |
| SHA-256 N                                    | <20 ms                    | 200/20, actual bytes recorded                              |
| Gzip encode/decode N                         | <100 ms each              | 200/20; report compression ratio                           |
| Save N, capture to IDB oncomplete            | <250 ms                   | 200/20 including validation/serialization/hash/storage     |
| Autosave N including rotation                | <250 ms                   | 200/20, three retained generations                         |
| Load N to first full READY                   | <500 ms                   | 200/20, parsing/admission/core/projector included          |
| Import N to verified preview                 | <1000 ms                  | 200/20 including decode/migration/admission                |
| Confirm import to commit N                   | <250 ms                   | 200/20, preparation/transaction honestly separated         |
| Recovery N after user action                 | <1500 ms                  | 50/5; cold Worker launch + DB verification + READY         |
| Large L save/load/import/recovery            | report-only               | 50/5; no concealment in setup                              |
| Main-thread client processing                | <5 ms p95 per publication | 500/100; no persistence JSON parse on main thread          |

Cold initialization, compression, resync, quota/error, migration and large-state paths have separate rows. No JIT/fixture setup inside measured warm samples, but no required operation hidden as setup. At final integration run a 60-minute soak: bounded queues/listeners/import candidates, no retained Worker after destroy, no monotonic memory leak; report measured memory and compare with TDD's <500 MB target rather than manufacturing a portable exact-memory assertion. At least 20 mount/destroy cycles with event/timer cleanup proof. No timeout/threshold/sample reduction to get a pass. Calibration failures require measured optimization or explicit owner decision.

Frozen vectors: milestone completion 30270; year transitions 12000/24000; RNG 1853565737; state 43f71088b7b8afe6; Replay a1a59919e8295897; report f2be68edc3374681; comparison 957959d2decef0e1. Preserve all other published vectors. Add save canonical UTF-8/digest vectors (ASCII and Romanian/Unicode), migration v0->v1 vector and host-operation parity traces. Golden expectations must be independently calculated or reviewed, not copied from failed actual output.

## 14. Documentation and verification policy

New ADRs, using next free IDs at execution: persistence/codec/migrations; repository/concurrency/autosave; presentation/patch ownership; Worker protocol/scheduler/client; recovery/reports. Each explicitly identifies refined unimplemented TDD/type sketches and preserves Phase 1 semantics. Update active phase outline, TDD status/API sections, PROJECT_STATUS, README and permanent `docs/diagnostics/PHASE_2_*.md` instructions with commands, fixtures, sample counts, host labels and results. Keep GDD gameplay and both Word documents unchanged except narrowly linked roadmap clarification if genuinely necessary; no broad rewrite.

Each Luna subtask runs its focused tests and applicable AGENTS gates: typecheck, unit/integration selection, content validation, build, lint/format check, diff check. Full `pnpm test` twice belongs at independent checkpoint boundaries, not every small subtask. Real browser tests begin as soon as browser behavior exists. No meaningless implementation-mirroring tests. Use parameter tables and shared realistic fixtures. Review accumulated diff ownership each subtask; do not repeat network synchronization or whole-history audit unnecessarily.

At a checkpoint, Sol High reviews all group changes independently, reproduces suspicious cases, fixes in-scope findings, then validates the final candidate. Long Phase 1 diagnostics rerun based on changed dependencies; the final Phase 2 closure matrix includes all permanent diagnostics. Preserve exact-100 existing repetitions. Host parity/serialization tests use explicit deterministic clocks/IDs. E2E uses actual Chromium Worker, IndexedDB, native crypto/compression and two tabs. Test doubles supplement, never replace, those tests.

## 15. Ordered decomposition and checkpoint map

| Group   | Subtasks                                                                                         | Deliverable                  | Checkpoint |
| ------- | ------------------------------------------------------------------------------------------------ | ---------------------------- | ---------- |
| Task 16 | 16.1 contract/schema; 16.2 strict state admission; 16.3 codec/migration; 16.4 vectors/diagnostic | Safe detached durable bytes  | CP16       |
| Task 17 | 17.1 IDB transactions; 17.2 slots/rotation/concurrency; 17.3 import/export; 17.4 browser faults  | Atomic durable repository    | CP17       |
| Task 18 | 18.1 projector/API; 18.2 patch generation; 18.3 selectors/store primitives                       | Owned presentation pipeline  | CP18       |
| Task 19 | 19.1 strict wire; 19.2 host/scheduler; 19.3 publisher/client; 19.4 real Worker integration       | Live real bridge             | CP19       |
| Task 20 | 20.1 save/autosave integration; 20.2 load/recovery; 20.3 reports/minimal shell                   | Usable durable browser loop  | CP20       |
| Task 21 | 21.1 parity/adversarial/soak; 21.2 budgets/docs/final evidence                                   | Phase 2 acceptance candidate | CP21       |

20 implementation subtasks, six independent group checkpoints, one final read-only closure audit. Every parent group remains uncommitted until its checkpoint. No phase-wide giant uncommitted diff. Use new chat at each checkpoint, model Sol High. Use Luna xhigh for the individual subtask prompts; no model benchmarking claim is implied.

Dependency map: `Phase 1 -> 16 -> CP16 -> 17 -> CP17 -> 18 -> CP18 -> 19 -> CP19 -> 20 -> CP20 -> 21 -> CP21 -> closure`. Conceptually 18 depends on Phase 1 and accepted Task16 contracts, while 17 is independent of selectors; use the linear order above to avoid concurrent edits and simplify Luna handoffs. No checkpoint authorizes the next phase.

At Task16.1 copy this artifact into the recommended docs path without rewriting its decisions. Record each successful checkpoint's exact full SHA in permanent status; subsequent prompts derive their base from that verified checkpoint, never an invented future SHA. A commit cannot contain its own final SHA, so a reviewed documentation-only follow-up may record the prior checkpoint SHA. At the next group entry, require that checkpoint to be an ancestor of clean synchronized HEAD, review and allowlist every intervening commit, and record the actual HEAD as the new group's immutable implementation base. Do not mistake a historical pre-repair audit verdict for the later certified checkpoint. Maintain one temporary `docs/status/PHASE_2_TASK_<N>_WORKING_STATUS.md` per active group with base SHA, reviewed paths, completed subtasks, tests and exact next subtask. Merge useful evidence and remove that file at its checkpoint.

## 16. Copy-ready implementation prompts

Each block is standalone when this artifact is attached or already saved at the indicated repository path. Read the cited contract sections; they contain the concrete schemas, limits and acceptance rules. Do not execute later subtasks from the same artifact automatically.

### Prompt 16.1: Persistence contract and exact schema foundations

```text
Implement OVERCLOCK Phase 2 Task 16.1: Persistence contract and exact schema foundations.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8, 9, 13, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require clean HEAD = origin/main = remote main = 00acd280d195f23e6f0beca9560998090b117a5c and ahead/behind 0/0. Fetch once to confirm. Preserve any unexpected local work and stop rather than resetting it.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Copy the approved artifact into docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md. Create the persistence ADR and narrow exact runtime schemas for envelope metadata, execution boundary, settings, local stats, preview and sanitized reports. Refine the existing SavePayloadV1 type with schemaVersion/fingerprint/execution without changing GameState. Define typed error outcomes and resource constants. Document synthetic v0 provenance and field-level migration intent.

Expected edit boundary and source inspection:
src/save/contracts.ts, new save schema/limit modules, docs and focused schema tests. Inspect existing save interfaces and current content version before editing.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Unknown keys, wrong discriminants, enum/volume/counter ranges, ISO validity, -0 sequence, mismatched outer/inner versions, historical-state schema policy and descriptor-safe entry checks. Golden settings defaults. Confirm GameState hash is unchanged.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Typecheck/content/build and focused schemas; inspect Phase 1 initial-state compatibility. No performance claim in this foundations task.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No codec, full state admission, IndexedDB, Worker, projector, migration execution or gameplay changes.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_16_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 16.2: Strict full-state admission and safe resource traversal

```text
Implement OVERCLOCK Phase 2 Task 16.2: Strict full-state admission and safe resource traversal.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8.1, 8.2 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 16 base SHA in docs/status/PHASE_2_TASK_16_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 16.1 completed its recorded gates and every accumulated path belongs to this Task 16 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement bounded descriptor traversal and strict nested external GameState schemas covering every current branch and each kind-specific draft/history shape. Reuse existing domain validators after exact shape admission, then fresh production construction/getStateForSave with saved queue sequence. Keep structural historical records distinct from current-state validation. Produce a schema coverage table keyed to src/sim/core/types.ts. No unknown stripping, value normalization or repair of malformed content.

Expected edit boundary and source inspection:
src/save validation modules, existing public validators only for necessary safe reuse, tests/helpers and corruption fixtures. Read Phase 1 state types and all applicable historical/content validators.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Every top-level branch, extra nested keys, getters with zero invocation, prototypes, symbols, sparse arrays, cycles, depth/node/string limits, unsafe ticks, impossible Campaign years, contradictory same-generation results, valid historical results, draft Undo/Redo and incompatible historical Blueprints. Valid milestone and dense fixtures admit unchanged. Rejected admission never mutates source.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Focused save/Campaign/Replay/domain admission tests and compatibility vectors. Measure admission on normal/large fixtures as preliminary report-only evidence; preserve real data.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No codec/DB/migration writes, no recursive full-state validation on ordinary ticks, no historical result recalculation or GameState version changes.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_16_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 16.3: Canonical save codec and copy-only migration

```text
Implement OVERCLOCK Phase 2 Task 16.3: Canonical save codec and copy-only migration.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8.3, 9 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 16 base SHA in docs/status/PHASE_2_TASK_16_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 16.2 completed its recorded gates and every accumulated path belongs to this Task 16 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement bounded strict duplicate-key-aware byte parsing, canonical UTF-8 encoding, SHA-256 checksum coverage, none/gzip encoding, strict base64 and streaming bounded decompression. Reject checksum mismatch before payload parsing. Implement sequential migration registry and the specified synthetic v0-to-v1 migration without modifying GameState or queue metadata. Return owned verified payload/preview without storage side effects. Inject crypto/compression adapters for tests, use native browser primitives in production-facing adapters.

Expected edit boundary and source inspection:
src/save codec/migrations modules and fixtures; preserve existing canonicalSerialize/FNV implementation. Read native API error behavior before using it.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
ASCII/RO/Unicode golden bytes and independently verified digest, unknown/future versions, duplicate keys, malformed UTF-8/base64/gzip, trailing bytes, checksum mismatch, depth/count limits, decompression bomb cap/cancel, v0 migration success/failure/copy ownership and unchanged state hash. Gzip decompressed canonical bytes match none.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Codec/migration/corruption tests, focused Replay canonicalization regressions and type/build gates. Report encode/hash/gzip times on actual N/L bytes; no target claim on non-target host.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No IndexedDB, import confirmation UI, Worker host or change to Phase 1 Replay format. No unbounded decompression followed by an after-the-fact size check.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_16_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 16.4: Save vectors, diagnostic and codec checkpoint preparation

```text
Implement OVERCLOCK Phase 2 Task 16.4: Save vectors, diagnostic and codec checkpoint preparation.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8, 9, 13, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 16 base SHA in docs/status/PHASE_2_TASK_16_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 16.3 completed its recorded gates and every accumulated path belongs to this Task 16 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Audit Task16 public entry paths, complete positive and adversarial coverage, and build the permanent save-codec diagnostic using N/L/A fixtures. Freeze accepted canonical payload/SHA/migration vectors in reviewed tests. Add browser-native crypto/compression coverage using the existing test infrastructure without exposing a production debug API. Finalize the persistence ADR and schema coverage table.

Expected edit boundary and source inspection:
Task16 accumulated diff, codec diagnostics, docs/diagnostics/PHASE_2_SAVE_CODEC.md, tests. Do not widen earlier APIs without showing the concrete gap.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Execute all Task16 tests, Phase1 compatibility, browser-native codec round-trip, limits and cancellation. Audit sources for any unchecked cast that bypasses actual runtime shape validation.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Run relevant full unit/format/lint/typecheck/content/build gates and save-codec performance. Record sample sizes and host, merge useful handoff into permanent docs where possible. Leave working status until CP16.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
Do not begin Task17 or checkpoint yourself. No fixture/sample/limit weakening to improve results.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_16_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 17.1: IndexedDB schema and atomic repository core

```text
Implement OVERCLOCK Phase 2 Task 17.1: IndexedDB schema and atomic repository core.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 10 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require the successful CP16 full SHA recorded in permanent status to match clean HEAD, origin/main and remote main, ahead/behind 0/0. Fetch once. Verify that checkpoint covers all previous group subtasks. Stop on unexplained divergence; never invent a future SHA.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement the version-1 database/stores and typed repository core with injected IDB boundary. Prepare verified canonical envelopes before readwrite transactions. Store previews/slotMeta and use expected revisions plus writerEpoch fencing on every mutation. Resolve success only on transaction completion. Implement open/blocked/versionchange/upgrade-abort handling, keeping existing data intact.

Expected edit boundary and source inspection:
src/save/repository modules and focused integration tests. Reuse Task16 verified payload/codec; no alternative serializer.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Open/upgrade, request success followed by abort, read/write/delete atomicity, CAS failure, stale writerEpoch, quota/abort errors and prior data preservation. Use real Chromium IDB for transaction-lifetime cases.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Repository focused tests, real-browser IDB smoke, typecheck/content/build/lint/format. Measure isolated transaction latency separately from preparation.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No autosave scheduling/rotation yet, import UI, Worker host or silent database deletion. No awaited crypto/compression inside a transaction.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_17_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 17.2: Slot operations, three rotations and writer exclusion

```text
Implement OVERCLOCK Phase 2 Task 17.2: Slot operations, three rotations and writer exclusion.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 10, 11 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 17 base SHA in docs/status/PHASE_2_TASK_17_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 17.1 completed its recorded gates and every accumulated path belongs to this Task 17 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement manual slot create/list/read/delete, monotonically sequenced capture metadata and atomic autosave insertion/pruning to newest three. Add Web Lock acquisition/release adapter and fencing integration, with no unsafe fallback. Cap slots at20; preserve per-slot isolation. Expose clear read-only/busy behavior for a second tab. Settings store writes have their own revision CAS.

Expected edit boundary and source inspection:
Repository, external lock adapter, browser tests, schema documentation. Keep timer-based trigger logic deferred to20.1.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
0/1/2/3/4 successful captures, failure during insert/prune, manual-save independence, timestamp reversal, stale revision after preview, two tabs, lock release after tab close, stale Worker epoch after takeover, deletion rollback and versionchange closure.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Focused repository and real two-tab browser tests; codec regression selection. Measure rotation total with prepared envelopes; report commit/preparation boundaries.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No silent cross-tab overwrite, fake rotations, time-based lease takeover, gameplay changes or autosave timer.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_17_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 17.3: Verified import preview, confirmation and export services

```text
Implement OVERCLOCK Phase 2 Task 17.3: Verified import preview, confirmation and export services.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 9, 10 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 17 base SHA in docs/status/PHASE_2_TASK_17_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 17.2 completed its recorded gates and every accumulated path belongs to this Task 17 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement read-only preview service with one expiring owned candidate, token binding, current content compatibility, new-slot default and explicit overwrite revision. CONFIRM consumes the candidate once and commits atomically. Applying imported settings is explicit and transactionally coordinated; source bytes remain unchanged. Export reads a verified committed generation without updating its timestamps or contents. Load admission service returns an isolated candidate, not a live mutation.

Expected edit boundary and source inspection:
src/save/export/import services, repository adapters, tests; UI dialogs and live host promotion remain20.x.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Preview no writes, malformed imports, candidate substitution, stale/expired/consumed token, changed content fingerprint, destination race, overwrite refusal, settings default preservation, migration on a copy, quota error, export byte/source immutability, large input bounds.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Codec/migration/repository integration regressions. Measure preview and confirm separately with end-to-end input sizes. Document typed errors for future client.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No active-core replacement, automatic overwrite, file-path logging or global DOM integration.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_17_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 17.4: Browser persistence fault matrix and checkpoint preparation

```text
Implement OVERCLOCK Phase 2 Task 17.4: Browser persistence fault matrix and checkpoint preparation.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 9, 10, 13, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 17 base SHA in docs/status/PHASE_2_TASK_17_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 17.3 completed its recorded gates and every accumulated path belongs to this Task 17 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Complete real Chromium coverage for transaction abort, quota fault injection, upgrade/versionchange, two-tab writer exclusion, import confirmation races and three-rotation integrity. Add persistent repository diagnostics that include preparation and commit separately and end to end. Finalize repository ADR and permanent instructions.

Expected edit boundary and source inspection:
Task17 accumulated diff and browser/performance tests; fault injection adapters remain test-only and absent from production bundle.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Reload actual browser DB and verify stored bytes/checksum/full-state admission; failure paths preserve prior slots; no test merely asserts mock call counts. Confirm clipboard/file download tests use owned artifacts.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Task16/17 tests, existing shell E2E, validate and N/L repository timings on actual host. Record unsupported environment as a blocker rather than skip/pass.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
Do not begin Task18 or commit; do not replace real browser evidence with only fake IndexedDB.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_17_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 18.1: Pure presentation projector and owned SimCore read boundary

```text
Implement OVERCLOCK Phase 2 Task 18.1: Pure presentation projector and owned SimCore read boundary.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 4, 7.1 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require the successful CP17 full SHA recorded in permanent status to match clean HEAD, origin/main and remote main, ahead/behind 0/0. Fetch once. Verify that checkpoint covers all previous group subtasks. Stop on unexplained divergence; never invent a future SHA.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement neutral VM contracts and a pure projector with explicit source mapping for every field. Add a narrow internal SimCore presentation method returning owned VMs without exporting GameState references or calling getStateForSave on each publication. Refine placeholder nullable fields and adapt fake client/current shell. Reuse existing pure eligibility/phase progress rules. Keep live/draft geometry and live-only physics distinguishable.

Expected edit boundary and source inspection:
src/sim/selectors, narrow SimCore read method, app snapshot type re-exports, fake client/shell typing and tests. Read stored Compute/Power/Task/Research output semantics first.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Initial/active/completed/history state, draft-only modules, rotated footprints, mean/max temperature, stale selection, nullable unknown forecasts/memory/data usage, actual content labels, no input mutation, detached results and no hash/RNG changes. Every required VM field has a source-table entry.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Focused projector/core/domain read regressions, compatibility vectors and normal build gates. Preliminary projector N/L timings.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No browser imports in sim, gameplay recomputation, fake forecasting, new event stages, chart history or storage changes.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_18_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 18.2: Revision-aware grid and heatmap patch production

```text
Implement OVERCLOCK Phase 2 Task 18.2: Revision-aware grid and heatmap patch production.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 7.2 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 18 base SHA in docs/status/PHASE_2_TASK_18_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 18.1 completed its recorded gates and every accumulated path belongs to this Task 18 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement private presentation revision state, full/delta grid publications, deterministic upsert/remove order and exact base/next revision checks. Track acknowledged thermal values and cumulative dirty-epsilon drift. Full resync on mode/dimension/load epoch change. Keep produced VM values owned; no typed scratch array leaks. Never add presentation revisions to GameState.

Expected edit boundary and source inspection:
Neutral projection/patch modules and unit tests; use a deterministic acknowledgement harness, not a real Worker yet.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Apply/remove/Undo/Redo, changed draft revision with stable liveLayoutRevision, no-change identities, all384 tiles, sub-epsilon cumulative drift, dropped patch/wrong base, delayed ACK/coalescing, full resync exact values and output scratch isolation.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Projector/patch tests, Design/thermal regression selection and diff/type/build gates. Measure no-change versus all-dirty N paths without changing fixture.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No renderer work, thermal rounding/state mutation, unbounded patch history or direct React tile subscriptions.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_18_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 18.3: Immutable store/selectors and projection checkpoint preparation

```text
Implement OVERCLOCK Phase 2 Task 18.3: Immutable store/selectors and projection checkpoint preparation.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 7, 13, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 18 base SHA in docs/status/PHASE_2_TASK_18_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 18.2 completed its recorded gates and every accumulated path belongs to this Task 18 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement GameClientStore primitives with atomic UI/grid publication, stable getSnapshot references, selector equality/subscription cleanup and explicit connection status. Build a fake transport adapter for tests while preserving real transport work for Task19. Freeze the source mapping table, document nullable VM interface changes and finalize presentation ADR/diagnostic.

Expected edit boundary and source inspection:
src/app/game-client store/selectors/hooks, neutral contracts and tests. No actual Worker startup or persistence UI.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Unchanged section reference reuse, multiple selectors, unsubscribe/reentrant listeners, callback exceptions isolated from authority, stale epoch/base resync request, atomic publication,20 mount/unmount cycles and no per-tile React subscription path.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
All Task18 tests, current shell E2E, validate, warm projection/publication budgets. Leave group uncommitted for independent CP18.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No optimistic gameplay mutation, full dashboard redesign, chart UI or checkpoint commit.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_18_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 19.1: Strict Worker wire schemas and request correlation

```text
Implement OVERCLOCK Phase 2 Task 19.1: Strict Worker wire schemas and request correlation.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 5.1 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require the successful CP18 full SHA recorded in permanent status to be an ancestor of clean, synchronized HEAD, origin/main and remote main, ahead/behind 0/0. Fetch once. Inspect every commit after CP18: only the reviewed documentation-only CP18 entry reconciliation is permitted before Task 19. Verify CP18 covers all Task 18 subtasks and record the actual current HEAD as the immutable Task 19 implementation base in the group working status. A local checkout on a divergent pre-repair branch does not satisfy this preflight. Stop on unexplained divergence; never invent a future SHA.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Replace contract-only wire unions with versioned exact schemas, ordinary/import payload limits, epoch and monotonic sequence validation, typed request/result/error bodies and bounded outstanding requests. Implement sender ownership checks before postMessage and receiver validation afterward. Define adapters preserving commandId while correlating by epoch/requestSequence.

Expected edit boundary and source inspection:
src/app/worker protocol modules and GameClient transport types/tests. Import existing SimCommand/CommandResult validators where appropriate.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Unknown kind/version/keys, stale epoch, duplicate/gap sequence, malformed command versus domain rejection, getters before clone, binary ownership/byte limits, max pending queue, sequence exhaustion and mismatch between request and returned commandId.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Protocol/property table tests, command parsing regressions, typecheck/content/build/lint/format and production forbidden-import scan.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No Worker loop, save writes, domain-command schema changes, production STEP_DEBUG or automatic resend.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_19_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 19.2: Serial SimWorkerHost and fixed-step scheduler

```text
Implement OVERCLOCK Phase 2 Task 19.2: Serial SimWorkerHost and fixed-step scheduler.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 4, 5.2, 6 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 19 base SHA in docs/status/PHASE_2_TASK_19_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 19.1 completed its recorded gates and every accumulated path belongs to this Task 19 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement a browser-independent host class with injected monotonic clock/timer/transport around createProductionSimCore, plus the dedicated Worker bootstrap. Serialize command-only operations, clock commands, ticks and barriers. Implement25ms wake,100ms fixed ticks, speed1/2/4,20-tick cap, hidden/long-gap/maintenance holds and explicit continue. Validate bundled content and handshake fingerprint. Fatal errors stop admission/scheduling while preserving actual core commit semantics.

Expected edit boundary and source inspection:
src/app/worker host/scheduler/bootstrap and focused tests; browser APIs stay in adapters outside src/sim.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Manual-clock exact schedules, elapsed interval at speed change, paused commands, no step0 drain confusion, max burst and gap discard, hidden/resume, queue-empty capture point, invalid command versus fatal, prior-tick commits and no RNG/time imports into sim. Trace host operations for replay comparison.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Host tests and ADR0003/Campaign/Replay regressions; browser Worker initialization smoke. Report host scheduling overhead separately from direct tick.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No Offline Assist, variable dt, direct state writes, persistence orchestration, fake domain outcomes or unbounded timers.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_19_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 19.3: Real GameClient, publication backpressure and transport facts

```text
Implement OVERCLOCK Phase 2 Task 19.3: Real GameClient, publication backpressure and transport facts.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 5, 7, 11 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 19 base SHA in docs/status/PHASE_2_TASK_19_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 19.2 completed its recorded gates and every accumulated path belongs to this Task 19 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Connect real GameClient to Worker with promises, lifecycle/heartbeat handling, stable store updates, one in-flight publication plus latest pending state, ACK/resync and bounded result/fact channels. Expose limited committed fact observer for later autosave/local stats, without new semantic gameplay stages. Replace production fake-client wiring with real initialization while preserving minimal shell behavior.

Expected edit boundary and source inspection:
GameClient/store, Worker publisher/fact adapter, existing shell provider and RO/EN connection/error strings. No full persistence control panel yet.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Command result exactly once, late response epoch discard, outcome-unknown timeout without resubmit, stalled ACK bounded allocation, critical fatal bypass, dropped/wrong-base patch full resync, listener throws, heartbeat hidden/maintenance policy and destroy cleanup.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Real browser command/snapshot smoke, protocol/store/host regressions and latency/publication measurements; compatibility unchanged.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No gameplay alerts/forecast systems, DB trigger scheduling, chart arrays in GameState or renderer overhaul.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_19_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 19.4: Worker parity and lifecycle checkpoint preparation

```text
Implement OVERCLOCK Phase 2 Task 19.4: Worker parity and lifecycle checkpoint preparation.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 5, 6, 7, 13, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 19 base SHA in docs/status/PHASE_2_TASK_19_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 19.3 completed its recorded gates and every accumulated path belongs to this Task 19 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Build real Chromium Worker integration tests using the same host with a test-only manual scheduler. Compare identical ordered operation traces against direct production core: receipts/results, ticks, RNG and final hashes. Cover fatal/lifecycle teardown and full resync. Finalize Worker/scheduler ADR and diagnostics. Test-only hooks must be excluded from production bundle.

Expected edit boundary and source inspection:
Task19 tests/diagnostics/docs plus necessary in-scope fixes; inspect the complete accumulated diff.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Mixed accepted/rejected commands, clock operations, pauses/speeds, both year boundaries, Task/Research/Benchmark/Blueprint scenarios, delayed publications, crash/error/messageerror and20 destroy cycles. Compare after explicit operation barriers, not sampled wall-clock times.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
All Task19 tests, affected Phase1 exact determinism, shell/Worker E2E, validate and direct/combined Worker/message/publication budget measurements.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No new gameplay semantics or Task20 features; do not commit or claim full persistence recovery exists.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_19_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 20.1: Worker save barriers and autosave orchestration

```text
Implement OVERCLOCK Phase 2 Task 20.1: Worker save barriers and autosave orchestration.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8.1, 10, 11 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require the successful CP19 full SHA recorded in permanent status to match clean HEAD, origin/main and remote main, ahead/behind 0/0. Fetch once. Verify that checkpoint covers all previous group subtasks. Stop on unexplained divergence; never invent a future SHA.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Wire repository/codec services into the serial Worker host. Capture exact empty-queue state+next sequence synchronously, then prepare/commit with operation-token and fencing checks. Track dirty capture generation including command-only/settings/stats changes. Implement60s foreground trigger, coalesced lifecycle triggers and one in-flight plus latest pending save. Publish success only after IDB completion, keeping scheduler maintenance time excluded.

Expected edit boundary and source inspection:
Worker persistence coordinator, fact observers, repository integration and tests; reuse existing capture/codec and do not duplicate schemas.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Same-tick command-only saves, queue sequence continuity, visibility best effort, pause/unpause, task/research/benchmark/final trigger coalescing, three rotations, quota failures, cancellation before transaction versus after commit, stale writer epoch and progress during pending save.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Save/rotation/host tests, affected benchmark/Task/Research regressions, real browser save/reload smoke and end-to-end N save/autosave<250ms measurements.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No whole-state hash per tick, automatic fatal-state save, guaranteed unload durability or early recovery UI.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_20_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 20.2: Atomic live load and durable Worker recovery

```text
Implement OVERCLOCK Phase 2 Task 20.2: Atomic live load and durable Worker recovery.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 5.2, 9, 11 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 20 base SHA in docs/status/PHASE_2_TASK_20_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 20.1 completed its recorded gates and every accumulated path belongs to this Task 20 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement candidate core preparation/promotion, new-epoch full publication and scheduler hold after load. Implement explicit recovery from newest verified durable generation with fallback to older valid records and manual save. Reject old pending requests as session-replaced/outcome-unknown; never replay them automatically. Expose recovered checkpoint/possible-loss information without deleting corrupt originals.

Expected edit boundary and source inspection:
Host lifecycle/recovery coordinator, persistence locator validation, client status and browser tests. Preserve ADR0022 candidate ownership and Phase1 Replay resume boundaries.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Crash before/after transaction completion, corrupted latest autosave fallback, all-corrupt failure, stale post-recovery replies, duplicate buy avoidance, failed candidate leaving old authority intact, queueSequence continuation, unchanged RNG, same-tick capture, load unpaused save held without changing its hash.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Recovery/load tests and real browser Worker termination/restart; affected Replay/resume/Campaign regression sets. Measure cold N recovery<1500ms and load<500ms including all required work.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No in-memory Replay artifact as durable authority, pending-command reconstruction, hidden retries, Campaign normalization or automatic Continue.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_20_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 20.3: Local reports and minimal persistence browser controls

```text
Implement OVERCLOCK Phase 2 Task 20.3: Local reports and minimal persistence browser controls.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 9, 12, 14 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 20 base SHA in docs/status/PHASE_2_TASK_20_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 20.2 completed its recorded gates and every accumulated path belongs to this Task 20 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement bounded sanitized local report schema/store and explicit list/delete/export controls. Add minimal localized UI for new/continue/pause/speed, save/load, verified import preview and overwrite/settings confirmation, export/delete and recovery. Use public GameClient/services only. Finalize recovery/report ADR and ownership documentation. Preserve Phase0 visual shell without implementing Phase3/4 gameplay screens.

Expected edit boundary and source inspection:
Existing React shell, GameClient service interfaces, reports storage and RO/EN strings/tests. Reuse confirmed import token flow and writer lock state.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Real UI import cancelled/confirmed/stale overwrite, source artifact unchanged, current settings preserved by default, quota/error/recovery messaging,20-report pruning, sensitive-field rejection, no network analytics and no raw error stack/path leakage. Keyboard-accessible visible controls and existing shell E2E.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
All Task20 browser/integration tests, validate and relevant save/import/recovery performance. Leave complete group uncommitted for CP20.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No Research/build/benchmark UI redesign, accounts, cloud storage, free-text reports or personal data collection.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_20_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 21.1: Cross-domain persistence parity, adversarial matrix and soak

```text
Implement OVERCLOCK Phase 2 Task 21.1: Cross-domain persistence parity, adversarial matrix and soak.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 8 through 13 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require the successful CP20 full SHA recorded in permanent status to match clean HEAD, origin/main and remote main, ahead/behind 0/0. Fetch once. Verify that checkpoint covers all previous group subtasks. Stop on unexplained divergence; never invent a future SHA.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Implement final integrated acceptance tests: save at a quiescent mid-Replay boundary, persist/read/migrate if applicable, reconstruct using captured queue sequence, replay exact suffix and compare with direct uninterrupted run. Exercise active Tasks, Research, Benchmark, Design draft/history and high-ID Blueprints in legal separate scenarios. Add complete corruption/security/concurrency/recovery matrix and 60-minute bounded-resource soak.

Expected edit boundary and source inspection:
Integration/browser/determinism fixtures and narrow bug fixes only; no new architecture or gameplay features.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Exact100 small deterministic bridge/save schedules, all Phase1 vectors, actual browser mid-Replay continuation, prototype/accessor/duplicate-key/size/decompression attacks, two tabs, upgrade/quota errors, worker crash, delayed ACKs, hash coverage, timestamp rollback and clean destroy. Fixture mutations must exercise the intended semantic guard, not just stale checksums.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Full new integration matrix plus standalone determinism, Phase1 regression suite and60-minute soak with retained-object/queue diagnostics. Investigate every reproducible deviation.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No reduced assertion/repetition/timeouts, noisy duplicated domain unit suites, synthetic mocks as sole browser evidence or checkpoint commit.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_21_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

### Prompt 21.2: Target-host budgets, permanent evidence and closure candidate

```text
Implement OVERCLOCK Phase 2 Task 21.2: Target-host budgets, permanent evidence and closure candidate.
Recommended executor: GPT Luna, reasoning xhigh. One bounded subtask only.

Read AGENTS.md and the approved docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md (or the attached identical artifact for Task16.1). Contract sections 13, 14, 15 are normative for this task. Read current public APIs before editing. Do not silently reinterpret accepted Phase1 ADRs. This artifact explicitly resolves listed Phase0 target-interface refinements; an unrelated new conflict must be reported.

Preflight and diff ownership:
Require HEAD unchanged from the Task 21 base SHA in docs/status/PHASE_2_TASK_21_WORKING_STATUS.md. Inspect git status and diff, including untracked files. Confirm 21.1 completed its recorded gates and every accumulated path belongs to this Task 21 group. Preserve those changes. No repeated fetch/full-history review is needed unless branch identity or remote state is uncertain.
Read PROJECT_STATUS and applicable ADRs, then the active group handoff if present. Do not discard, stash, reset or overwrite unrelated work.

Implementation scope:
Complete permanent Phase2 diagnostic scripts and documentation, run the unchanged Phase1 diagnostic matrix and all new N/L/A paths on the documented host, and optimize only measured in-scope costs without changing semantics. Reconcile every Phase2 acceptance item and risk disposition. Remove temporary evidence/probes from the commit candidate after consolidating useful results; keep group handoff until checkpoint.

Expected edit boundary and source inspection:
Task21 diagnostics/docs/tests and measured narrow fixes. Every Phase2 source change must have an acceptance rationale and evidence.
If another path is necessary, explain its direct dependency in the handoff; do not expand into the next subtask.

Invariants and precedence:
Preserve Phase1 GameState/Replay versions, canonical hashes, RNG, fixed tick order, Campaign equality, historical result semantics, command atomicity and private runtime evidence. UI/host metadata remains outside deterministic state. Validate external input before cloning. Own all returned data. Follow the contract's explicit ordering, failure/cancellation and ownership rules rather than guessing from old placeholder interfaces. Only the current group may extend its approved infrastructure APIs.

Required tests:
Two independent complete pnpm test processes on final code, validate, full browser suite, compatibility, exact determinism, production import/bundle scans, content/gameplay/Word drift, resource limits, cancellation and orphan cleanup. Retain pre-existing Benchmark miss as owner-accepted evidence, not a passed measurement.
Write the smallest behavioral/adversarial coverage that proves these boundaries; parameterize equivalent cases and reuse real fixtures.

Regression and performance gates:
Run all16 permanent Phase1 diagnostics plus new codec/repository/projection/worker/recovery scripts with fixed samples. Record median/p95/max, cold/large separately, all failures and isolated follow-ups. Update README/TDD/phase/status/ADRs with checkpoint-neutral facts and exact closure checklist.
Always run relevant unit/integration tests, strict TypeScript, content validation, production build, lint/format checks and git diff --check on the completed subtask. Run relevant browser tests once browser behavior exists. Reuse results of identical sub-gates; reserve duplicate complete test runs for independent checkpoints. Report host identity and classify non-target timing as informative. Never weaken fixtures, thresholds or determinism repetitions.

Forbidden scope:
No budget relaxation, disappearing samples, changing host labels to claim target status, Phase3 planning/implementation or commit.
No commit, staging or push. No Phase3 work or new gameplay.

Documentation and handoff:
Update applicable ADR/TDD/phase/status entries only for completed behavior and actual evidence. Update docs/status/PHASE_2_TASK_21_WORKING_STATUS.md with base SHA, completed task ID, exact changed paths, passed/blocked tests, API decisions, risks and exact next subtask/checkpoint. Keep permanent wording checkpoint-neutral and do not claim later work is implemented.

Final report:
1. Completed behavior and API changes.
2. Changed paths and preserved prior diff.
3. Ownership/ordering/security evidence.
4. Tests and exact commands/results.
5. Performance, host and limitations if applicable.
6. Documentation, remaining scope and next subtask.
7. Confirm all group changes remain uncommitted and no later task was begun.
Stop after this subtask; do not execute another prompt automatically.
```

## 17. Independent checkpoint prompts

Run each checkpoint in a fresh Sol High conversation after its group completes. These prompts authorize only the corresponding reviewed group commit/push, conditional on gates. They do not authorize the next group automatically.

### Checkpoint CP16

```text
Perform an independent OVERCLOCK Phase2 Task 16 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_16_WORKING_STATUS.md.
Base: 00acd280d195f23e6f0beca9560998090b117a5c. Verify it against Git rather than trusting the handoff alone. HEAD must still equal that base; the accumulated uncommitted diff must contain all and only Task 16 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
External state/schema completeness, descriptor traversal before clone, nested unknown keys, historical-record compatibility, exact SHA coverage, canonical bytes, streamed output caps, synthetic migration provenance and input ownership. Reproduce hostile inputs through public functions.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- save-codec and full-state admission diagnostics; Phase1 canonical/Replay compatibility;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: feat: add strict versioned save codec and migrations
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

### Checkpoint CP17

```text
Perform an independent OVERCLOCK Phase2 Task 17 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_17_WORKING_STATUS.md.
Base: the exact approved CP16 SHA in permanent status and the group handoff. Verify it against Git rather than trusting the handoff alone. HEAD must still equal that base; the accumulated uncommitted diff must contain all and only Task 17 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
IDB transaction lifecycle, acknowledgment only after commit, CAS and writer fencing, two-tab exclusion, atomic three-rotation pruning, preview token binding/expiry, stale destination revision, quota/upgrade failures and untouched source bytes.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- codec plus repository/rotation/import diagnostics and real two-tab Chromium tests;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: feat: add atomic local save repository and import export
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

### Checkpoint CP18

```text
Perform an independent OVERCLOCK Phase2 Task 18 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_18_WORKING_STATUS.md.
Base: the exact approved CP17 SHA in permanent status and the group handoff. Verify it against Git rather than trusting the handoff alone. HEAD must still equal that base; the accumulated uncommitted diff must contain all and only Task 18 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
Projection field truthfulness, unknown/null policy, no duplicated gameplay formulas, immutable read boundary, draft/live distinctions, epsilon against acknowledged values, removal patches, wrong-base recovery and stable selector references.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- projector/publication diagnostics and affected direct simulator/thermal regressions;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: feat: add owned presentation snapshots and revision patches
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

### Checkpoint CP19

```text
Perform an independent OVERCLOCK Phase2 Task 19 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_19_WORKING_STATUS.md.
Base: the actual synchronized Task 19 entry HEAD recorded in the group handoff. Verify it against Git rather than trusting the handoff alone. The exact approved CP18 SHA in permanent status must be an ancestor, with only the reviewed documentation-only entry reconciliation between CP18 and the Task 19 base. HEAD must still equal the recorded Task 19 base; the accumulated uncommitted diff must contain all and only Task 19 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
FIFO actual operations, clock command routing, pause/visibility/long-gap/maintenance behavior, fixed ticks and20 cap, strict epochs/sequences, request outcomes on fatal, no replay of unknown commands, ACK backpressure and no production debug entry.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- Worker latency/tick/publication diagnostics, direct/record/playback gates and real-browser parity;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: feat: add worker host and real game client
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

### Checkpoint CP20

```text
Perform an independent OVERCLOCK Phase2 Task 20 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_20_WORKING_STATUS.md.
Base: the exact approved CP19 SHA in permanent status and the group handoff. Verify it against Git rather than trusting the handoff alone. HEAD must still equal that base; the accumulated uncommitted diff must contain all and only Task 20 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
Synchronous state+queue capture, save generation/trigger coalescing, latest3 durable rotations, candidate load promotion, stale epoch fencing, actual commit versus cancellation, recovery fallback without source deletion, privacy allowlist and usable confirmation/recovery UI.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- save/autosave/load/import/recovery diagnostics plus affected Phase1 paths;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: feat: add durable autosave recovery and local reports
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

### Checkpoint CP21

```text
Perform an independent OVERCLOCK Phase2 Task 21 review and checkpoint.
Model: GPT Sol, reasoning High. Use a fresh conversation and inspect implementation independently.

Read all applicable AGENTS.md, the complete Phase2 contract at docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current status/ADRs and docs/status/PHASE_2_TASK_21_WORKING_STATUS.md.
Base: the exact approved CP20 SHA in permanent status and the group handoff. Verify it against Git rather than trusting the handoff alone. HEAD must still equal that base; the accumulated uncommitted diff must contain all and only Task 21 approved subtasks. Nothing should already be staged. Preserve unrelated work and stop on unexplained divergence.

Review every changed/untracked candidate path and the complete diff from the base. Verify source APIs, dependency directions and public input boundaries, not just the reported test counts. Focus:
Complete direct/Worker parity, durable mid-Replay suffix continuation, corruption/security matrix, production dependency separation, cleanup/soak, target-host budget provenance and truthful closure documentation.

Check the group satisfies all of its contract sections and task prompts. Review Phase1 invariants: deterministic hashes/RNG, Campaign tick/year equality, command/tick rollback, fresh/private runtime evidence, historical-result validation, immutable ownership and no browser/time/storage imports inside sim. Reproduce suspicious cases through public APIs.

Correct in-scope Critical/Important implementation or documentation findings, add focused regression evidence and rerun affected tests. Do not ask for approval to resolve already specified decisions. A new unrelated product/Phase1 semantic conflict must be reported; do not invent a compatibility exception. No fixture/assertion/timeout/repetition/threshold weakening.

Required final candidate gates:
- group focused tests and affected prior-group/domain regressions;
- complete pnpm test twice in separate processes and standalone determinism; preserve exact100 existing tests;
- corepack pnpm validate, including formatting/lint/typecheck/content/unit/build; reuse identical sub-gate results rather than separately rerun them without reason;
- relevant real Chromium E2E, corruption/failure/concurrency cases;
- all16 permanent Phase1 diagnostics and every Phase2 normal/large/adversarial diagnostic;
- compatibility vectors and applicable browser-vs-direct/save vectors;
- git diff --check, forbidden simulator API/import scan, production-to-devtools and bundle scans;
- balancing/module numeric/Word/gameplay-content drift inspection; only approved Phase2 source/docs/config differences;
- checkpoint-neutral permanent docs and exact file allowlist.

Performance must state actual host. New gating budgets require target-host evidence, never substituted faster-host results. Preserve the owner's explicit pre-existing pure Benchmark exception as a technical miss; combined/production gates and new regressions are not waived. If a new gate fails, investigate and repair. If evidence remains blocked, finish available review, report exact blocker and leave changes uncommitted.

Merge useful handoff evidence into permanent ADR/TDD/phase/status/README/diagnostic docs, remove temporary group handoff/probe artifacts from the candidate, and inspect the final diff again. Record the previous checkpoint SHA, tests and measurements without inventing the new commit SHA. Permanent descriptions must remain true after commit.

If no Critical/Important issue remains and all applicable gates pass:
1. Stage an explicit reviewed path allowlist, never blind git add -A.
2. Review staged diff and run git diff --cached --check plus focused staged smoke/strict typecheck.
3. Commit with: test: verify phase two integration and performance
4. Push to origin/main without force.
5. Verify HEAD, origin/main, remote main, ahead/behind0/0 and clean worktree. If remote changed, do not overwrite it; report the conflict and preserve local work.
6. Report full SHA, parent, subject, exact files, review findings/corrections, tests, vectors, actual performance and remaining deferred scope.

Do not begin the next task or Phase3. If publication cannot complete, distinguish a local commit from a pushed/synchronized checkpoint accurately.
```

## 18. Final read-only Phase 2 closure prompt

```text
Perform an independent OVERCLOCK Phase2 closure and Phase3 entry-readiness audit.
Model: GPT Sol, reasoning High. Planning/audit only; do not implement, edit repository files, commit, push or create the Phase3 contract.

Read every applicable AGENTS.md, docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md, current README/status/TDD/GDD roadmap, Phase2 and Phase3 outlines, all Phase2 ADRs and permanent diagnostics. Word references remain archival.

Phase1 base is 00acd280d195f23e6f0beca9560998090b117a5c. Resolve expected Phase2 HEAD from the completed CP21 report and permanent status, then fetch and verify HEAD/origin/main/remote main,0/0 and clean worktree. Audit the entire Phase1-base-to-Phase2-HEAD range, not only Task21. Identify all six reviewed checkpoint commits and each subtask's evidence. Stop on unexplained Git differences.

Audit integrated ownership across UI, GameClientStore, Worker protocol/scheduler, SimCore, projections/patches, save codec, migration, IndexedDB, autosave/import/export and recovery. Verify exactly which old Phase2 outline items were reused versus implemented. Confirm no Phase3 gameplay/rendering scope or Phase1 formula changes slipped in.

Adversarial priorities:
- untrusted nested states/accessors/prototypes/duplicate keys/byte-depth limits;
- SHA coverage before payload parse and bounded gzip expansion;
- copy-only migration and exact current content compatibility;
- preview/confirm token and destination revision races;
- transaction abort/quota/upgrade atomicity and newest3 rotations;
- two-tab writer exclusion/fencing;
- scheduler pause/speed/hidden/long-gap/maintenance semantics without Offline Assist;
- stale epoch, duplicate sequence, outcome-unknown command and no automatic retry;
- cumulative heatmap drift, ACK/backpressure, full resync and immutable selectors;
- durable recovery after worker crash and mid-Replay exact suffix continuation;
- privacy allowlist, no automatic report upload and no devtools in production.

Run correctness, determinism, browser and static checks needed to independently certify the exact HEAD. Complete pnpm test twice, standalone determinism, validate and real browser integration must have exact-HEAD evidence. CP21 evidence may be cited explicitly if it is from this exact unchanged HEAD and trusted target host; distinguish cited evidence from newly executed commands. Rerun suspicious paths and any gate lacking evidence. Review all permanent diagnostics, samples, fixture/warm-up and raw failures; run diagnostics on the available host with truthful gating classification. Do not call prior exception measurements passes.

Return READY only when no Critical/Important defect remains, ownership/compatibility/direct-worker/save continuation pass, required real-browser tests pass, queues/resources are bounded, new required budgets have valid target evidence or explicit owner exceptions, docs describe implemented behavior accurately, and the repository is clean/synchronized. The pre-existing accepted pure Benchmark exception may remain precisely documented; it does not waive new defects or gates.

Final report:
1. Git identity, audited range and checkpoint map.
2. Integrated implementation findings with severity and exact reproduction.
3. Correctness/determinism/browser/security/migration/recovery evidence.
4. Frozen Phase1 and new save/transport compatibility vectors.
5. Target versus non-target performance, cold/large paths and soak results.
6. Source/durable/presentation/queue ownership and fatal semantics.
7. Docs consistency and accurate remaining deferred systems.
8. Exact Phase3 prerequisites now available and absent.
9. READY or NOT READY, with narrow repair recommendations for blockers.

Do not repair in this session. Stop before Phase3 design or implementation.
```

## 19. Exact execution order and stopping points

1. Luna xhigh:16.1 ->16.2 ->16.3 ->16.4; fresh Sol High:CP16.
2. Luna xhigh:17.1 ->17.2 ->17.3 ->17.4; fresh Sol High:CP17.
3. Luna xhigh:18.1 ->18.2 ->18.3; fresh Sol High:CP18.
4. Luna xhigh:19.1 ->19.2 ->19.3 ->19.4; fresh Sol High:CP19.
5. Luna xhigh:20.1 ->20.2 ->20.3; fresh Sol High:CP20.
6. Luna xhigh:21.1 ->21.2; fresh Sol High:CP21.
7. Fresh Sol High:final read-only Phase2 closure audit.

No automatic cross-phase loop, usage polling or /status instruction. If a session stops unexpectedly, resume from the actual group handoff/diff and completed gate evidence. Do not repeat a completed implementation or re-stage somebody else's work.

## 20. Remaining risks and explicit limits

- Browser storage can be evicted or lost; manual exported backups remain useful. Transaction commit is not a cross-device guarantee.
- Recovery may lose progress after the last durable capture and cannot certify unresolved request outcomes. The UI must show this limitation concretely.
- Strict import limits can reject oversized but otherwise legitimate long-lived states. Do not truncate them. Any future limit expansion needs measured memory/latency evidence.
- No checksum prevents a same-origin attacker or owner from editing a payload and recomputing SHA. This phase has no anti-cheat/authentication promise.
- Small direct-tick headroom requires separate projection/transport/persistence budgets. Fast non-target measurements cannot certify the i7 gate.
- Unimplemented gameplay event forecasts, Offline Assist and chart history must not be filled with guessed semantics.
- Native Worker/crypto/compression/IndexedDB/Web Locks behavior requires real-browser testing. New dependencies require explicit justification; prefer already available native APIs and existing validation libraries.
- Complete prompts specify the architecture now, but later bug findings may require a bounded amendment. Never silently convert a performance shortcut or placeholder into a new gameplay rule.

Planning deliverable complete. This artifact does not start Task16.1 or modify the repository.
