# Faza 0: Setup și contract lock

## Obiectiv

Creează repository-ul executabil, quality gates și granițele arhitecturale. Nu implementa încă loop-ul de gameplay.

## Scope

1. Inițializează Vite, React și TypeScript strict cu pnpm.
2. Configurează aliases și limitele de import.
3. Adaugă Vitest, Playwright, ESLint și formatter.
4. Creează structura de directoare din TDD.
5. Mută și adaptează contractele din `contracts/src/`.
6. Configurează Zod și un content loader minimal.
7. Validează fișierele JSON din `content/`.
8. Creează un `ContentBundle` read-only.
9. Creează shell-ul UI cu Header, Left Rail, Center Workspace, Bottom Build Tray și Right Operations Stack, numai cu placeholder data.
10. Creează un PixiJS canvas gol, montat și redimensionabil.
11. Creează bridge interfaces și un fake client pentru Story/Development.
12. Configurează localizarea română și engleză.
13. Adaugă `pnpm validate`.
14. Adaugă un smoke test Playwright pentru pornirea aplicației.

## Nu implementa

- tick loop real;
- formule de gameplay;
- placement real;
- task progression;
- save system;
- heatmap;
- animații finale;
- Tauri.

## Acceptance criteria

- `pnpm install` și `pnpm validate` funcționează dintr-un checkout curat.
- TypeScript strict nu raportează erori.
- Toate fișierele JSON se validează.
- O referință invalidă între research nodes produce test fail clar.
- App shell apare la 1920 × 1080 și 1280 × 720.
- Pixi canvas se redimensionează fără leak sau warning.
- Schimbarea limbii actualizează textul placeholder.
- Nu există import din UI sau rendering către mutatori de simulator.

## Livrabil

Un repository curat și testabil, pregătit pentru simulatorul headless.

