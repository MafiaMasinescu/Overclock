import {
  MAX_ARRAY_ENTRIES,
  MAX_OBJECT_KEY_UTF16_UNITS,
  MAX_PAYLOAD_DEPTH,
  MAX_STRING_UTF16_UNITS,
  MAX_VISITED_VALUES,
} from "./persistenceLimits.ts";
import { PersistenceError } from "./persistenceErrors.ts";

export interface ExternalDataLimits {
  readonly maxDepth?: number;
  readonly maxVisitedValues?: number;
  readonly maxArrayEntries?: number;
  readonly maxObjectKeyUnits?: number;
  readonly maxStringUnits?: number;
}

interface TraversalState {
  readonly ancestors: WeakSet<object>;
  visitedValues: number;
}

function fail(message: string, path: string): never {
  throw new PersistenceError("INVALID_FORMAT", `${path}: ${message}`, path);
}

function failLimit(message: string, path: string): never {
  throw new PersistenceError("LIMIT_EXCEEDED", `${path}: ${message}`, path);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertString(value: string, path: string, limits: Required<ExternalDataLimits>): void {
  if (value.length > limits.maxStringUnits) {
    failLimit(`string exceeds ${limits.maxStringUnits} UTF-16 code units`, path);
  }
  if (!isWellFormedUnicode(value)) fail("contains an unpaired surrogate", path);
}

function assertValue(
  value: unknown,
  path: string,
  depth: number,
  limits: Required<ExternalDataLimits>,
  state: TraversalState,
): void {
  if (typeof value === "string") {
    assertString(value, path, limits);
    return;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value !== "object") fail(`unsupported value of type ${typeof value}`, path);
  if (depth > limits.maxDepth) failLimit(`depth exceeds ${limits.maxDepth}`, path);
  if (state.ancestors.has(value)) fail("contains a cyclic reference", path);

  state.visitedValues += 1;
  if (state.visitedValues > limits.maxVisitedValues) {
    failLimit(`visited-value count exceeds ${limits.maxVisitedValues}`, path);
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        fail("array prototype must be Array.prototype", path);
      }
      if (value.length > limits.maxArrayEntries) {
        failLimit(`array exceeds ${limits.maxArrayEntries} entries`, path);
      }
      const keys = Reflect.ownKeys(value);
      const stringKeys = keys.filter((key): key is string => typeof key === "string");
      if (
        stringKeys.length !== keys.length ||
        stringKeys.length !== value.length + 1 ||
        stringKeys.some((key) => key !== "length" && !/^\d+$/.test(key))
      ) {
        fail("array must be dense and have no custom properties", path);
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
          fail("array contains an accessor or hole", `${path}[${index}]`);
        }
        assertValue(descriptor.value, `${path}[${index}]`, depth + 1, limits, state);
      }
      return;
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("object prototype must be Object.prototype or null", path);
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) fail("symbols are not allowed", path);
    for (const key of keys) {
      if (typeof key !== "string") fail("symbols are not allowed", path);
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        fail("prototype-pollution keys are not allowed", `${path}.${key}`);
      }
      if (key.length > limits.maxObjectKeyUnits) {
        failLimit(
          `object key exceeds ${limits.maxObjectKeyUnits} UTF-16 code units`,
          `${path}.${key}`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable
      ) {
        fail("object must contain enumerable data properties only", `${path}.${key}`);
      }
      assertValue(descriptor.value, `${path}.${key}`, depth + 1, limits, state);
    }
  } finally {
    state.ancestors.delete(value);
  }
}

export function assertSafeExternalData(value: unknown, options: ExternalDataLimits = {}): void {
  const limits: Required<ExternalDataLimits> = {
    maxDepth: options.maxDepth ?? MAX_PAYLOAD_DEPTH,
    maxVisitedValues: options.maxVisitedValues ?? MAX_VISITED_VALUES,
    maxArrayEntries: options.maxArrayEntries ?? MAX_ARRAY_ENTRIES,
    maxObjectKeyUnits: options.maxObjectKeyUnits ?? MAX_OBJECT_KEY_UTF16_UNITS,
    maxStringUnits: options.maxStringUnits ?? MAX_STRING_UTF16_UNITS,
  };
  if (!Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 0) {
    throw new RangeError("External-data maxDepth must be a nonnegative safe integer.");
  }
  assertValue(value, "$", 0, limits, { ancestors: new WeakSet<object>(), visitedValues: 0 });
}

export function cloneOwnedExternalData<T>(value: T, options?: ExternalDataLimits): T {
  assertSafeExternalData(value, options);
  const detached = structuredClone(value);
  assertSafeExternalData(detached, options);
  return detached;
}
