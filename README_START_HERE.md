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

1. `AGENTS.md`, pentru reguli de lucru și limite tehnice.
2. TDD-ul, pentru arhitectură și contracte.
3. Fișierul fazei curente, pentru scope și acceptance criteria.
4. GDD-ul, pentru viziune și gameplay.
5. Codul și testele, doar după ce respectă documentele de mai sus.

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

## Regula de calitate

O fază nu este terminată doar pentru că aplicația pornește. Trebuie să treacă testele, verificarea TypeScript, lint-ul, build-ul și criteriile de acceptare ale fazei.
