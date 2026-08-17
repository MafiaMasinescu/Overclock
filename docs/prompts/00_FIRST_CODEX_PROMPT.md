# Primul prompt pentru Codex

Model recomandat: GPT-5.6 Sol, reasoning High. Pentru analiza inițială a arhitecturii poți folosi XHigh.

Copiază textul de mai jos într-o sesiune Codex deschisă în folderul repository-ului gol.

```text
You are implementing Phase 0 of OVERCLOCK.

Read these files completely before editing:
1. AGENTS.md
2. docs/GDD.md
3. docs/TDD_VERTICAL_SLICE.md
4. docs/decisions/ADR-0001_FOUNDATION.md
5. docs/phases/00_SETUP.md
6. every file currently present in contracts/src and content

Work only on Phase 0. Do not implement Phase 1 gameplay systems.

Before changing files:
- inspect the repository and Git status;
- summarize the Phase 0 deliverables in at most 12 concrete items;
- identify any direct conflict between the documents;
- if there is no blocking conflict, proceed without asking for confirmation.

Implementation requirements:
- use pnpm;
- create a Vite, React and strict TypeScript project;
- configure Vitest, Playwright, linting, formatting and import boundaries;
- create the repository structure defined by the TDD;
- move and adapt the supplied contracts into the correct source folders;
- preserve their public semantics unless a compile error requires a documented correction;
- add Zod content validation and cross-reference checks;
- load the supplied JSON content into an immutable ContentBundle;
- create the responsive React application shell for 1920x1080, 1600x900, 1366x768 and 1280x720;
- mount an empty, resizable PixiJS canvas in Center Workspace;
- create a fake GameClient that supplies typed placeholder snapshots;
- enable Romanian and English switching;
- add pnpm validate;
- add the tests required by docs/phases/00_SETUP.md.

Constraints:
- do not create the real tick loop;
- do not implement task progress, thermal simulation, overclock formulas, saving or real grid placement;
- do not add Tauri;
- do not use any;
- do not make React render one component per grid tile;
- do not change the GDD or TDD;
- do not install extra libraries when the selected stack or platform APIs already solve the need.

Verification:
- run formatting check, lint, typecheck, content validation, unit tests and production build;
- run the Phase 0 Playwright smoke test if the environment supports it;
- fix failures that are within Phase 0 scope.

Final response:
- lead with the implementation outcome;
- list files or major areas changed;
- list every verification command and result;
- state assumptions and remaining Phase 0 risks;
- stop after Phase 0 and wait for approval.
```

## După prima sesiune

Nu porni imediat Faza 1. Verifică manual:

1. aplicația la 1920 × 1080;
2. aplicația la 1280 × 720;
3. schimbarea română/engleză;
4. mesajele pentru un JSON invalid;
5. comanda `pnpm validate`.

După această verificare, poți cere Codex să repare strict problemele observate. Apoi începi Faza 1 într-o sesiune nouă sau după compaction controlat.

