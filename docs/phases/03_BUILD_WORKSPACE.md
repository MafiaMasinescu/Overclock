# Faza 3: Build Workspace

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

Un Build Workspace complet, conectat la simulator.

