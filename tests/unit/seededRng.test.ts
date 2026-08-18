import { describe, expect, test } from "vitest";

import {
  createSeededRng,
  createSeededRngFromState,
  seedToUint32,
} from "../../src/sim/rng/seededRng.ts";

describe("seeded RNG", () => {
  test.each(["", " ", "\t\r\n"])("rejects an empty seed represented by %j", (seed) => {
    expect(() => createSeededRng(seed)).toThrow("Seed must contain a non-whitespace character.");
  });

  test("converts a string seed to a stable unsigned 32-bit state", () => {
    expect(seedToUint32("phase-one")).toBe(2_799_575_867);
  });

  test("produces the known Mulberry32 sequence for a seed", () => {
    const rng = createSeededRng("overclock-seed");

    expect(Array.from({ length: 5 }, () => rng.nextUint32())).toEqual([
      4_225_923_861, 1_505_091_259, 362_650_325, 2_376_414_150, 480_973_504,
    ]);
  });

  test("produces a stable sequence for a Unicode seed", () => {
    const seed = "overclock-șurub-🔧";
    const rng = createSeededRng(seed);

    expect(seedToUint32(seed)).toBe(256_427_585);
    expect(Array.from({ length: 5 }, () => rng.nextUint32())).toEqual([
      3_558_424_911, 4_157_183_273, 1_655_000_437, 129_583_607, 962_577_892,
    ]);
  });

  test("restores the sequence from serialized RNG state", () => {
    const original = createSeededRng("phase-one");
    original.nextUint32();
    original.nextUint32();

    const restored = createSeededRngFromState(original.getState());

    expect(restored.nextUint32()).toBe(original.nextUint32());
    expect(restored.nextFloat()).toBe(original.nextFloat());
  });

  test("repeats the same ordered calls at least 100 times", () => {
    const expected = [3_684_647_678, 3_480_075_627, 391_563_851, 1_065_127_018, 2_800_723_657];

    for (let run = 0; run < 100; run += 1) {
      const rng = createSeededRng("phase-one");
      expect(Array.from({ length: expected.length }, () => rng.nextUint32())).toEqual(expected);
    }
  });
});
