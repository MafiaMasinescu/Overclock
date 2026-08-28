import { describe, expect, test } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { OverclockSettings } from "../../src/sim/core/types.ts";
import {
  calculateDynamicPowerFactor,
  calculateEffectiveFullLoadPowerWatts,
  calculateEffectiveLoadPowerWatts,
} from "../../src/sim/overclock/overclockDomain.ts";

const content = loadContentBundle();

function settings(
  profile: OverclockSettings["profile"],
  frequencyRatio: number,
  voltageRatio: number,
): OverclockSettings {
  return { profile, frequencyRatio, voltageRatio };
}

describe("pure overclock Power domain", () => {
  test("calculates exact Balanced and approved Eco and Boost dynamic factors", () => {
    expect(calculateDynamicPowerFactor(settings("balanced", 1, 1))).toBe(1);
    expect(calculateDynamicPowerFactor(settings("eco", 0.8, 0.9))).toBeCloseTo(0.648, 12);
    expect(calculateDynamicPowerFactor(settings("boost", 1.25, 1.1))).toBeCloseTo(1.5125, 12);
  });

  test("preserves arbitrary Manual ratios without quantization or input mutation", () => {
    const manual = settings("manual", 1.23456789, 1.09876543);
    const before = structuredClone(manual);

    const factor = calculateDynamicPowerFactor(manual);

    expect(factor).toBe(manual.voltageRatio ** 2 * manual.frequencyRatio);
    expect(manual).toEqual(before);
    expect(JSON.parse(JSON.stringify({ factor }))).toEqual({ factor });
  });

  test("rejects invalid ratios and invalid derived values deterministically", () => {
    for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => calculateDynamicPowerFactor(settings("manual", ratio, 1))).toThrow(RangeError);
      expect(() => calculateDynamicPowerFactor(settings("manual", 1, ratio))).toThrow(RangeError);
    }
    expect(() =>
      calculateDynamicPowerFactor(settings("manual", Number.MAX_VALUE, Number.MAX_VALUE)),
    ).toThrow(RangeError);
  });

  test("uses the idle floor and bin efficiency exactly once in shared effective-load helpers", () => {
    const definition = content.modules["module-vacuum-tube-logic"];
    if (definition === undefined) throw new Error("Missing compute content fixture.");
    const factor = calculateDynamicPowerFactor(settings("manual", 0.1, 1));

    expect(calculateEffectiveLoadPowerWatts(definition, factor)).toBe(definition.idlePowerWatts);
    expect(calculateEffectiveFullLoadPowerWatts(definition, 1.25, factor)).toBe(
      definition.idlePowerWatts / 1.25,
    );
  });
});
