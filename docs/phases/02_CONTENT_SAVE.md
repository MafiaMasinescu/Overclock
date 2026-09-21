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

## Scope pending after Task 16

The original outline below predates the detailed Task 16 contract. Detached schema validation,
full-state admission, SHA-256 canonical codec, bounded none/gzip encoding, and synthetic copy-only
migration are now implemented; the remaining entries are storage, Worker, client/store, and recovery
work owned by later Phase 2 tasks.

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

The original outline sentence below is archival wording and is superseded by the Task 16 status above;
the detailed Phase 2 contract is now the normative roadmap for the remaining work.

Simulatorul Phase 1 rulează prin worker și client/store, își păstrează progresul durabil și menține
aceleași rezultate deterministe. Implementarea concretă necesită un contract Phase 2 separat.
