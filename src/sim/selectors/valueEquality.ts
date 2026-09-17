// Allocation-free structural equality for presentation comparisons
// (Phase 2 §7.2 change detection without canonical serialization).
// Early-exits on the first difference; allocates nothing. Plain-data
// only (objects, arrays, primitives): uses direct indexed access instead
// of reflective calls so steady publications stay cheap. Conservative on
// exotic values: Object.is semantics (-0 differs from 0, NaN equals
// NaN), matching the simulator's own normalized-zero discipline.

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (typeof left !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!valuesEqual(leftRecord[index], rightRecord[index])) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(leftRecord);
  if (leftKeys.length !== Object.keys(rightRecord).length) return false;
  for (const key of leftKeys) {
    if (!Object.hasOwn(rightRecord, key)) return false;
    if (!valuesEqual(leftRecord[key], rightRecord[key])) return false;
  }
  return true;
}
