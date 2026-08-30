# OVERCLOCK Codex Build Pack v1.0

Acest pachet transformă viziunea din GDD într-un plan executabil pentru vertical slice 0.1.

Versiunea Word a documentului tehnic se află în `docs/OVERCLOCK_TDD_Vertical_Slice_v1.0.docx`. Versiunea Markdown din `docs/TDD_VERTICAL_SLICE.md` rămâne sursa potrivită pentru Codex și versionare Git.

## Ce construim acum

Construim o sesiune jucabilă de 45 până la 75 de minute, plasată între 1946 și 1948. Vertical slice-ul conține prologul Human Computers, o generație Vacuum Tube, un Facility Canvas, 12 module, 8 task-uri, 10 noduri de research, patru profiluri de overclock, temperatură, heatmap, un blueprint, două benchmark-uri și Museum snapshot.

Transistorul apare doar ca reveal final. Nu implementăm încă a doua generație, companie publică, quantum, Beyond Silicon, multiplayer, cloud saves sau leaderboards globale.

## Ordinea obligatorie de citire

1. `AGENTS.md`
2. `docs/GDD.md`
3. `docs/TDD_VERTICAL_SLICE.md`
4. `docs/decisions/ADR-0001_FOUNDATION.md`
5. Fișierul fazei curente din `docs/phases/`
6. Contractele relevante din `contracts/src/`

Codex nu trebuie să primească întregul proiect ca un singur task. Fiecare sesiune implementează o singură fază sau un singur subtask verificabil.

## Ordinea implementării

1. `00_SETUP.md`
2. `01_HEADLESS_SIMULATOR.md`
3. `02_CONTENT_SAVE.md`
4. `03_BUILD_WORKSPACE.md`
5. `04_PLAYABLE_LOOP.md`
6. `05_RELEASE_CANDIDATE.md`

Folosește `docs/prompts/00_FIRST_CODEX_PROMPT.md` pentru prima sesiune de cod. Pentru sesiunile următoare, pornește de la `docs/prompts/TASK_TEMPLATE.md`.

## Surse de adevăr

Ordinea de autoritate este:

1. Cea mai recentă decizie aprobată explicit pentru task-ul curent.
2. Evidența Git curentă.
3. `docs/status/PROJECT_STATUS.md`.
4. ADR-urile acceptate aplicabile.
5. Fișierul fazei curente, pentru scope și acceptance criteria.
6. TDD-ul Markdown, pentru arhitectură și contracte.
7. `docs/GDD.md` v1.1, sursa GDD autoritativă.
8. Materialele de handoff.
9. Contextul chatului anterior.

`docs/OVERCLOCK_Game_Design_Document_v1.0.docx` este numai o referință vizuală și arhivistică
neautoritativă. Versiunea Markdown din `docs/TDD_VERTICAL_SLICE.md` rămâne sursa autoritativă
pentru Codex și versionare Git; documentul Word TDD se păstrează ca referință.

Dacă două surse se contrazic, Codex trebuie să oprească implementarea și să descrie conflictul. Nu inventează o decizie permanentă.

## Decizia privind rezoluția

Rezoluția principală este 1920 × 1080. Testăm obligatoriu și 1600 × 900, 1366 × 768 și 1280 × 720. Ultima rămâne minimum funcțional, cu panouri compacte.

## Pornirea aplicației local

`index.html` este template-ul de intrare Vite. Nu îl deschide direct din File Explorer cu protocolul `file://`: browserul nu poate transforma modulele TypeScript/TSX și le va bloca prin politica CORS. Rulează aplicația prin serverul HTTP Vite.

Din PowerShell, intră în folderul repository-ului:

```powershell
cd D:\miscellaneous\Overclock\vertical_slice_v1
```

La prima rulare sau după schimbarea lockfile-ului, instalează dependențele:

```powershell
corepack pnpm install
```

### Development

Pornește serverul cu hot reload:

```powershell
corepack pnpm dev
```

Deschide adresa afișată în terminal, implicit `http://localhost:5173/`.

### Production preview

Construiește aplicația, apoi servește build-ul rezultat:

```powershell
corepack pnpm build
corepack pnpm preview
```

Deschide adresa afișată în terminal, implicit `http://localhost:4173/`. Production preview este pentru verificare locală; distribuția finală folosește conținutul folderului `dist` servit prin HTTP.

Oprește oricare dintre servere cu `Ctrl+C` în terminalul în care rulează.

## Thermal performance diagnostic

For the audited 24 by 16 thermal fixture, run:

```powershell
corepack pnpm performance:thermal
```

The command does not modify game state. It measures cold topology, warmed pure thermal work, the
complete Power-plus-thermal production tick, dirty-layout rebuild, startup transition, and forced
thermal validation separately. Fixture setup and JIT warm-up are excluded; output includes median,
p95, maximum, samples, and execution environment. Task 7 targets are p95 below `0.5 ms` for pure
thermal work and below `4 ms` for the complete production tick on the i7-2600.

## Overclock performance diagnostic

For Task 8's extension of the same audited fixture, run:

```powershell
corepack pnpm performance:overclock
```

It reports 500 warm pure-domain samples and 200 samples for warm production, profile and Manual
changes, Thermal Factor, shutdown/cooldown/recovery, forced validation, and cold replacement. The
enforced i7-2600 gates are pure Task 8 p95 below `0.25 ms` and warm full production p95 below `4 ms`.

## Useful Compute performance diagnostic

For Task 9's extension of the unchanged audited 24 by 16 fixture, run:

```powershell
corepack pnpm performance:compute
```

The command reports 200 cold topology samples, 500 warm pure samples, and 200 samples each for the
complete production tick, changed congestion/allocation, startup/shutdown transitions, calculate-once
result/witness construction, and exact witness validation. It excludes fixture construction and 100
JIT warm-ups, then reports median, p95, maximum, sample count, fixture inventory, CPU, OS, Node version,
and build mode. The enforced i7-2600 gates are pure Task 9 p95 below `0.35 ms` and complete production
p95 below `4 ms`; p95 below `3.7 ms` is the preferred production-headroom target.

Run the checkpoint comparison with unrelated builds, test runners, browsers, antivirus scans, and
other heavy workloads inactive. Task 9's independent checkpoint review documented an explicitly
accepted host-load irregularity when Opera and ChatGPT processes consumed several CPU cores and
inflated unrelated sections together. The diagnostic still reports every sample and fails the same
hard thresholds; do not compensate with sample filtering, process priority, affinity, or V8 flags.

## Regula de calitate

O fază nu este terminată doar pentru că aplicația pornește. Trebuie să treacă testele, verificarea TypeScript, lint-ul, build-ul și criteriile de acceptare ale fazei.
