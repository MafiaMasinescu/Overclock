# OVERCLOCK Phase 0 Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the executable, validated Phase 0 foundation without implementing gameplay simulation.

**Architecture:** Keep authoritative contracts split by TDD boundary, load root JSON content through Zod into a deeply frozen bundle, and expose static UI data through a fake `GameClient`. React owns the five-region application shell and localization; PixiJS owns only an empty resizable canvas.

**Tech Stack:** pnpm, Vite, React, strict TypeScript, PixiJS 8, Zod, i18next/react-i18next, Vitest, Playwright, ESLint, Prettier.

**Spec:** `docs/phases/00_SETUP.md` (with `docs/TDD_VERTICAL_SLICE.md` and `AGENTS.md` as higher-level constraints)

## Global Constraints

- Work only on Phase 0; do not create the tick loop or gameplay systems.
- Keep `contentVersion` at `0.1.0` and preserve supplied contract semantics.
- Keep root `content/` as the canonical JSON pack.
- Use strict TypeScript and no `any`.
- UI and rendering must not import simulator mutators.
- Support 1920x1080, 1600x900, 1366x768, and 1280x720.

---

### Task 1: Toolchain and boundaries

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`
- Create: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `index.html`

**Interfaces:**
- Produces: `pnpm validate` running format, lint, typecheck, content validation, unit tests, and build in that order.

- [ ] Pin the supported package manager and exact direct dependencies in `package.json`.
- [ ] Configure strict TypeScript aliases and ESLint `no-restricted-imports` boundaries.
- [ ] Install with `corepack pnpm install` and retain `pnpm-lock.yaml`.
- [ ] Verify configuration with `corepack pnpm typecheck`; expected initial failures are only missing planned source files.

### Task 2: Contracts and content

**Files:**
- Move/adapt: `contracts/src/*.ts` into `src/sim`, `src/app`, `src/rendering`, `src/save`, and `src/content/schemas`
- Create: `src/content/loader/contentLoader.ts`, `src/content/loader/deepFreeze.ts`
- Test: `tests/unit/contentLoader.test.ts`, `tests/unit/contentValidation.test.ts`

**Interfaces:**
- Produces: `validateContent(input: RawContentPack): ContentValidationResult`
- Produces: `loadContentBundle(input?: RawContentPack): ContentBundle`

- [ ] Write tests proving valid content loads, an unknown research prerequisite reports an exact path, cycles fail, missing localizations fail, and the result is deeply immutable.
- [ ] Run the focused Vitest files and confirm they fail because loader behavior is absent.
- [ ] Implement Zod parsing, uniqueness, cross-reference, cycle, version, localization, and deep-freeze logic.
- [ ] Run the focused Vitest files and confirm they pass.

### Task 3: Fake client, localization, shell, and canvas

**Files:**
- Create: `src/app/game-client/fakeGameClient.ts`, `src/app/game-client/useGameClientSnapshot.ts`
- Create: `src/localization/i18n.ts`
- Create: `src/ui/layout/*`, `src/ui/workspaces/CenterWorkspace.tsx`, `src/rendering/pixi/emptyPixiGridAdapter.ts`
- Create: `src/app/App.tsx`, `src/app/bootstrap/main.tsx`, `src/styles.css`
- Test: `tests/unit/fakeGameClient.test.ts`, `tests/unit/localization.test.ts`

**Interfaces:**
- Produces: `createFakeGameClient(): GameClient`
- Produces: `createAppI18n(language): i18n`
- Produces: `createEmptyPixiGridAdapter(): PixiGridAdapter`

- [ ] Write focused fake-client and localization tests and verify expected failures.
- [ ] Implement immutable placeholder snapshots and language switching; verify tests pass.
- [ ] Implement the five-region responsive shell and lifecycle-safe empty Pixi adapter.
- [ ] Typecheck and fix only Phase 0 integration errors.

### Task 4: Smoke coverage and repository structure

**Files:**
- Create: TDD directory skeleton with `.gitkeep` only where no Phase 0 file exists.
- Create: `tests/e2e/phase0-smoke.spec.ts`
- Create: `tools/validate-content.ts`

**Interfaces:**
- Produces: Playwright checks for shell regions, all four viewports, canvas resizing, and Romanian/English switching.

- [ ] Add behavior-based Playwright coverage and a TypeScript content-validation CLI.
- [ ] Run content validation and unit tests.
- [ ] Install Playwright Chromium only if absent, then run the smoke suite when supported.

### Task 5: Final gates

**Files:**
- Inspect: all changed files and Git status.

**Interfaces:**
- Consumes: all prior task outputs.

- [ ] Run `corepack pnpm format:check`.
- [ ] Run `corepack pnpm lint`.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `corepack pnpm content:validate`.
- [ ] Run `corepack pnpm test:unit`.
- [ ] Run `corepack pnpm build`.
- [ ] Run `corepack pnpm validate`.
- [ ] Run `corepack pnpm test:e2e` if browser support is available.
- [ ] Review `git diff --check`, `git status --short`, and Phase 0 acceptance criteria before reporting.
