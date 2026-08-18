import { describe, expect, test } from "vitest";

import { canonicalSerialize, hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";

describe("canonical authoritative state", () => {
  test("sorts object keys recursively without changing array order", () => {
    const value = {
      z: null,
      list: [{ b: 2, a: 1 }, 3],
      a: { y: 2, x: 1 },
    };

    expect(canonicalSerialize(value)).toBe('{"a":{"x":1,"y":2},"list":[{"a":1,"b":2},3],"z":null}');
  });

  test("orders numeric-looking property names lexicographically", () => {
    expect(canonicalSerialize({ 2: "two", 10: "ten", a: "letter" })).toBe(
      '{"10":"ten","2":"two","a":"letter"}',
    );
  });

  test("is independent of object property insertion order", () => {
    const first: Record<string, unknown> = {};
    first["seed"] = "foundation";
    first["tick"] = 12;
    first["clock"] = { speed: 1, paused: false };

    const second: Record<string, unknown> = {};
    second["clock"] = { paused: false, speed: 1 };
    second["tick"] = 12;
    second["seed"] = "foundation";

    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second));
  });

  test.each([
    ["undefined", { value: undefined }],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["date instance", { value: new Date(0) }],
    ["map instance", { value: new Map([["key", "value"]]) }],
    ["function", { value: () => 1 }],
  ])("rejects the unsupported %s", (_label, value) => {
    expect(() => canonicalSerialize(value)).toThrow(/canonical serialization/i);
  });

  test("uses a stable FNV-1a 64-bit hash of canonical UTF-8 JSON", () => {
    expect(hashCanonicalState({ a: 1 })).toBe("9c3e82dd6fcae8b1");
  });

  test("uses a stable canonical hash for Unicode content", () => {
    expect(hashCanonicalState({ label: "Țeavă 🔧", objective: "Pregătește sistemul" })).toBe(
      "91e172c164b74de9",
    );
  });

  test("returns the same hash for the same canonical state", () => {
    expect(hashCanonicalState({ tick: 4, nested: { b: 2, a: 1 } })).toBe(
      hashCanonicalState({ nested: { a: 1, b: 2 }, tick: 4 }),
    );
  });

  test("changes the hash when an authoritative value changes", () => {
    expect(hashCanonicalState({ tick: 4, cashUsd: 32_000 })).not.toBe(
      hashCanonicalState({ tick: 4, cashUsd: 31_999.99 }),
    );
  });

  test("rejects cyclic object graphs", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(() => canonicalSerialize(value)).toThrow("a cyclic object graph");
  });

  test("rejects sparse arrays", () => {
    const value = new Array<unknown>(2);
    value[1] = "present";

    expect(() => canonicalSerialize(value)).toThrow(/array with holes/);
  });

  test("rejects accessor properties", () => {
    const value = {};
    Object.defineProperty(value, "tick", {
      enumerable: true,
      get: () => 1,
    });

    expect(() => canonicalSerialize(value)).toThrow("an object with accessors");
  });

  test("rejects class instances", () => {
    class StateRecord {
      readonly tick = 1;
    }

    expect(() => canonicalSerialize(new StateRecord())).toThrow("a non-plain object");
  });

  test("rejects arrays with custom properties", () => {
    const value: number[] & { label?: string } = [1, 2];
    value.label = "custom";

    expect(() => canonicalSerialize(value)).toThrow(/array with holes or custom properties/);
  });

  test("rejects arrays with a replaced prototype", () => {
    const value = [1, 2];
    Object.setPrototypeOf(value, null);

    expect(() => canonicalSerialize(value)).toThrow("an array with a nonstandard prototype");
  });

  test("rejects classes extending Array", () => {
    class StateArray extends Array<number> {}

    expect(() => canonicalSerialize(new StateArray(1, 2))).toThrow(
      "an array with a nonstandard prototype",
    );
  });
});
