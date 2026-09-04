import { assertCanonicalSerializable } from "../replay/canonicalState.ts";
import { assertValidBlueprintState } from "../blueprints/blueprintState.ts";
import type { GameState } from "./types.ts";

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function freezeOwnedState(
  root: unknown,
  verifiedFrozenObjects: WeakSet<object>,
  workStack: unknown[],
): void {
  workStack.push(root);
  while (workStack.length > 0) {
    const value = workStack.pop();
    if (value === null || typeof value !== "object" || verifiedFrozenObjects.has(value)) continue;
    if (Array.isArray(value)) {
      const children = value as unknown[];
      // eslint-disable-next-line @typescript-eslint/prefer-for-of -- avoids iterators during tick commit.
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child !== null && typeof child === "object" && !verifiedFrozenObjects.has(child)) {
          workStack.push(child);
        }
      }
    } else {
      const record = value as Record<string, unknown>;
      for (const key in record) {
        if (!Object.hasOwn(record, key)) continue;
        const child = record[key];
        if (child !== null && typeof child === "object" && !verifiedFrozenObjects.has(child)) {
          workStack.push(child);
        }
      }
    }
    if (!Object.isFrozen(value)) Object.freeze(value);
    verifiedFrozenObjects.add(value);
  }
}

export class AuthoritativeState {
  private state: GameState;
  private readonly verifiedFrozenObjects = new WeakSet<object>();
  private readonly freezeWorkStack: unknown[] = [];

  constructor(initialState: GameState) {
    assertCanonicalSerializable(initialState);
    assertValidBlueprintState(initialState.blueprints);
    this.state = cloneState(initialState);
    freezeOwnedState(this.state, this.verifiedFrozenObjects, this.freezeWorkStack);
  }

  readInternal(): GameState {
    return this.state;
  }

  snapshot(): GameState {
    return cloneState(this.state);
  }

  replaceSnapshot(state: GameState): void {
    assertCanonicalSerializable(state);
    assertValidBlueprintState(state.blueprints);
    this.state = cloneState(state);
    freezeOwnedState(this.state, this.verifiedFrozenObjects, this.freezeWorkStack);
  }

  commitOwned(candidate: GameState): void {
    freezeOwnedState(candidate, this.verifiedFrozenObjects, this.freezeWorkStack);
    this.state = candidate;
  }
}
