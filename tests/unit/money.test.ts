import { describe, expect, test } from "vitest";

import {
  calculateEnergyCostUsd,
  microdollarsToUsd,
  quantizeUsd,
  usdToMicrodollars,
} from "../../src/sim/economy/money.ts";

describe("deterministic microdollar money", () => {
  test.each([
    [0.00000049, 0],
    [0.0000005, 0.000001],
    [-0.00000049, 0],
    [-0.0000005, -0.000001],
    [12.3456784, 12.345678],
    [12.3456785, 12.345679],
    [-12.3456785, -12.345679],
  ])("quantizes %s USD to %s with half away from zero", (input, expected) => {
    expect(quantizeUsd(input)).toBe(expected);
  });

  test("converts between canonical public USD and integer microdollars", () => {
    expect(usdToMicrodollars(123.456789)).toBe(123_456_789);
    expect(microdollarsToUsd(-123_456_789)).toBe(-123.456789);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite USD input %s",
    (input) => {
      expect(() => usdToMicrodollars(input)).toThrow(RangeError);
    },
  );

  test("rejects conversion beyond the safe microdollar range", () => {
    expect(() => usdToMicrodollars(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => microdollarsToUsd(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("energy cost", () => {
  test.each([
    [1_000, 3_600, 0.1, 0.1],
    [24_000, 0.1, 0.042, 0.000028],
  ])(
    "%s W for %s seconds at %s USD/kWh costs %s USD",
    (powerWatts, simulatedSeconds, energyPriceUsdPerKwh, expected) => {
      expect(calculateEnergyCostUsd(powerWatts, simulatedSeconds, energyPriceUsdPerKwh)).toBe(
        expected,
      );
    },
  );

  test.each([
    [-1, 1, 1],
    [1, -1, 1],
    [1, 1, -1],
    [Number.NaN, 1, 1],
    [1, Number.POSITIVE_INFINITY, 1],
    [1, 1, Number.NEGATIVE_INFINITY],
  ])("rejects invalid inputs (%s, %s, %s)", (powerWatts, simulatedSeconds, price) => {
    expect(() => calculateEnergyCostUsd(powerWatts, simulatedSeconds, price)).toThrow(RangeError);
  });

  test("rejects energy arithmetic overflow", () => {
    expect(() =>
      calculateEnergyCostUsd(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
    ).toThrow(RangeError);
  });
});
