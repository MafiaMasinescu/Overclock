import { describe, expect, test } from "vitest";

import { valuesEqual } from "../../src/sim/selectors/valueEquality.ts";

describe("valuesEqual", () => {
  test("compares primitives with Object.is semantics", () => {
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual(1, 2)).toBe(false);
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
    expect(valuesEqual(undefined, undefined)).toBe(true);
    expect(valuesEqual(null, undefined)).toBe(false);
    expect(valuesEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(valuesEqual(0, -0)).toBe(false);
    expect(valuesEqual(1, "1")).toBe(false);
    expect(valuesEqual({}, null)).toBe(false);
  });

  test("compares arrays structurally", () => {
    expect(valuesEqual([], [])).toBe(true);
    expect(valuesEqual([1, 2], [1, 2])).toBe(true);
    expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(valuesEqual([1, [2]], [1, [2]])).toBe(true);
    expect(valuesEqual([1, [2]], [1, [3]])).toBe(false);
    expect(valuesEqual([], {})).toBe(false);
  });

  test("compares records structurally without allocation", () => {
    expect(valuesEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(valuesEqual({ a: undefined }, {})).toBe(false);
    expect(valuesEqual({ a: { b: [1] } }, { a: { b: [1] } })).toBe(true);
    expect(valuesEqual({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false);
  });

  test("treats shared frozen and fresh values as equal", () => {
    const view = Object.freeze({ id: "m1", position: Object.freeze({ x: 0, y: 0 }) });
    expect(valuesEqual(view, { id: "m1", position: { x: 0, y: 0 } })).toBe(true);
    expect(valuesEqual(view, view)).toBe(true);
  });
});
