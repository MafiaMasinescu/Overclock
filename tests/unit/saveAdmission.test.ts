import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { createInitialGameState } from "../../src/sim/core/createInitialGameState.ts";
import { admitGameStateForSave } from "../../src/save/stateAdmission.ts";
import { PersistenceError } from "../../src/save/persistenceErrors.ts";

function createState() {
  const content = loadContentBundle();
  return { content, state: createInitialGameState({ content, seed: "admission-seed" }) };
}

describe("strict durable GameState admission", () => {
  test("admits the initial state and preserves the state hash", () => {
    const { content, state } = createState();
    const admitted = admitGameStateForSave({
      state,
      content,
      nextQueueSequence: 0,
      expectedStateHash: hashCanonicalState(state),
    });

    expect(admitted).toEqual(state);
    expect(hashCanonicalState(admitted)).toBe(hashCanonicalState(state));
  });

  test("returns an owned detached state and honors the persisted queue sequence", () => {
    const { content, state } = createState();
    const admitted = admitGameStateForSave({ state, content, nextQueueSequence: 17 });

    expect(admitted).not.toBe(state);
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(() => {
      (admitted as { tick: number }).tick = 1;
    }).toThrow();
  });

  test.each([
    ["root", (value: Record<string, unknown>) => (value["extra"] = true)],
    [
      "nested",
      (value: Record<string, unknown>) =>
        ((value["clock"] as Record<string, unknown>)["extra"] = true),
    ],
    [
      "prototype",
      (value: Record<string, unknown>) => {
        Object.setPrototypeOf(value, { hostile: true });
      },
    ],
    [
      "symbol",
      (value: Record<string, unknown>) => Object.defineProperty(value, Symbol("x"), { value: 1 }),
    ],
  ])("rejects %s structural corruption without mutating the source", (_, corrupt) => {
    const { content, state } = createState();
    const candidate = structuredClone(state) as unknown as Record<string, unknown>;
    corrupt(candidate);
    const before = hashCanonicalState(state);

    expect(() =>
      admitGameStateForSave({ state: candidate, content, nextQueueSequence: 0 }),
    ).toThrow(PersistenceError);
    expect(hashCanonicalState(state)).toBe(before);
  });

  test("rejects unsafe ticks and impossible campaign years", () => {
    const { content, state } = createState();
    const stale = structuredClone(state);
    stale.tick = 12_000;
    stale.clock.simulatedSeconds = 1_200;
    stale.campaign.currentYear = 1946;

    expect(() => admitGameStateForSave({ state: stale, content, nextQueueSequence: 0 })).toThrow(
      PersistenceError,
    );

    const unsafe = structuredClone(state);
    unsafe.tick = Number.MAX_SAFE_INTEGER + 1;
    expect(() => admitGameStateForSave({ state: unsafe, content, nextQueueSequence: 0 })).toThrow(
      PersistenceError,
    );
  });

  test("rejects a mismatched expected state hash", () => {
    const { content, state } = createState();
    expect(() =>
      admitGameStateForSave({
        state,
        content,
        nextQueueSequence: 0,
        expectedStateHash: "0000000000000000",
      }),
    ).toThrow(PersistenceError);
  });

  test("rejects nested accessors without invoking the getter", () => {
    const { content, state } = createState();
    const candidate = structuredClone(state) as unknown as Record<string, unknown>;
    let invoked = false;
    const power = (candidate["facility"] as Record<string, unknown>)["power"] as Record<
      string,
      unknown
    >;
    Object.defineProperty(power, "byModule", {
      enumerable: true,
      get: () => {
        invoked = true;
        return {};
      },
    });

    expect(() =>
      admitGameStateForSave({ state: candidate, content, nextQueueSequence: 0 }),
    ).toThrow(PersistenceError);
    expect(invoked).toBe(false);
  });

  test("rejects cycles and sparse arrays at the public admission boundary", () => {
    const { content, state } = createState();
    const cyclic = structuredClone(state) as unknown as Record<string, unknown>;
    cyclic["self"] = cyclic;
    expect(() => {
      admitGameStateForSave({ state: cyclic, content, nextQueueSequence: 0 });
    }).toThrow(expect.objectContaining({ code: "INVALID_FORMAT" }));

    const sparse = structuredClone(state) as unknown as Record<string, unknown>;
    const facility = sparse["facility"] as {
      thermalTiles: { position: { x: number; y: number } }[];
    };
    const sparseThermalTiles = facility.thermalTiles.slice(1);
    sparseThermalTiles.length = facility.thermalTiles.length;
    facility.thermalTiles = sparseThermalTiles;
    expect(() => {
      admitGameStateForSave({ state: sparse, content, nextQueueSequence: 0 });
    }).toThrow(expect.objectContaining({ code: "INVALID_FORMAT" }));
  });

  test("enforces bounded external traversal", () => {
    const { content, state } = createState();
    const candidate = structuredClone(state);
    candidate.seed = "x".repeat(16_385);

    expect(() =>
      admitGameStateForSave({ state: candidate, content, nextQueueSequence: 0 }),
    ).toThrow(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });
});
