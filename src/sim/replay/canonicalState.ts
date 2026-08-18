const FNV1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

function serializationError(detail: string): Error {
  return new Error(`Canonical serialization rejected ${detail}.`);
}

function serializePrimitive(value: null | boolean | number | string): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw serializationError("a non-finite number");
  }

  return JSON.stringify(value);
}

function serializeArray(value: readonly unknown[], ancestors: WeakSet<object>): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw serializationError("an array with a nonstandard prototype");
  }

  const keys = Reflect.ownKeys(value);
  const expectedKeyCount = value.length + 1;
  if (keys.length !== expectedKeyCount || keys.some((key) => typeof key === "symbol")) {
    throw serializationError("an array with holes or custom properties");
  }

  const serializedItems: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw serializationError("an array with holes or accessors");
    }
    serializedItems.push(serializeValue(descriptor.value, ancestors));
  }
  return `[${serializedItems.join(",")}]`;
}

function serializeObject(value: object, ancestors: WeakSet<object>): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw serializationError("a non-plain object");
  }

  const enumerableKeys = Object.keys(value);
  if (Reflect.ownKeys(value).length !== enumerableKeys.length) {
    throw serializationError("an object with symbols or non-enumerable properties");
  }

  const serializedProperties = enumerableKeys.toSorted().map((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw serializationError("an object with accessors");
    }
    return `${serializePrimitive(key)}:${serializeValue(descriptor.value, ancestors)}`;
  });
  return `{${serializedProperties.join(",")}}`;
}

function serializeValue(value: unknown, ancestors: WeakSet<object>): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return serializePrimitive(value);
  }

  if (typeof value !== "object") {
    throw serializationError(`a value of type ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw serializationError("a cyclic object graph");
  }

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? serializeArray(value, ancestors)
      : serializeObject(value, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalSerialize(value: unknown): string {
  return serializeValue(value, new WeakSet<object>());
}

function hashByte(hash: bigint, byte: number): bigint {
  return ((hash ^ BigInt(byte)) * FNV1A_64_PRIME) & UINT64_MASK;
}

function fnv1a64Utf8(value: string): string {
  let hash = FNV1A_64_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      throw new Error("Failed to read canonical state text.");
    }
    if (codePoint > 0xffff) {
      index += 1;
    }

    if (codePoint <= 0x7f) {
      hash = hashByte(hash, codePoint);
    } else if (codePoint <= 0x7ff) {
      hash = hashByte(hash, 0xc0 | (codePoint >>> 6));
      hash = hashByte(hash, 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      hash = hashByte(hash, 0xe0 | (codePoint >>> 12));
      hash = hashByte(hash, 0x80 | ((codePoint >>> 6) & 0x3f));
      hash = hashByte(hash, 0x80 | (codePoint & 0x3f));
    } else {
      hash = hashByte(hash, 0xf0 | (codePoint >>> 18));
      hash = hashByte(hash, 0x80 | ((codePoint >>> 12) & 0x3f));
      hash = hashByte(hash, 0x80 | ((codePoint >>> 6) & 0x3f));
      hash = hashByte(hash, 0x80 | (codePoint & 0x3f));
    }
  }

  return hash.toString(16).padStart(16, "0");
}

export function hashCanonicalState(state: unknown): string {
  return fnv1a64Utf8(canonicalSerialize(state));
}
