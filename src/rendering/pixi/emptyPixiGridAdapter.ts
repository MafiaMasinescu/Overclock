// Kept as a compatibility entry point for the Phase 0 shell imports. The
// adapter is now the real Task 23 Pixi renderer, not an empty canvas shim.
export { createPixiGridAdapter } from "./pixiGridAdapter.ts";
export { createPixiGridAdapter as createEmptyPixiGridAdapter } from "./pixiGridAdapter.ts";
