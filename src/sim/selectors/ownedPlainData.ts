import type { ThermalTileState } from "../core/types.ts";

// Descriptor-safe ownership at the in-process presentation boundary.
// Projector-created grids are already deeply frozen, so their identity can
// be retained without repeating a full structured clone on every update.
const projectedGrids = new WeakSet<object>();
const projectedThermalTiles = new WeakSet<object>();
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;

export function registerProjectedGrid<T extends object>(grid: T): T {
  if (!Object.isFrozen(grid))
    throw new TypeError("Projected grid must be frozen before registration.");
  projectedGrids.add(grid);
  return grid;
}

export function isRegisteredProjectedGrid(value: unknown): boolean {
  return value !== null && typeof value === "object" && projectedGrids.has(value);
}

export function registerProjectedThermalTiles<T extends object>(tiles: T): T {
  // Pure projection also accepts mutable test fixtures; only frozen
  // authoritative arrays may take the zero-copy publication path.
  if (Object.isFrozen(tiles)) projectedThermalTiles.add(tiles);
  return tiles;
}

export function isRegisteredProjectedThermalTiles(value: unknown): boolean {
  return value !== null && typeof value === "object" && projectedThermalTiles.has(value);
}

export function readExactDataFields(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("Presentation input must be a plain record.");
  }
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Presentation input must be a plain record.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string") ||
    expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
  ) {
    throw new TypeError("Presentation input has unknown or missing fields.");
  }
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError("Presentation input fields must be enumerable data properties.");
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

export function copyOwnedThermalTiles(
  value: unknown,
  width: number,
  height: number,
): readonly ThermalTileState[] {
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("Thermal tiles must be an ordinary array.");
  }
  const length = width * height;
  if (value.length !== length || Reflect.ownKeys(value).length !== length + 1) {
    throw new TypeError("Thermal tiles must have exact row-major coverage.");
  }
  const result: ThermalTileState[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (entry === undefined || !Object.hasOwn(entry, "value") || entry.enumerable !== true) {
      throw new TypeError("Thermal tiles must contain dense data entries.");
    }
    const tile = readExactDataFields(entry.value, ["position", "temperatureC"]);
    const position = readExactDataFields(tile["position"], ["x", "y"]);
    const x = position["x"];
    const y = position["y"];
    const temperatureC = tile["temperatureC"];
    if (
      x !== index % width ||
      y !== Math.floor(index / width) ||
      typeof temperatureC !== "number" ||
      !Number.isFinite(temperatureC)
    ) {
      throw new TypeError("Thermal tiles must contain finite row-major temperatures.");
    }
    result.push(
      Object.freeze({
        position: Object.freeze({ x, y }),
        temperatureC,
      }),
    );
  }
  const owned = Object.freeze(result);
  projectedThermalTiles.add(owned);
  return owned;
}

export function copyOwnedPlain<T>(value: T): T {
  const active = new Set<object>();
  let nodes = 0;

  function copy(current: unknown, depth: number): unknown {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) {
      throw new TypeError("Presentation input exceeds ownership limits.");
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new TypeError("Presentation input numbers must be finite.");
      return current;
    }
    if (typeof current !== "object") {
      throw new TypeError("Presentation input must contain plain JSON values.");
    }
    if (active.has(current)) throw new TypeError("Presentation input must not contain cycles.");
    active.add(current);
    const prototype = Reflect.getPrototypeOf(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    let result: unknown;
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype || keys.length !== current.length + 1) {
        throw new TypeError("Presentation arrays must be exact dense ordinary arrays.");
      }
      const entries: unknown[] = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true
        ) {
          throw new TypeError("Presentation arrays must contain data values only.");
        }
        entries.push(copy(descriptor.value, depth + 1));
      }
      result = Object.freeze(entries);
    } else {
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Presentation input must use plain objects.");
      }
      const record: Record<string, unknown> = {};
      for (const key of keys) {
        if (typeof key !== "string") throw new TypeError("Presentation input rejects symbols.");
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !Object.hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true
        ) {
          throw new TypeError("Presentation input requires enumerable data properties.");
        }
        Object.defineProperty(record, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true,
          configurable: false,
          writable: false,
        });
      }
      result = Object.freeze(record);
    }
    active.delete(current);
    return result;
  }

  return copy(value, 0) as T;
}
