// Fast owned-value freezer for presentation outputs.
//
// Same observable semantics as the shared deepFreeze (recursively freezes
// unfrozen objects and returns the value) with direct indexed traversal
// tuned for the hot projection path. Plain JSON-like data only, matching
// the shared implementation's cycle-free canonical inputs.

export function freezeOwned<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const entry of value) freezeOwned(entry);
    } else {
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) freezeOwned(record[key]);
    }
    Object.freeze(value);
  }
  return value;
}
