import { assertCanonicalSerializable } from "./canonicalState.ts";

export function assertCanonicalReplayParserInput(value: unknown, path: string): void {
  try {
    assertCanonicalSerializable(value);
  } catch {
    throw new TypeError(`${path} must be canonical serializable Replay data.`);
  }
}

export function detachAndFreezeReplayData<T>(value: T): T {
  const detached = structuredClone(value);
  const pending: unknown[] = [detached];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const child of current) {
        if (child !== null && typeof child === "object") pending.push(child);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === "object") pending.push(child);
      }
    }

    Object.freeze(current);
  }

  return detached;
}
