import { assertCanonicalSerializable } from "../replay/canonicalState.ts";
import type { GameState } from "./types.ts";

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function freezeOwnedState(value: unknown, verifiedFrozenObjects: WeakSet<object>): void {
  if (value === null || typeof value !== "object" || verifiedFrozenObjects.has(value)) return;
  for (const child of Object.values(value)) freezeOwnedState(child, verifiedFrozenObjects);
  if (!Object.isFrozen(value)) Object.freeze(value);
  verifiedFrozenObjects.add(value);
}

export class AuthoritativeState {
  private state: GameState;
  private readonly verifiedFrozenObjects = new WeakSet<object>();

  constructor(initialState: GameState) {
    assertCanonicalSerializable(initialState);
    this.state = cloneState(initialState);
    freezeOwnedState(this.state, this.verifiedFrozenObjects);
  }

  readInternal(): GameState {
    return this.state;
  }

  snapshot(): GameState {
    return cloneState(this.state);
  }

  replaceSnapshot(state: GameState): void {
    assertCanonicalSerializable(state);
    this.state = cloneState(state);
    freezeOwnedState(this.state, this.verifiedFrozenObjects);
  }

  commitOwned(candidate: GameState): void {
    freezeOwnedState(candidate, this.verifiedFrozenObjects);
    this.state = candidate;
  }
}
