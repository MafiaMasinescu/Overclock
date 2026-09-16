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

## Scope pending

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

Simulatorul Phase 1 rulează prin worker și client/store, își păstrează progresul durabil și menține
aceleași rezultate deterministe. Implementarea concretă necesită un contract Phase 2 separat.
