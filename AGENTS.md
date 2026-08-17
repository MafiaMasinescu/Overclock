# OVERCLOCK repository instructions

## Mission

Build the OVERCLOCK vertical slice described in `docs/TDD_VERTICAL_SLICE.md`. Preserve the game vision in `docs/GDD.md`. Work on one approved phase or task at a time.

## Non-negotiable architecture

1. The simulator is authoritative and independent from React, PixiJS, browser APIs and wall-clock time.
2. Simulation state contains serializable data only. Do not store DOM nodes, Pixi objects, React objects, functions, `Map`, `Set`, class instances or `Date` objects in authoritative state.
3. All simulation changes enter through typed commands and are applied at tick boundaries.
4. The fixed simulation tick is 100 milliseconds. Results must be deterministic for the same seed and ordered command stream.
5. Never call `Math.random()` or `Date.now()` inside the simulation domain. Use the injected seeded RNG and simulation time.
6. React owns menus, panels, dialogs, accessibility and local UI state. React must not render one component per grid tile.
7. PixiJS owns the grid scene, connections, heatmap and canvas effects. PixiJS must not mutate simulation state.
8. The bridge converts simulator snapshots into React selectors and PixiJS view models.
9. Content is data-driven and validated before a new game or save is loaded.
10. Save migrations are explicit, versioned and tested. Never silently discard unknown or invalid save data.

## Scope control

Do not implement systems outside vertical slice 0.1 unless the current phase explicitly requires an extension point.

Do not implement these features now:

- full campaign after 1948;
- transistor generation gameplay;
- company public/private branch;
- prestige or Boundary Reset;
- Reliability Challenge and permanent component damage;
- automation rule editor;
- portfolio and multiple facilities;
- quantum or Beyond Silicon;
- online analytics, accounts, cloud saves or global leaderboards;
- Steam integration;
- mobile and touch controls;
- mod support.

Create interfaces for future expansion only when the vertical slice already needs the boundary. Do not build speculative frameworks.

## Coding rules

- Use TypeScript strict mode.
- Avoid `any`. If an external boundary requires it, accept `unknown` and validate or narrow it.
- Keep domain functions pure where practical.
- Prefer small modules with clear names over generic utility files.
- Use domain units in names, for example `temperatureC`, `powerWatts`, `computeFlops`, `durationTicks`.
- Keep identifiers stable. Content IDs use lowercase kebab-case.
- Never duplicate a formula in UI code. UI displays values supplied by selectors or explainability records.
- Never make a gameplay balance change without updating its content file and the relevant test or fixture.
- Write comments for decisions and constraints, not a translation of obvious code.
- Keep Romanian and English strings out of domain code. Use localization keys.

## Command and state rules

- Validate every command before applying it.
- Rejected commands return a stable rejection code and do not mutate state.
- A command either applies completely or has no effect.
- Store command order and tick for replay diagnostics.
- Events describe completed facts. Commands describe requested actions.
- Event handlers may update presentation, audio and logs. They must not become a second source of game state.

## Testing rules

Every behavior change needs the smallest relevant test.

Required gates before finishing a task:

1. TypeScript typecheck.
2. Unit and integration tests.
3. Content validation.
4. Production build.
5. Relevant Playwright test after the UI exists.

Critical tests include deterministic replay, save round-trip, migrations, command rejection atomicity, thermal equilibrium, thermal shutdown, Useful Compute explainability, task progression, benchmark validation and blueprint validation.

Do not update snapshots or expected numbers merely to make failing tests pass. First explain why the expected behavior changed.

## Performance rules

Primary design resolution is 1920 × 1080. The target machine is an Intel i7-2600 with GTX 1050.

- simulation tick p95 under 4 ms in the vertical slice stress fixture;
- render CPU time p95 under 12 ms at 60 FPS;
- React telemetry updates at no more than 10 Hz;
- charts update at 1 or 2 Hz;
- use dirty updates for grid and heatmap;
- avoid per-frame allocations in hot rendering paths;
- avoid blur filters and unbounded particle systems;
- Reduced Effects must preserve gameplay information.

Do not claim a performance improvement without a repeatable measurement.

## Git and task discipline

- Inspect the worktree before editing.
- Preserve unrelated user changes.
- Do not use destructive Git commands.
- Keep each task limited to the requested phase.
- At the end, report files changed, commands run, test results, assumptions and remaining risks.
- Do not move to the next phase without explicit approval.

## Decision changes

If implementation reveals that a TDD decision is impractical, create an ADR proposal. Include context, options, tradeoffs, recommended decision and migration impact. Do not silently alter the architecture or the GDD.

