import type { DeepReadonly } from "../schemas/contentSchemas.ts";

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const property of Reflect.ownKeys(value)) {
      deepFreeze(Reflect.get(value, property));
    }
    Object.freeze(value);
  }

  return value as DeepReadonly<T>;
}
