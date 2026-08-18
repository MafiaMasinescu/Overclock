import { canonicalSerialize } from "../replay/canonicalState.ts";
import type { GameState } from "./types.ts";

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export class AuthoritativeState {
  private state: GameState;

  constructor(initialState: GameState) {
    canonicalSerialize(initialState);
    this.state = cloneState(initialState);
  }

  readInternal(): GameState {
    return this.state;
  }

  snapshot(): GameState {
    return cloneState(this.state);
  }

  commitOwned(candidate: GameState): void {
    this.state = candidate;
  }
}
