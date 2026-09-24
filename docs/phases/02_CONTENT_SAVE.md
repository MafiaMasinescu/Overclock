# Faza 2: Content baseline integration, persistence and worker bridge

## Obiectiv

Integrează simulatorul Phase 1 într-un host de producție cu persistență durabilă, worker bridge,
client/store și selectori. Nu reimplementează conținutul sau milestone bot-ul deja validate.

## Entry prerequisites deja implementate

- strict content loader și cross-reference validation;
- 12 module, 8 Tasks, 10 Research nodes și 2 Benchmarks;
- balancing config, milestone fixtures și bot-ul determinist `balance:milestones`;
- simulatorul production, Replay recording/playback și resume verificat în memorie.

Acestea rămân regression/integration evidence și trebuie păstrate ca gates. Milestone bot-ul este o
poartă existentă, nu un nou livrabil Phase 2.

## Historical outline after Task 16

The original outline below predates the detailed Phase 2 contract and is retained as a historical
checklist. Task 16 completed detached schema validation, full-state admission, the canonical SHA-256
codec and copy-only migration. Task 17 completed the repository, Task 18 completed owned
projection/publication, and Task 19 completed the real Worker host and client bridge. Durable Worker
save orchestration and live load/recovery remain Task 20 work.

1. Worker protocol și `SimWorkerHost` real.
2. Ownership-ul cozii și recovery boundaries între host, worker și persistence.
3. `GameClientStore` real și selectori fără UI final.
4. Snapshot/patch și event delivery la nivel de transport.
5. IndexedDB repository.
6. Autosave cu trei rotații.
7. Export și import envelope cu limite de input.
8. Checksum SHA-256 pentru integritate și un model explicit de autentificare dacă va fi necesar.
9. Save round-trip și migrare demonstrativă pe copie.
10. Recovery din ultimul save/checkpoint durabil valid.
11. Playtest report local pentru integrare.

Replay resume verificat în memorie nu este autosave, migrare, persistență durabilă sau worker
recovery. Phase 2 trebuie să definească întâi contractele de persistență, compatibilitate și queue
ownership; acest roadmap nu fixează încă API-urile lor detaliate.

## Acceptance criteria

- worker și direct host produc același rezultat pentru același Replay;
- toate content IDs și localization keys rămân valide;
- milestone baseline și duplicate baseline își păstrează hash-urile aprobate;
- un save durabil la jumătatea Replay-ului continuă către același final hash;
- un import corupt este respins fără a afecta sloturile existente;
- migrarea rulează pe o copie;
- autosave păstrează exact trei rotații;
- worker recovery folosește numai un checkpoint legat de o stare persistentă validată;
- client/store și selectori nu dublează autoritatea simulatorului.

## Livrabil

## Task 16: Detached save bytes

The detailed Phase 2 contract and copy-ready execution prompts are maintained in
`docs/phases/OVERCLOCK_Phase_2_Contract_and_Prompts.md`. Task 16 owns the persistence schema,
strict full-state admission, canonical UTF-8/SHA-256 envelope codec, and the synthetic copy-only
schema-0 migration. It does not own IndexedDB, Worker transport, scheduler, snapshots, client/store,
autosave, recovery UI, or Phase 3 gameplay presentation.

The Task 16 boundary preserves `GameState.saveVersion`, `contentVersion`, Replay protocol and hashes,
RNG, fixed tick ordering, Campaign timeline coherence, and all Phase 1 historical-state semantics.
Durable capture is valid only at a detached empty-command-queue boundary and carries `nextQueueSequence`
as execution metadata. Wall-clock timestamps, settings, local statistics, compression, checksums, and
future host epochs remain outside deterministic state.

Task 16 is complete at its checkpoint-neutral boundary. Public encode/decode compose strict payload
schema parsing, content fingerprint checks, execution-state hash checks and fresh production-core
admission. The codec enforces bounded canonical bytes, exactly one gzip member, stable persistence
errors and copy-only migration. Native Chromium none/gzip round-trip and target-host dense-fixture
diagnostics are permanent regression evidence. Task 17 owns durable repository behavior.

Task 17 is complete at its checkpoint-neutral boundary. The version-1 `overclock` IndexedDB schema
stores manual saves, compound-key autosave generations, slot metadata, settings, reports and the
reserved Blueprint store. Atomic transactions enforce revision and writer-epoch fencing; Web Locks
provide same-origin writer exclusion and guard import overwrite and inactive-slot deletion. Exactly
three newest autosaves are retained. Import preview/confirmation, read-only export and load admission
compose the repaired Task 16 codec and full current-content admission. Permanent contracts are
ADR-0024 through ADR-0026; audit and target-host/browser evidence are in the Phase 2 repository
diagnostics. Task 18 owns snapshot/selectors and must reuse these durable boundaries rather than
reimplementing them.

## Task 19: Worker host, scheduler, and real GameClient

Task 19 completes the strict Worker protocol, serial `SimWorkerHost`, fixed-step scheduler, owned
snapshot/patch delivery, real Worker-backed `GameClient`, and localized connection status. The host
uses 25 ms monotonic wakes, 100 ms ordinary ticks, speeds 1/2/4, and a 20-tick burst cap. It serializes
commands, clock operations and capture barriers; no timer, Worker or storage import enters `src/sim`.
The client ACKs only after atomic store admission, coalesces publications, requests full resync after
transport gaps, and settles unknown command outcomes without replay. Real Chromium parity covers
ticks 12,000 and 24,000 against direct production `SimCore` with matching results, RNG, hashes and
queue position. Fatal, crash, `messageerror`, delayed ACK and 20 destroy/release cycles are covered.
ADR-0028 and `docs/diagnostics/PHASE_2_WORKER.md` record the API, measured host, commands and results.
The complete 33-case Chromium run used the dense N Worker fixture; measured p95 values were
5.4 ms idle request/result, 1.5 ms direct tick, 3.2 ms combined Worker tick/projection, 4.4 ms
client publication handling, 0.4 ms Worker `postMessage`, and 102.7 ms foreground command
visibility. Publication measurement discards 100 warm-up messages, measures the next 500 Worker
replies emitted during one-step callbacks, and pairs client timings by publication sequence.

Task 19 does not implement durable save writes, autosave, load promotion, import/export UI or durable
recovery. Those boundaries belong to Task 20.

The original outline sentence below is archival wording and is superseded by the Task 16 status above;
the detailed Phase 2 contract is now the normative roadmap for the remaining work.

Obiectivul Phase 2 rămâne un client Worker cu rezultate deterministe și progres durabil. Task 16–19
au închis contractele de bytes, repository, proiecție și Worker; autosave, load, import/export UI și
recovery durabil rămân în Task 20, conform contractului Phase 2.
