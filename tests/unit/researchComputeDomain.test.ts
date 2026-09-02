import { describe, expect, test } from "vitest";

import {
  calculateEffectiveTaskShare,
  calculateResearchComputeResult,
  calculateResearchFactor,
  validateResearchComputeResult,
} from "../../src/sim/research/researchComputeDomain.ts";
import { canonicalSerialize } from "../../src/sim/replay/canonicalState.ts";
import { createSeededRngFromState } from "../../src/sim/rng/seededRng.ts";
import type { ActiveResearchState, ResearchComputeResultState } from "../../src/sim/core/types.ts";

function activeResearch(reservedComputeShare = 0.25): ActiveResearchState {
  return {
    nodeId: "research-stable-power-distribution",
    startedAtTick: 4,
    completedOperations: 10,
    reservedComputeShare,
  };
}

describe("pure Research Compute domain", () => {
  test("uses the no-active Research identity values", () => {
    expect(calculateResearchFactor(null)).toBe(1);
    expect(calculateResearchComputeResult(null, 900)).toBeNull();
  });

  test("calculates the factor at a minimum-style reservation share", () => {
    expect(calculateResearchFactor(activeResearch(0.1))).toBe(0.9);
  });

  test("calculates a typical fractional reservation and effective Task share", () => {
    const factor = calculateResearchFactor(activeResearch(0.25));

    expect(factor).toBe(0.75);
    expect(calculateEffectiveTaskShare(0.5, factor)).toBe(0.375);
  });

  test("supports a full reservation without making the factor invalid", () => {
    expect(calculateResearchFactor(activeResearch(1))).toBe(0);
    expect(calculateEffectiveTaskShare(1, 0)).toBe(0);
    expect(calculateResearchComputeResult(activeResearch(1), 900)).toEqual({
      nodeId: "research-stable-power-distribution",
      reservedComputeShare: 1,
      facilityAvailableComputeFlops: 900,
      deliveredUsefulComputeFlops: 900,
    });
  });

  test("keeps zero facility capacity as positive zero", () => {
    const result = calculateResearchComputeResult(activeResearch(0.25), 0);

    expect(result).not.toBeNull();
    expect(Object.is(result?.facilityAvailableComputeFlops, -0)).toBe(false);
    expect(Object.is(result?.deliveredUsefulComputeFlops, -0)).toBe(false);
    expect(validateResearchComputeResult(result)).toEqual([]);
  });

  test("normalizes calculated zero to positive zero", () => {
    const effectiveShare = calculateEffectiveTaskShare(0.5, 0);

    expect(effectiveShare).toBe(0);
    expect(Object.is(effectiveShare, -0)).toBe(false);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, -0.01, 1.01])(
    "rejects invalid reservation share %s",
    (share) => {
      expect(() => calculateResearchFactor(activeResearch(share))).toThrow(RangeError);
    },
  );

  test("rejects invalid requested shares, factors, and facility capacities", () => {
    expect(() => calculateEffectiveTaskShare(Number.NaN, 1)).toThrow(RangeError);
    expect(() => calculateEffectiveTaskShare(0, 1)).toThrow(RangeError);
    expect(() => calculateEffectiveTaskShare(1.01, 1)).toThrow(RangeError);
    expect(() => calculateEffectiveTaskShare(1, -0)).toThrow(RangeError);
    expect(() => calculateEffectiveTaskShare(1, Number.NaN)).toThrow(RangeError);
    expect(() => calculateEffectiveTaskShare(1, 1.01)).toThrow(RangeError);
    expect(() => calculateResearchComputeResult(null, Number.NaN)).toThrow(RangeError);
    expect(() => calculateResearchComputeResult(null, Number.POSITIVE_INFINITY)).toThrow(
      RangeError,
    );
    expect(() => calculateResearchComputeResult(null, -0)).toThrow(RangeError);
    expect(() => calculateResearchComputeResult(null, -1)).toThrow(RangeError);
  });

  test("returns the exact Research result multiplication", () => {
    const result = calculateResearchComputeResult(activeResearch(0.4), 12_345.5);

    expect(result).toEqual({
      nodeId: "research-stable-power-distribution",
      reservedComputeShare: 0.4,
      facilityAvailableComputeFlops: 12_345.5,
      deliveredUsefulComputeFlops: 12_345.5 * 0.4,
    });
    expect(validateResearchComputeResult(result)).toEqual([]);
  });

  test("validates newly calculated result shape and multiplication", () => {
    const result = calculateResearchComputeResult(activeResearch(0.4), 100);
    if (result === null) throw new Error("Expected an active Research result.");

    expect(
      validateResearchComputeResult({
        ...result,
        deliveredUsefulComputeFlops: 41,
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "deliveredUsefulComputeFlops" })]),
    );
    expect(
      validateResearchComputeResult({
        ...result,
        reservedComputeShare: 0,
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "reservedComputeShare" })]));
    expect(
      validateResearchComputeResult({
        ...result,
        facilityAvailableComputeFlops: Number.NaN,
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "facilityAvailableComputeFlops" })]),
    );
  });

  test("does not mutate active Research input", () => {
    const active = activeResearch(0.35);
    const before = structuredClone(active);

    calculateResearchFactor(active);
    calculateEffectiveTaskShare(0.8, calculateResearchFactor(active));
    calculateResearchComputeResult(active, 1_000);

    expect(active).toEqual(before);
  });

  test("returns plain JSON-serializable data", () => {
    const result = calculateResearchComputeResult(activeResearch(0.2), 500);

    expect(result).not.toBeNull();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(canonicalSerialize(result)).toBe(
      '{"deliveredUsefulComputeFlops":100,"facilityAvailableComputeFlops":500,"nodeId":"research-stable-power-distribution","reservedComputeShare":0.2}',
    );
  });

  test("does not consume RNG state", () => {
    const rng = createSeededRngFromState(123_456);
    const before = rng.getState();

    calculateResearchFactor(activeResearch(0.2));
    calculateEffectiveTaskShare(0.8, 0.8);
    calculateResearchComputeResult(activeResearch(0.2), 500);

    expect(rng.getState()).toBe(before);
  });

  test("is independent of active Research object property order", () => {
    const first = activeResearch(0.25);
    const second = {
      reservedComputeShare: 0.25,
      completedOperations: 10,
      startedAtTick: 4,
      nodeId: "research-stable-power-distribution",
    } satisfies ActiveResearchState;

    expect(calculateResearchComputeResult(first, 800)).toEqual(
      calculateResearchComputeResult(second, 800),
    );
  });

  test("accepts a valid serialized Research result after round-trip", () => {
    const result = calculateResearchComputeResult(activeResearch(0.5), 1_000);
    const roundTrip = JSON.parse(JSON.stringify(result)) as ResearchComputeResultState;

    expect(validateResearchComputeResult(roundTrip)).toEqual([]);
  });
});
