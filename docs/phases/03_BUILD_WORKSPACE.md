# Faza 3: Build Workspace

Status: contract adoptat; Task 22.1–22.4 și CP22 sunt finalizate (`eb4b2b3`). Task 23.1–23.3
livrează fundația Pixi interactivă, selecția/inspectorul și sumarurile autoritative.
CP23 este finalizat prin commitul care conține acest raport, cu subiectul
`feat: render interactive facility canvas`, având CP22 drept părinte.
Review-ul CP23 și rezultatele exacte sunt în `../diagnostics/PHASE_3_TASK_23_CP23_REVIEW.md`
și `../../TASK_23_VERIFICATION.md`. Task 24 nu este început.

Contractul normativ complet și prompturile executorului sunt în
[`OVERCLOCK_Phase_3_Contract_and_Prompts.md`](./OVERCLOCK_Phase_3_Contract_and_Prompts.md).
Acest document rămâne rezumatul de produs; contractul complet prevalează la detaliile de
ownership, protocoale, verificare și limite.

## Obiectiv

Transformă simulatorul într-un grid interactiv, fără a finaliza încă întreaga campanie.

## Scope

1. Camera PixiJS, zoom și pan.
2. Tile grid și module view objects.
3. Selection, multi-select și inspector bridge.
4. Bottom Build Tray cu Inventory și Catalog.
5. Cumpărare și placement într-un singur flow.
6. Rotation, move, remove și placement ghost.
7. Power și data routes.
8. Auto-connect și A* routing.
9. Design Mode, undo, redo, preview, Apply și Cancel.
10. Heatmap și temperature overlays.
11. Blueprint save și instantiate UI.
12. Diagnostic Pulse.
13. Responsive layout la toate rezoluțiile țintă.

## Acceptance criteria

- cumpărarea și plasarea nu cer intrarea într-un shop separat;
- invalid placement explică motivul înainte de click;
- Apply prezintă cost, downtime și diferențe estimate;
- Cancel nu schimbă sistemul live;
- undo și redo păstrează draft revision corect;
- heatmap corespunde temperaturilor simulatorului;
- renderer-ul folosește revision patches, fără rebuild complet per tick;
- build flow este complet utilizabil la 1280 × 720;
- nu există leak detectabil după 20 de mount/unmount cycles;
- scena densă respectă bugetul de render.

## Livrabil

Un Build Workspace complet, conectat la simulator, după CP22–CP28. CP22 livrează numai limita
owned read/guard/Worker/GameClient din Task 22; documentul nu afirmă că UI-ul, renderer-ul sau
routing-ul Phase 3 sunt finalizate. Task 23 adaugă numai fundația descrisă în
`../diagnostics/PHASE_3_RENDERING.md` și `../diagnostics/PHASE_3_VISUAL_REVIEW.md`.

## Decompoziție normativă

Ordinea și limitele exacte sunt în contractul complet. Inventarul executabil este păstrat
explicit aici pentru handoff și nu autorizează saltul peste checkpointuri:

| Grup                             | Subtaskuri                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Task 22 – Build boundary         | 22.1 contract/read types; 22.2 context/generation; 22.3 pure previews; 22.4 Worker/GameClient integration |
| Task 23 – Pixi foundation        | 23.1 owned scene; 23.2 camera/hit testing; 23.3 selection/inspector                                       |
| Task 24 – Build interaction      | 24.1 Inventory/Catalog; 24.2 placement/purchase; 24.3 move/rotate/remove; 24.4 Apply/Cancel               |
| Task 25 – Routing                | 25.1 deterministic planner; 25.2 manual/automatic tools; 25.3 adjacent auto-connect                       |
| Task 26 – Blueprints/diagnostics | 26.1 Blueprint UI; 26.2 heatmap; 26.3 Diagnostic Pulse                                                    |
| Task 27 – shell quality          | 27.1 responsive layout; 27.2 keyboard/accessibility/localization; 27.3 browser acceptance                 |
| Task 28 – closure                | 28.1 dense fixture budgets; 28.2 recovery/lifecycle durability; 28.3 complete verification                |

Independent Sol checkpoints: CP22 after Task 22, then CP23, CP24, CP25, CP26, CP27 and
CP28 at the corresponding group boundaries. După CP23 publicat, următoarea limită de
implementare este Task 24.1, numai cu autorizare separată.
