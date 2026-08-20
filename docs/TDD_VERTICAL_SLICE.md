# OVERCLOCK

## Technical Design Document pentru Vertical Slice 0.1

Versiune: 1.0

Data: 15 august 2026

Status: Ready for implementation

Public: dezvoltatorul proiectului și Codex

Document asociat: `docs/GDD.md`, versiunea 1.1

## 1. Scopul documentului

Acest TDD definește implementarea tehnică a vertical slice-ului OVERCLOCK. El stabilește contractele dintre simulator, React, PixiJS, fișierele de conținut și sistemul de salvare.

Documentul nu redefinește viziunea jocului. GDD-ul rămâne sursa pentru experiența jucătorului. TDD-ul transformă acea experiență în limite, tipuri și criterii verificabile.

## 2. Rezultatul urmărit

Vertical slice-ul trebuie să ofere o sesiune completă de 45 până la 75 de minute. Jucătorul pornește în 1946 cu Human Computers, construiește un sistem cu tuburi electronice, rezolvă bottleneck-uri, folosește overclock și cooling, salvează un blueprint, trece două benchmark-uri și deblochează reveal-ul tranzistorului.

Produsul final al acestui TDD trebuie să ruleze:

1. în browser desktop, ca build static pentru itch.io;
2. local, prin serverul de dezvoltare Vite;
3. în testele headless, fără React sau PixiJS;
4. ulterior, fără schimbarea simulatorului, într-o aplicație Tauri 2.

## 3. Scope obligatoriu

Vertical slice 0.1 include:

- perioada 1946 până în 1948;
- tutorial Human Computers;
- un singur Facility Canvas;
- o singură generație jucabilă, Vacuum Tube System;
- 12 definiții de module;
- 8 definiții de task;
- 10 noduri de research;
- maximum două task-uri active;
- profiluri Eco, Balanced, Boost și Manual;
- power, temperatură locală și globală, throttling și emergency shutdown;
- heatmap controlabil;
- Design Mode cu preview, undo, redo, Apply și Cancel;
- un blueprint de subansamblu, cu instanțiere;
- Peak Throughput Benchmark;
- Sustained Stability Benchmark;
- save, autosave, load, export, import și o migrare demonstrativă;
- localizare română și engleză;
- tutorial de aproximativ 10 minute;
- Museum snapshot final;
- Reduced Effects;
- instrumente minime de debug și playtest report.

## 4. Out of scope

Nu implementăm în vertical slice:

- generația tranzistorului ca gameplay;
- alte facilități sau nivelul Portfolio;
- prebuild rack-uri;
- companie publică, acțiuni sau investitori;
- bankruptcy complet;
- automation IF/THEN;
- component health și distrugere permanentă;
- routing lichid sau immersion cooling;
- Boundary Reset, Fundamental Insights și Singularity Data;
- full Museum, Encyclopedia completă sau întreaga cronologie;
- user accounts, cloud saves, analytics extern sau leaderboards online;
- mobile, touch sau controller;
- Tauri în primele patru faze;
- artă finală pentru fiecare componentă.

## 5. Principii tehnice

### 5.1 Simulator autoritativ

Simulatorul reprezintă singura sursă de adevăr pentru economie, grid, task-uri, research, temperatură și progres. React și PixiJS pot păstra doar stare de prezentare, selecție și input temporar.

### 5.2 Determinism

Același `seed`, același conținut și aceeași succesiune ordonată de comenzi trebuie să producă același hash de state după același număr de tick-uri.

Simulatorul nu folosește:

- `Math.random()`;
- `Date.now()`;
- `performance.now()` pentru gameplay;
- numărul de frame-uri randate;
- ordinea instabilă a proprietăților unui obiect;
- operații dependente de locale.

### 5.3 Date serializabile

State-ul autoritativ folosește obiecte, array-uri, string-uri, numere, valori booleene și `null`. Timpul se stochează în tick-uri sau milisecunde întregi de simulare. Datele calendaristice din metadate se stochează ca string ISO în envelope, nu în state-ul care decide gameplayul.

### 5.4 Explainability

Fiecare valoare importantă trebuie să poată explica formula care a produs-o. UI-ul nu recalculează Useful Compute. Simulatorul emite `ComputeBreakdown` cu factorii folosiți.

### 5.5 Scope control

Implementăm cea mai simplă structură care susține vertical slice-ul și extensiile deja certe. Nu construim framework-uri generale pentru sisteme viitoare care nu au consumator în versiunea 0.1.

## 6. Stack și versiuni

Faza 0 trebuie să fixeze versiuni exacte în lockfile.

| Strat | Alegere |
|---|---|
| Limbaj | TypeScript cu `strict: true` |
| Build | Vite |
| UI | React |
| Canvas | PixiJS 8 |
| Grafice | uPlot |
| Validare | Zod |
| Localizare | i18next și react-i18next |
| Teste | Vitest și Playwright |
| Package manager | pnpm |
| Persistență browser | IndexedDB printr-un adapter propriu mic |
| Desktop ulterior | Tauri 2 |

Nu adăugăm o bibliotecă globală de state în Faza 0. `GameClientStore` folosește `useSyncExternalStore`. Putem evalua o bibliotecă numai dacă profiling-ul sau complexitatea reală justifică schimbarea.

## 7. Arhitectura runtime

```mermaid
flowchart TD
    A[React UI] -->|PlayerIntent| B[GameClient]
    C[PixiJS Canvas] -->|GridIntent| B
    B -->|SimCommand| D[Sim Worker Host]
    D --> E[Deterministic Sim Core]
    E -->|UiSnapshot + SimEvent| D
    D --> B
    B -->|Selectors| A
    B -->|GridViewModel| C
    E --> F[Save Repository Adapter]
```

### 7.1 Sim Core

`SimCore` este o clasă orchestration foarte mică peste funcții pure. Ea deține state-ul, coada de comenzi, RNG-ul și ordinea sistemelor. Nu importă cod din `app`, `ui`, `rendering` sau browser.

API minim:

```ts
export interface SimCore {
  readonly tick: number;
  enqueue(command: SimCommand): CommandReceipt;
  step(ticks?: number): StepResult;
  getStateForSave(): GameState;
  getUiSnapshot(): UiSnapshot;
  drainEvents(): SimEvent[];
}
```

### 7.2 Sim Worker Host

În producție, simulatorul rulează într-un Web Worker. Host-ul:

- primește comenzi serializabile;
- menține accumulator-ul pentru fixed ticks;
- rulează maximum un număr controlat de catch-up ticks per frame de host;
- trimite snapshot-uri UI la maximum 10 Hz;
- trimite alertele critice imediat după tick;
- acceptă pause, viteze 1x, 2x și 4x;
- oprește catch-up-ul când tab-ul revine după o suspendare lungă și delegă progresul către Offline Assist.

Testele folosesc `SimCore` direct. Node nu trebuie să emuleze Worker-ul pentru testele de formule și determinism.

### 7.3 GameClient

`GameClient` este singurul API folosit de UI pentru gameplay:

```ts
export interface GameClient {
  dispatch(command: SimCommand): Promise<CommandResult>;
  getSnapshot(): UiSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeEvents(listener: (event: SimEvent) => void): () => void;
  getGridViewModel(): GridViewModel;
  requestSave(reason: SaveReason): Promise<SaveMetadata>;
}
```

UI-ul poate avea servicii separate pentru setări, localizare și dialoguri. Ele nu modifică direct simulatorul.

### 7.4 React

React controlează:

- Header;
- Left Rail;
- Bottom Build Tray;
- Right Operations Stack;
- Telemetry;
- task-uri, research, Museum și settings;
- dialoguri de confirmare;
- text și accesibilitate;
- shortcut-uri globale care nu depind de coordonate canvas.

React citește snapshot-uri prin selectori cu equality checks. O schimbare a unui tile nu trebuie să re-randeze întregul dashboard.

### 7.5 PixiJS

PixiJS controlează:

- tile grid și camera;
- module și placement ghosts;
- selecție și selection box;
- power/data routes;
- heatmap;
- pulse-uri și particule;
- highlights pentru Diagnostic Pulse;
- zoom, pan și transformarea coordonatelor.

PixiJS emite `GridIntent`. Bridge-ul îl transformă în comenzi. Renderer-ul nu importă reducers sau mutatori ai simulatorului.

## 8. Structura repository-ului

```text
src/
  app/
    bootstrap/
    game-client/
    worker/
  sim/
    core/
    commands/
    events/
    systems/
    formulas/
    selectors/
    rng/
    replay/
  content/
    loader/
    schemas/
    raw/
  grid/
    domain/
    validation/
    routing/
    thermal/
    blueprints/
  rendering/
    pixi/
    heatmap/
    effects/
  ui/
    layout/
    panels/
    workspaces/
    charts/
    dialogs/
  save/
    repository/
    migrations/
    export/
  localization/
  audio/
  devtools/
tests/
  unit/
  integration/
  determinism/
  performance/
  e2e/
public/
  assets/
docs/
```

Fișierele din `contracts/src/` ale acestui pachet sunt contracte de pornire. În Faza 0, Codex le mută în folderele potrivite, păstrând semantica și testele de tip.

## 9. Unități și convenții

| Concept | Reprezentare |
|---|---|
| Tick | integer, 100 ms de simulare |
| Compute | FLOPS |
| Work | număr de operații |
| Power | watts |
| Energy cost | USD per kWh în conținut |
| Temperature | grade Celsius |
| Memory capacity | bytes |
| Bandwidth | bytes per second |
| Latency | microseconds |
| Cash | USD, `number` autoritativ cuantizat la 6 zecimale prin microdolari |
| Grid position | coordonate integer `x`, `y` |
| Rotation | 0, 90, 180 sau 270 |
| Ratio/factor | număr finit, documentat și limitat |

Simulatorul păstrează câmpurile monetare publice ca `number`, dar execută mutațiile monetare autoritative prin aritmetică internă în microdolari, unde 1 USD = 1.000.000 microdolari. La granițele monetare, valorile se cuantizează la 6 zecimale USD cu rotunjire la jumătate în sensul îndepărtării de zero (`round-half-away-from-zero`). UI-ul afișează de regulă Cash cu 2 zecimale, iar statisticile extinse pot expune valori sub-cent. Formatarea UI rămâne separată și nu reintră niciodată în simulator. Precizia autoritativă sub-cent este necesară pentru costurile deterministe de energie; de exemplu, 24.000 W timp de 0,1 secunde la 0,042 USD/kWh costă 0,000028 USD.

## 10. State-ul autoritativ

Forma exactă inițială se află în `contracts/src/types.ts`. State-ul principal conține:

```ts
export interface GameState {
  saveVersion: number;
  contentVersion: string;
  seed: string;
  tick: number;
  rngState: number;
  clock: SimulationClockState;
  campaign: CampaignState;
  economy: EconomyState;
  facility: FacilityState;
  inventory: InventoryState;
  tasks: TaskSystemState;
  research: ResearchState;
  benchmarks: BenchmarkState;
  blueprints: BlueprintState;
  tutorial: TutorialState;
  museum: MuseumState;
  achievements: AchievementState;
}
```

Setările grafice, volumele audio și limba se salvează separat de state-ul determinist. Ele pot apărea în `SavePayload.settings`, dar nu influențează hash-ul de replay.

`FacilityState` include câmpul autoritativ aditiv:

```ts
nextModuleInstanceSequence: number;
```

Valoarea pornește de la `1`, rămâne un positive safe integer și nu scade. Fiecare placement acceptat alocă `module-instance-` urmat de secvența zecimală pe minimum opt poziții cu zero-uri la stânga, apoi incrementează secvența exact o dată. Un placement respins nu consumă secvența. Remove și Cancel nu restaurează valori consumate, astfel încât ID-urile instanțelor nu se refolosesc în același save. Alocarea nu consumă RNG. Coliziunea unui ID generat sau imposibilitatea incrementării în intervalul safe integer produce `INVALID_SYSTEM` fără mutație. Formatul și secvența fac parte din compatibilitatea save/replay.

### 10.1 Invariante globale

- `tick` nu scade.
- Cash nu devine `NaN` sau infinit.
- O instanță de modul ocupă exact footprint-ul rotit declarat.
- Două module nu ocupă același tile.
- Un modul activ are power path valid.
- Task-urile active nu depășesc sloturile deblocate.
- Research-ul completat nu poate reveni la `locked`.
- Temperatura fiecărui tile rămâne între limitele de siguranță numerică ale simulării.
- Un command respins nu schimbă hash-ul state-ului.
- ID-urile instanțelor nu se refolosesc în același save.

## 11. Comenzi

Toate acțiunile care schimbă gameplayul folosesc `SimCommand`. Comanda conține:

- `commandId`, UUID generat în client;
- `kind`, discriminator stabil;
- `expectedTick`, opțional, pentru acțiuni care trebuie respinse dacă snapshot-ul este prea vechi;
- payload specific;
- `source`, pentru input, tutorial, debug sau replay.

Comenzile intră în coadă și se aplică în ordine la începutul următorului tick. Comenzile de pause și speed sunt procesate de host, deoarece controlează programarea tick-urilor, dar sunt logate în replay.

### 11.1 Lista vertical slice-ului

| Domeniu | Comenzi |
|---|---|
| Clock | `SET_PAUSED`, `SET_SPEED` |
| Build | `ENTER_DESIGN_MODE`, `PLACE_MODULE`, `MOVE_MODULE`, `ROTATE_MODULE`, `REMOVE_MODULE`, `CONNECT_PORTS`, `DISCONNECT_ROUTE`, `UNDO_DESIGN`, `REDO_DESIGN`, `APPLY_DESIGN`, `CANCEL_DESIGN` |
| Inventory | `BUY_MODULE`, `SELL_INVENTORY_ITEM` |
| Task | `ACCEPT_TASK`, `ALLOCATE_TASK`, `SET_TASK_HOLD`, `ABANDON_TASK` |
| Overclock | `SET_OVERCLOCK_PROFILE`, `SET_MANUAL_OVERCLOCK` |
| Research | `START_RESEARCH`, `CANCEL_RESEARCH` |
| Blueprint | `SAVE_BLUEPRINT`, `INSTANTIATE_BLUEPRINT`, `RENAME_BLUEPRINT` |
| Benchmark | `START_BENCHMARK`, `CANCEL_BENCHMARK` |
| Tutorial | `ACKNOWLEDGE_TUTORIAL_STEP`, `SET_GUIDANCE_MODE` |
| Diagnostics | `TRIGGER_DIAGNOSTIC_PULSE` |
| Debug | comenzi incluse doar în build-urile de dezvoltare |

### 11.2 Atomicitate

Validarea se execută înainte de mutație. Pentru operații complexe, simulatorul calculează un patch într-un draft intern, validează invariantele și îl comite complet.

Exemple de respingere:

- cash insuficient;
- research lipsă;
- footprint în afara grilei;
- coliziune;
- port incompatibil;
- blueprint cu module blocate;
- benchmark pornit fără configurație validă;
- task allocation către un cluster oprit;
- profil Manual în afara limitelor.

Codurile de respingere sunt stabile și localizate în UI. Mesajele umane nu se stochează în simulator.

## 12. Evenimente

Un eveniment descrie un fapt deja produs. Evenimentele includ `eventId`, `tick`, `kind`, `severity` și payload. Ele pot alimenta notificări, audio, tutorial, achievements și event log.

Evenimente obligatorii:

```text
COMMAND_REJECTED
DESIGN_APPLIED
MODULE_PURCHASED
MODULE_SHUTDOWN
THERMAL_WARNING_ENTERED
THERMAL_WARNING_CLEARED
TASK_ACCEPTED
TASK_PHASE_COMPLETED
TASK_COMPLETED
TASK_DEADLINE_AT_RISK
TASK_FAILED
RESEARCH_STARTED
RESEARCH_COMPLETED
BLUEPRINT_SAVED
BLUEPRINT_INSTANTIATED
BENCHMARK_STARTED
BENCHMARK_COMPLETED
BENCHMARK_FAILED
TUTORIAL_STEP_COMPLETED
ACHIEVEMENT_UNLOCKED
MUSEUM_SNAPSHOT_CREATED
TRANSISTOR_REVEALED
AUTOSAVE_REQUESTED
```

Event bus-ul nu păstrează progresul. Dacă UI ratează un eveniment, următorul snapshot trebuie să conțină starea corectă.

## 13. Ordinea unui tick

Durata fixă este `0.1` secunde de simulare.

Ordinea nu se schimbă fără ADR și actualizarea testelor de determinism:

1. preia și ordonează comenzile;
2. validează și aplică comenzile;
3. reconstruiește conectivitatea dirty;
4. calculează power demand și power delivery;
5. calculează workload allocation;
6. calculează heat generation;
7. actualizează temperaturile locale și limita globală;
8. aplică throttling, stability și shutdown;
9. calculează Theoretical și Useful Compute;
10. avansează task-uri și benchmark-uri;
11. avansează research;
12. aplică venituri, energie și costuri operaționale;
13. actualizează tutorial, achievements și campania;
14. emite evenimente;
15. generează datele dirty pentru snapshot.

Economia care depinde de compute folosește compute-ul rezultat în tick-ul curent. Costul de energie folosește consumul mediu din tick-ul curent.

## 14. Timp, pause și speed

Host-ul acceptă `1x`, `2x` și `4x`. Pause oprește tick-urile, dar permite navigarea, Design Mode și comenzi care nu cer avansarea timpului.

La `4x`, host-ul rulează patru tick-uri pentru fiecare interval real echivalent. Nu mărește `dt` și nu sare peste sisteme.

Catch-up-ul maxim într-un burst este 20 de tick-uri. Dacă tab-ul este suspendat mai mult, host-ul nu încearcă să simuleze toate tick-urile pe main thread. El creează un request separat de Offline Assist după revenire.

Modul debug poate folosi viteze mai mari sau `simulate N`, dar rulează aceeași funcție `step`.

## 15. RNG și replay

Vertical slice-ul folosește un generator determinist simplu și bine testat, de exemplu Mulberry32 sau PCG32. Algoritmul și conversia seed-ului nu se schimbă după publicarea unui save fără migrare.

Replay-ul minimal stochează:

```ts
interface ReplayLog {
  replayVersion: 1;
  seed: string;
  contentVersion: string;
  initialStateHash: string;
  commands: Array<{ tick: number; sequence: number; command: SimCommand }>;
  checkpoints: Array<{ tick: number; stateHash: string }>;
}
```

Testul principal rulează același replay de două ori și compară checkpoint-urile. Hash-ul folosește o serializare canonică, cu chei ordonate și fără setări de prezentare.

## 16. Formula Useful Compute

Formula centrală este:

```text
Useful Compute = Theoretical Compute
               × Power Factor
               × Thermal Factor
               × Memory Factor
               × Interconnect Factor
               × Suitability
               × Stability Factor
```

`ComputeBreakdown` păstrează fiecare factor și pierderea absolută asociată. Factorii operaționali standard se limitează între `0` și `1`. `Suitability` poate varia în vertical slice între `0.70` și `1.25`.

### 16.1 Theoretical Compute

```text
module compute = base compute × frequency ratio × operational ratio
cluster theoretical compute = sum of powered compute modules
```

Un modul aflat în shutdown are operational ratio `0`. Un modul în startup poate avea ramp-up definit în conținut.

### 16.2 Power Factor

```text
Power Factor = min(1, delivered power / requested power)
```

Power allocation urmează prioritățile: safety și cooling, memory și control, compute, I/O. Dacă livrarea scade sub minimum-ul unui modul, acesta intră în brownout și nu produce compute.

### 16.3 Thermal Factor

Fiecare modul definește `normalMaxC`, `warningMaxC`, `criticalMaxC` și `shutdownC`.

```text
temperature <= normalMaxC       factor = 1.00
normalMaxC .. warningMaxC       factor = lerp(1.00, 0.96)
warningMaxC .. criticalMaxC     factor = lerp(0.96, 0.65)
criticalMaxC .. shutdownC       factor = lerp(0.65, 0.10)
temperature >= shutdownC        factor = 0.00 și shutdown
```

Pentru cluster folosim media ponderată cu base compute a modulelor active. UI afișează și temperatura maximă separat.

### 16.4 Memory Factor

Task-ul nu pornește dacă memory capacity se află sub cerința minimă. După validare:

```text
capacity factor = min(1, available capacity / recommended capacity)
bandwidth factor = clamp(available bandwidth / required bandwidth, 0.25, 1)
Memory Factor = min(capacity factor, bandwidth factor)
```

### 16.5 Interconnect Factor

În vertical slice, interconnect-ul folosește conectivitate, hop count și congestion.

```text
latency penalty = clamp(extra latency / task latency tolerance, 0, 0.35)
congestion penalty = clamp(1 - delivered route bandwidth / requested bandwidth, 0, 0.45)
Interconnect Factor = clamp(1 - latency penalty - congestion penalty, 0.20, 1)
```

### 16.6 Suitability

Suitability compară capabilitățile clusterului cu tag-urile task-ului. Vertical slice-ul folosește un scor data-driven. Exemple:

- control și accumulator modules cresc SERIAL;
- mai multe arithmetic modules cresc PARALLEL până la limita I/O;
- delay-line memory ajută MEMORY-HEAVY;
- buffered I/O ajută BANDWIDTH;
- Boost ajută BURST, dar nu schimbă singur suitability.

### 16.7 Stability Factor

```text
Stability Factor = clamp(1 - retry rate - invalid sample rate, 0, 1)
```

Campania validează rezultatele. Erorile reduc compute-ul prin retry-uri. Nu livrează rezultate corupte.

## 17. Overclock

Preset-urile inițiale sunt data-driven:

| Profil | Frequency ratio | Voltage ratio | Rol |
|---|---:|---:|---|
| Eco | 0.80 | 0.90 | eficiență și temperatură |
| Balanced | 1.00 | 1.00 | operare nominală |
| Boost | 1.25 | 1.10 | performanță temporară |
| Manual | 0.65 până la 1.40 | 0.85 până la 1.20 | reglaj avansat |

Puterea dinamică folosește:

```text
Dynamic Power Factor = voltage ratio² × frequency ratio
```

Heat generation folosește puterea dinamică și eficiența termică a modulului.

Stabilitatea pornește de la binning-ul instanței, voltage headroom și temperatură. Boost trebuie să fie sigur pentru perioade scurte într-un sistem răcit corect, dar riscant în Sustained Benchmark fără headroom.

Schimbarea profilului se aplică la nivel de cluster. Manual păstrează valorile exacte în state. UI afișează estimarea înainte de confirmare.

## 18. Grid și Facility Canvas

Vertical slice-ul folosește o grilă pătrată de `24 × 16` tile-uri. Dimensiunea este configurabilă, dar fixtures și tutorialul folosesc această valoare.

Un tile are:

- coordonate;
- temperatură;
- blocking state;
- identificatorul modulului ocupant;
- capacitate de routing pe edge pentru data și power;
- airflow contribution;
- dirty flags de simulare și randare.

Modulele pot avea footprint între `1 × 1` și `3 × 2`. Rotația transformă footprint-ul și porturile.

### 18.1 Porturi și conexiuni

Tipuri de port în vertical slice:

- `power-in`;
- `power-out`;
- `data-in`;
- `data-out`;
- `data-bidirectional`;
- `airflow`.

Porturile adiacente compatibile se conectează automat dacă setarea auto-connect este activă. Rutele lungi folosesc A* ortogonal pe edge graph. Costul include distanță, congestion și crossing penalty.

Liquid cooling ports nu intră încă în model.

### 18.2 Validarea unui sistem

Pentru a produce compute, sistemul are nevoie de:

1. power source sau power distribution cu capacity contractată;
2. minimum un compute module;
3. control module;
4. memory module;
5. I/O valid pentru task-urile care îl cer;
6. rute de power și data;
7. temperatură sub shutdown.

Validatorul întoarce o listă ordonată de `ValidationIssue`, cu severity, entity și localization key.

## 19. Design Mode

La intrarea în Design Mode, simulatorul creează `DesignDraft` din layout-ul live. Mutările se aplică numai draft-ului. Sistemul live continuă să ruleze până la Apply, cu excepția pause-ului ales de jucător.

Draft-ul păstrează un command stack pentru undo și redo. Nu păstrează snapshot-uri complete după fiecare operație.

`APPLY_DESIGN` calculează:

- validarea layout-ului;
- costul pieselor noi;
- creditul pieselor eliminate;
- manopera;
- downtime în tick-uri;
- diferența estimată de compute, power și temperatură;
- task-urile aflate în risc.

UI afișează preview-ul și cere confirmare. Comanda finală include `draftRevision`. Dacă draft-ul s-a schimbat după preview, simulatorul respinge apply-ul și cere recalculare.

## 20. Thermal model

Modelul termic oferă hotspot-uri vizibile fără simulare CFD.

Fiecare tile păstrează temperatura în Celsius. La fiecare tick:

```text
heat input = sum(module heat watts on tile) × heatToTemperatureCoefficient × dt
local cooling = airflow and cooling contribution × dt
neighbor exchange = diffusion × sum(neighborTemp - tileTemp) × dt
global pressure = max(0, totalHeat - facilityExtractionCapacity) × globalCoefficient × dt

next temperature = current
                 + heat input
                 - local cooling
                 + neighbor exchange
                 + global pressure
                 + ambient recovery
```

Implementarea folosește double buffering. Toate temperaturile următoare se calculează din aceeași generație anterioară. Iterarea tile-urilor în altă ordine nu trebuie să schimbe rezultatul.

### 20.1 Stabilitate numerică

- coeficienții vin din `balancing.json`;
- temperaturile se limitează între `ambientC - 10` și `250°C`;
- `NaN` sau infinit declanșează o eroare de simulare și oprește tick-ul înainte de commit;
- testele verifică echilibrul, difuzia simetrică și răcirea după oprire;
- valorile nu se rotunjesc la fiecare tile update.

### 20.2 Heatmap

Simulatorul trimite temperaturile tile-urilor numai când se schimbă peste un epsilon sau când view-ul cere refresh complet. Renderer-ul mapează valorile pe o paletă accesibilă și poate reduce rezoluția în Reduced Effects.

Heatmap-ul reprezintă aceeași temperatură folosită de simulator. Nu creează o simulare vizuală separată.

## 21. Power model

Facility-ul cumpără o capacitate electrică abstractă. Nu simulăm tipul sursei de energie.

Power system calculează:

- contracted capacity;
- requested idle și load power;
- delivered power pe componentă;
- headroom;
- costul per tick;
- brownout și shutdown.

Cooling-ul primește prioritate de safety. Jucătorul poate vedea de ce compute-ul scade când capacity este depășită.

Costul energiei:

```text
energy kWh = power watts / 1000 × simulated seconds / 3600
cost = energy kWh × price per kWh
```

## 22. Task system

Task-urile sunt definiții de conținut. O instanță activă păstrează progresul, deadline-ul, allocation și faza curentă.

Categorii folosite:

- `service`, venit periodic și SLA;
- `project`, work finit și etape;
- `research-experiment`, produce Research Data sau Evidence Tags.

### 22.1 Lifecycle

```text
offered -> accepted -> active <-> hold -> completed
                            |           |
                            +-> failed <-+
                            +-> abandoned
```

Acceptarea verifică cerințele minime și un slot liber. Jucătorul poate accepta un task cu performanță insuficientă dacă cerințele hard sunt îndeplinite. UI afișează riscul de deadline înainte de confirmare.

### 22.2 Progres

```text
operations completed this tick = allocated Useful Compute × dt seconds
```

Pentru task-uri multi-phase, următoarea fază poate schimba tag-urile și cerințele. Progress-ul total și progress-ul fazei se păstrează separat.

### 22.3 Hold și abandon

Hold oprește alocarea de compute, dar deadline-ul continuă. Abandonul cere confirmare și aplică penalizarea definită. Task-urile tutorial pot avea reguli speciale explicite în conținut, fără hardcoding după ID în sistemul generic.

### 22.4 Tag-uri predictive

Tag-urile provin dintr-un enum controlat. UI poate calcula avertismente dinamice folosind un `TaskFitReport`:

```ts
interface TaskFitReport {
  runnable: boolean;
  hardBlocks: FitIssue[];
  warnings: FitIssue[];
  predictedUsefulCompute: number;
  predictedCompletionTicks: number | null;
  deadlineMarginTicks: number | null;
  recommendedActions: Recommendation[];
}
```

Recomandările trebuie să indice o cauză: cooling, power, memory, routing, overclock sau alt cluster. Sistemul nu declară automat că Boost este obligatoriu.

## 23. Research system

Vertical slice-ul folosește 10 noduri. Un nod poate cere Cash, Research Data, compute rezervat, durată, prerequisites și Evidence Tags.

State-uri:

```text
locked -> available -> active -> completed
                     -> cancelled
```

Un singur research activ la început. Al doilea slot nu intră în vertical slice.

Compute rezervat pentru research reduce compute-ul disponibil task-urilor. Jucătorul controlează procentul între minimum-ul nodului și limita disponibilă.

Nodul final `transistor-theory` cere benchmark-urile și research-ul mandatory. Finalizarea lui produce reveal-ul, Museum snapshot-ul și finalul vertical slice-ului. Nu creează componente transistor.

## 24. Blueprint system

Vertical slice-ul permite un blueprint de subansamblu. Schema susține tipurile viitoare, dar UI expune doar `subassembly`.

Blueprint-ul stochează:

- ID și nume;
- version integer;
- tip;
- module cu poziții relative și rotații;
- conexiuni interne;
- profilul implicit;
- required research IDs;
- content version;
- bounding box;
- compute, power și thermal summary calculate la salvare.

Nu stochează instance IDs din facility. La instanțiere, simulatorul creează ID-uri noi.

Validarea verifică:

- conținut existent;
- research deblocat;
- cash și inventory;
- footprint;
- rute interne;
- poziția în grilă;
- compatibilitatea versiunii.

Exportul de blueprint este posibil ulterior. În 0.1, salvăm blueprint-ul în save și îl putem instanția în același run.

## 25. Benchmark system

### 25.1 Peak Throughput

- durată: 15 secunde simulate;
- Boost și Manual sunt permise;
- scor: Useful Compute mediu, cu bonus mic pentru vârf numai dacă minimum 90% dintre samples sunt valide;
- fail: shutdown, valid sample rate sub prag sau compute sub target.

### 25.2 Sustained Stability

- durată: 120 secunde simulate;
- scor: Useful Compute mediu, eficiență energetică și headroom termic;
- cere stabilitate medie, temperatură sub critical și zero shutdown-uri;
- retry rate intră în scor și poate produce fail.

Rezultatul salvează:

```ts
interface BenchmarkResult {
  benchmarkId: string;
  passed: boolean;
  startedAtTick: number;
  durationTicks: number;
  averageUsefulComputeFlops: number;
  peakUsefulComputeFlops: number;
  peakPowerWatts: number;
  averagePowerWatts: number;
  maxTemperatureC: number;
  retryRate: number;
  validSampleRate: number;
  costUsd: number;
  overclockSummary: Record<string, OverclockSettings>;
}
```

Rezultatul este read-only după finalizare. Repetarea benchmark-ului creează o intrare nouă și actualizează recordul local dacă scorul este mai bun.

## 26. Economia vertical slice-ului

Economia folosește USD istorici ca unitate tematică, cu valori ajustate pentru gameplay. Nu pretindem că fiecare cost reprezintă un preț arhivistic exact.

Surse de venit:

- recompensa task-urilor;
- venit periodic din Services;
- granturi mici din tutorial și research;
- salvage sau vânzarea inventarului.

Costuri:

- module;
- power capacity;
- energie consumată;
- manoperă la Apply;
- research;
- penalizări de contract;
- intervenție după emergency shutdown.

Vertical slice-ul nu permite game over financiar. Dacă jucătorul ar intra într-un hard lock, tutorial recovery oferă o singură restructurare clar marcată. Bot-ul de balans trebuie să finalizeze jocul fără recovery în strategia de bază.

## 27. Conținut și validare

Fișiere obligatorii:

```text
content/
  modules.json
  tasks.json
  research.json
  era.json
  balancing.json
  ro/common.json
  en/common.json
```

Loader-ul:

1. parsează JSON;
2. validează fiecare fișier cu Zod;
3. verifică unicitatea ID-urilor;
4. verifică referințele între fișiere;
5. detectează cicluri în research;
6. verifică localizările obligatorii;
7. produce `ContentBundle` immutable;
8. refuză pornirea unui new game dacă există erori.

În development, erorile afișează path-ul exact. În production, jocul afișează un ecran de recovery și permite exportul raportului tehnic.

### 27.1 Reguli pentru ID-uri

- lowercase kebab-case;
- prefix semantic unde ajută, de exemplu `module-`, `task-`, `research-`;
- ID-ul nu se schimbă după intrarea într-un save public;
- textul localizat nu este folosit drept ID;
- sort order apare explicit în conținut.

### 27.2 Content version

Vertical slice-ul începe cu `contentVersion: "0.1.0"`. O schimbare de balans compatibilă poate crește patch-ul. Ștergerea sau schimbarea semanticii unui ID cere migrare și versiune minoră sau majoră.

## 28. Snapshot-uri pentru UI

Simulatorul nu trimite întregul `GameState` la fiecare tick. El produce snapshot-uri normalizate pentru consumatori.

`UiSnapshot` include:

- header resources;
- clock și campaign objective;
- task cards;
- telemetry summary;
- selection inspector;
- research summary;
- alerts;
- command availability;
- revision numbers pentru grid și charts.

`GridViewModel` include numai elementele vizibile sau schimbate:

- grid size și camera constraints;
- module visuals;
- route visuals;
- temperatures sau heatmap patch;
- selection și hover state primit din UI bridge;
- placement validation;
- animation cues cu event IDs.

Snapshot-ul este immutable la graniță. În development poate fi deep-frozen.

## 29. Contractul React

React selectează date prin funcții mici:

```ts
selectHeader(snapshot)
selectActiveTasks(snapshot)
selectTelemetry(snapshot, preset)
selectInspector(snapshot, selectedEntityId)
selectAvailableBuildItems(snapshot, filters)
selectResearchTree(snapshot)
```

Componentele nu primesc `GameState`. Ele primesc view models dedicate.

Optimistic UI este permis doar pentru stare vizuală reversibilă, cum ar fi deschiderea unui panou. Plasarea unui modul apare ca ghost până când comanda este acceptată.

## 30. Contractul PixiJS

Renderer-ul primește:

```ts
interface PixiGridAdapter {
  mount(container: HTMLElement): void;
  update(viewModel: GridViewModel): void;
  setInteractionMode(mode: GridInteractionMode): void;
  setReducedEffects(enabled: boolean): void;
  subscribeIntents(listener: (intent: GridIntent) => void): () => void;
  resize(width: number, height: number, devicePixelRatio: number): void;
  destroy(): void;
}
```

`update` compară revision IDs și aplică patch-uri. Nu reconstruiește scena complet la fiecare snapshot.

Coordonatele folosesc trei spații declarate:

- screen pixels;
- world pixels;
- grid coordinates.

Conversiile stau într-un singur modul testat. Camera nu influențează pozițiile din simulator.

## 31. Layout și rezoluții

Rezoluția principală este 1920 × 1080. Layout-ul folosește CSS Grid pentru frame-ul aplicației și PixiJS pentru canvas.

### 31.1 Layout 1920 × 1080

- Header: 64 px;
- Left Rail: 72 px compact, 216 px extins;
- Right Operations Stack: 360 până la 440 px;
- Bottom Build Tray: 180 până la 260 px când este extins;
- Center Workspace: restul spațiului;
- minimum canvas util în Build Mode: 980 × 620 px.

Valorile sunt design tokens și pot fi ajustate în testarea vizuală. Nu se hardcodează în componente diferite.

### 31.2 Breakpoints funcționale

| Viewport | Comportament |
|---|---|
| 1920 × 1080 și mai mare | layout complet, Telemetry Standard sau Diagnostics |
| 1600 × 900 | right panel redus, build tray mai compact |
| 1366 × 768 | Left Rail icon-only, Telemetry Compact implicit, graphs în tab |
| 1280 × 720 | minimum funcțional, un singur panou secundar extins, drawer pentru event log |

La toate rezoluțiile, jucătorul trebuie să poată construi, selecta, vedea alertele și controla timpul. Nu ascundem Temperature, Power sau task-ul activ.

### 31.3 Fullscreen și browser chrome

Jocul oferă Fullscreen, dar nu îl cere. Layout-ul răspunde la dimensiunea reală a containerului. Nu presupune că viewport-ul browserului are exact rezoluția monitorului.

## 32. Input și shortcut-uri

Input principal: mouse și tastatură.

Shortcut-uri minime:

| Acțiune | Shortcut |
|---|---|
| Build Mode | `B` |
| Operations | `O` |
| Research | `R` |
| Info Lens | `I` |
| Pause | `Space` |
| Speed 1x/2x/4x | `1`, `2`, `3` |
| Rotate | `Q` și `E` |
| Undo/redo în Design Mode | `Ctrl+Z`, `Ctrl+Shift+Z` |
| Copy/paste selection | `Ctrl+C`, `Ctrl+V` |
| Delete selection | `Delete` |
| Cancel tool/dialog | `Escape` |
| Heatmap | `H` |
| Diagnostic Pulse | `D` |

Shortcut-urile nu se execută când utilizatorul scrie într-un input. Toate acțiunile au alternativă vizibilă în UI.

## 33. Save system

### 33.1 Separarea payload-ului

```ts
interface SavePayloadV1 {
  saveVersion: 1;
  contentVersion: string;
  createdAtIso: string;
  savedAtIso: string;
  slotId: string;
  gameState: GameState;
  settings: PlayerSettings;
  localStats: LocalStats;
}

interface SaveEnvelope {
  format: "overclock-save";
  compression: "none" | "gzip";
  checksumAlgorithm: "sha-256";
  checksum: string;
  payload: string;
}
```

Checksum-ul verifică payload-ul canonic înainte de parse și migrare. El detectează coruperea accidentală. Nu reprezintă anti-cheat.

### 33.2 IndexedDB

Object stores:

- `saves`, key `slotId`;
- `autosaves`, key compus din slot și sequence;
- `settings`, key singleton;
- `blueprints`, rezervat pentru export separat ulterior;
- `reports`, playtest reports locale.

Autosave-ul păstrează trei rotații. Declanșatori:

- la fiecare 60 secunde reale dacă state-ul este dirty;
- după task completion;
- după research completion;
- înainte și după benchmark final;
- la finalul vertical slice-ului;
- la `visibilitychange` când operația poate fi terminată rapid.

### 33.3 Migrații

Migrațiile sunt funcții secvențiale:

```ts
type Migration = (input: unknown) => unknown;

const migrations = {
  1: migrateV1ToV2,
};
```

Flow de import:

1. citește envelope;
2. verifică format și checksum;
3. parsează payload-ul ca `unknown`;
4. detectează versiunea;
5. rulează migrațiile pe o copie;
6. validează schema curentă;
7. verifică content references;
8. oferă preview;
9. scrie un slot nou sau cere confirmare pentru overwrite.

Originalul importat nu se modifică.

## 34. Localizare

Româna și engleza există din prima fază de conținut.

Namespace-uri recomandate:

```text
common
ui
modules
tasks
research
tutorial
events
errors
encyclopedia
```

Contracte:

- conținutul referă `nameKey`, `descriptionKey` și alte chei;
- simulatorul emite localization keys și parametri, nu propoziții;
- formatarea numerelor folosește locale, dar unitățile gameplay rămân aceleași;
- imaginile nu conțin text;
- testul de conținut verifică existența cheilor în ambele limbi;
- UI trebuie să suporte texte engleze cu 30% mai lungi decât varianta de bază fără clipping.

## 35. Audio și efecte

Audio nu intră în simulator. Evenimentele pornesc cues prin `AudioService`.

Categorii: Music, UI, Machinery și Alerts. Setările au volume separate și mute global.

Efectele vizuale folosesc event IDs pentru deduplicare. Dacă UI se reconectează la worker, nu redă din nou toate evenimentele istorice.

Reduced Effects reduce particulele, scanlines, pulse frequency și heatmap resolution. Alertele, contururile și valorile exacte rămân.

## 36. Tutorial

Tutorialul este un state machine data-driven, cu condiții observabile și acțiuni UI. El nu injectează mutații directe în simulator.

Pași principali:

1. alocă Human Computers;
2. finalizează calculul introductiv;
3. intră în Build Mode;
4. cumpără și plasează power;
5. plasează compute, control și memory;
6. conectează sistemul;
7. acceptă primul proiect;
8. observă deadline risk;
9. activează Boost;
10. observă temperatura;
11. instalează airflow;
12. finalizează proiectul;
13. începe research;
14. salvează blueprint-ul.

Tutorialul poate bloca temporar controale numai când este necesar pentru primul pas. După tutorial, nu lasă reguli speciale permanente în state.

Moduri: Simple Guidance, Engineering Guidance și Skip. Skip acordă resursele și unlock-urile tutorialului printr-o comandă explicită testată.

## 37. Museum snapshot

La final, simulatorul creează un snapshot immutable al configurației:

- numele sistemului;
- anul;
- module și layout thumbnail data;
- Theoretical și Useful Compute;
- power mediu și peak;
- temperatură medie și maximă;
- benchmark records;
- cost total;
- research finalizat;
- timpul sesiunii;
- arhitectura, `vacuum-tube`.

Thumbnail-ul se generează dintr-un view model separat. Save-ul păstrează datele, nu bitmap-ul. UI poate regenera imaginea la rezoluția necesară.

## 38. Erori și recovery

Categorii:

- content validation error;
- recoverable command rejection;
- save/import error;
- renderer error;
- simulator invariant violation;
- worker communication error.

Un invariant failure:

1. oprește avansarea simulării;
2. păstrează ultimul checkpoint valid;
3. afișează recovery dialog;
4. permite exportul unui diagnostic report fără date personale;
5. permite reload din ultimul autosave.

Nu folosim silent catch pentru erori de domeniu.

## 39. Devtools și balansare

Build-ul de development oferă o consolă internă. Comenzile minime:

```text
time 1|2|4
pause
simulate <ticks|duration>
cash add <amount>
research add <amount>
research unlock <id>
task complete <id>
heatmap toggle
thermal stress <value>
benchmark run <id>
blueprint validate <id>
validate save
export snapshot
report bottlenecks
profile sim
profile render
```

Comenzile de debug nu intră în production bundle sau sunt eliminate prin build flag. Orice comandă care schimbă simulatorul folosește același command pipeline și este marcată `source: "debug"`.

Bot-ul de balans din vertical slice poate:

- cumpăra dintr-o listă de build templates;
- accepta task-uri după un scor simplu;
- schimba profilul de overclock;
- începe research;
- rula până la final sau hard lock;
- produce timpi pentru milestones și cauzele blocării.

Nu avem nevoie de AI pentru bot. O policy deterministă și câteva variante de strategie sunt suficiente.

## 40. Telemetry și grafice

Simulatorul colectează serii brute limitate. Bridge-ul agregă datele pentru grafice.

Serii vertical slice:

- Useful Compute;
- Theoretical Compute;
- power draw și headroom;
- average și maximum temperature;
- memory bandwidth usage;
- retry rate;
- allocation pe task;
- cash flow.

Sampling:

- sample intern la 1 Hz;
- maximum 3.600 samples per serie în sesiunea curentă;
- downsample pentru intervale lungi;
- grafice UI actualizate la 1 sau 2 Hz;
- istoricul complet nu intră în fiecare snapshot.

Telemetry presets:

- Compact, alerte și bottleneck principal;
- Standard, resurse și task-uri;
- Diagnostics, formule și grafice.

Panoul și secțiunea Graphs pot fi restrânse independent.

## 41. Securitate și confidențialitate

Vertical slice-ul este singleplayer și local-first.

- nu trimite analytics;
- nu cere cont;
- nu execută cod din save sau content;
- tratează importul ca date neîncrezătoare;
- limitează dimensiunea fișierului importat;
- validează toate string-urile și numerele;
- nu redă HTML din conținut;
- rapoartele de playtest nu includ nume, path-uri locale sau identificatori ai dispozitivului.

## 42. Bugete de performanță

Hardware țintă: Intel i7-2600, GTX 1050, 8 GB RAM, Windows 10, browser Chromium modern.

| Metrică | Buget |
|---|---:|
| FPS la 1920 × 1080 | 60 normal, minimum stabil 45 în scene dense |
| Reduced Effects | 30 sau 45 FPS blocat, fără pierdere de informație |
| Tick simulator p95 | sub 4 ms |
| Tick simulator max normal | sub 8 ms |
| Render CPU p95 | sub 12 ms |
| Snapshot UI | maximum 10 Hz |
| Charts | 1 până la 2 Hz |
| Startup până la meniu | sub 5 secunde pe hardware țintă |
| Save normal | sub 250 ms |
| Import vertical slice | sub 1 secundă |
| Obiecte detaliate vizibile | maximum 2.000 înainte de agregare |
| Memorie tab după 60 minute | țintă sub 500 MB |

Performance fixtures trebuie să includă grila ocupată în proporție de 75%, heatmap activ, două task-uri, Boost și Telemetry Diagnostics.

## 43. Test strategy

### 43.1 Unit tests

- RNG și seed parsing;
- fiecare factor Useful Compute;
- overclock power și stability;
- thermal diffusion și cooling;
- footprint rotation;
- port compatibility;
- task fit și deadline prediction;
- research prerequisites și cycle detection;
- cash rounding și energy cost;
- canonical serialization.

### 43.2 Integration tests

- command queue și atomic rejection;
- build valid, power delivery și compute;
- Boost produce mai mult compute și mai mult heat;
- emergency shutdown și cooldown;
- task multi-phase;
- research rezervă compute;
- blueprint save și instantiate;
- Peak și Sustained benchmark;
- save round-trip;
- import invalid și migrare;
- tutorial skip.

### 43.3 Determinism tests

- același seed și command log produc același state hash;
- save/load la jumătatea replay-ului produce același final;
- viteza host-ului nu schimbă rezultatul pentru același număr de tick-uri;
- ordinea de iterare a obiectelor de conținut nu schimbă rezultatul.

### 43.4 End-to-end tests

- new game și primul task;
- Build Tray, cumpărare și placement;
- tooltip pentru task tags;
- overclock și thermal warning;
- save, reload și continuare;
- blueprint workflow;
- benchmark final;
- switch română/engleză;
- layout la cele patru rezoluții;
- Reduced Effects.

### 43.5 Performance tests

Testele automate raportează mediana, p95 și max. Pragurile severe pot bloca CI. Fluctuațiile mici produc raport, nu fail aleator. Măsurarea finală se face și manual pe PC-ul țintă.

## 44. Quality gates

Comanda standard a repository-ului trebuie să fie:

```text
pnpm validate
```

Ea rulează în ordine:

1. format check;
2. lint;
3. typecheck;
4. content validation;
5. unit și integration tests;
6. production build.

Playwright și performance suite pot avea comenzi separate, dar devin obligatorii în fazele care le introduc.

## 45. Criterii de acceptare tehnică

Vertical slice-ul este gata pentru playtest extern când:

- new game ajunge la primul task în maximum 3 minute pentru un tester nou;
- există două configurații valide cu profiluri de performanță diferite;
- Explain Loss identifică corect bottleneck-ul principal în fixtures;
- Boost crește compute-ul și poate crea risc termic;
- cooling rezolvă riscul fără click repetitiv;
- blueprint-ul poate fi salvat și instanțiat;
- ambele benchmark-uri pot fi trecute prin decizii diferite;
- save/load și export/import păstrează rezultatul determinist;
- româna și engleza nu au chei lipsă;
- jocul rămâne utilizabil la 1280 × 720;
- performance fixture respectă bugetele pe hardware-ul țintă;
- nu există pauză obligatorie fără acțiune mai lungă de 5 minute;
- `pnpm validate` trece dintr-un checkout curat.

## 46. Definition of Done pentru fiecare task Codex

Codex trebuie să livreze:

1. implementarea limitată la task;
2. teste pentru comportamentul schimbat;
3. actualizarea documentației dacă API-ul public s-a schimbat;
4. comenzile de verificare rulate;
5. rezultatele verificărilor;
6. assumptions și riscuri rămase;
7. lista fișierelor schimbate.

Codex nu începe faza următoare automat.

## 47. Decizii amânate

Următoarele nu blochează vertical slice-ul:

- numele comercial final și subtitlul;
- Electron ca fallback pentru Tauri;
- export separat de blueprint;
- formatul final pentru achievements grid;
- art style final al tuturor erelor;
- online leaderboard;
- mod support.

## 48. Punctul de pornire

Prima sesiune Codex execută numai `docs/phases/00_SETUP.md`, folosind promptul `docs/prompts/00_FIRST_CODEX_PROMPT.md`.

Faza 0 nu implementează gameplay complet. Ea creează repository-ul, quality gates, contractele, content loader-ul minimal, shell-ul aplicației și un smoke test. După validarea ei, Faza 1 construiește simulatorul headless.
