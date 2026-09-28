import { describe, expect, test } from "vitest";

import {
  createBuildPreviewCoordinator,
  type BuildPreviewTiming,
} from "../../src/app/game-client/buildPreviewCoordinator.ts";
import type { BuildQueryResult } from "../../src/sim/build/contracts.ts";

class Timing implements BuildPreviewTiming {
  value = 0;
  private nextId = 0;
  readonly jobs = new Map<number, () => void>();
  now = (): number => this.value;
  setTimeout = (callback: () => void): number => {
    const id = ++this.nextId;
    this.jobs.set(id, callback);
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    if (typeof handle === "number") this.jobs.delete(handle);
  };
  fire(): void {
    const entry = this.jobs.entries().next().value as [number, () => void] | undefined;
    if (entry === undefined) return;
    this.jobs.delete(entry[0]);
    entry[1]();
  }
}

function result(sequence: number): BuildQueryResult {
  return {
    kind: "context",
    status: "unavailable",
    clientIntentSequence: sequence,
    source: {
      mode: "draft",
      observedTick: 0,
      liveLayoutRevision: 0,
      draftRevision: null,
      generation: 0,
    },
    reason: "NOT_AVAILABLE",
  };
}

describe("Build preview coordinator", () => {
  test("keeps one in-flight request and replaces one latest preview", async () => {
    const timing = new Timing();
    const resolvers: ((value: BuildQueryResult) => void)[] = [];
    const coordinator = createBuildPreviewCoordinator(
      () =>
        new Promise((resolve) => {
          resolvers.push((value) => {
            resolve({ result: value, settings: null });
          });
        }),
      timing,
    );
    const first = coordinator.request({ kind: "context", mode: "draft", clientIntentSequence: 1 });
    const replaced = coordinator.request({
      kind: "context",
      mode: "live",
      clientIntentSequence: 2,
    });
    expect(coordinator.getPendingCount()).toBe(2);
    resolvers[0]?.(result(1));
    await expect(first).resolves.toBeNull();
    expect(coordinator.getPendingCount()).toBe(1);
    timing.value = 100;
    timing.fire();
    expect(coordinator.getPendingCount()).toBe(1);
    resolvers[1]?.(result(2));
    await expect(replaced).resolves.toMatchObject({ clientIntentSequence: 2 });
  });

  test("does not resend the same query identity only because the intent sequence changed", async () => {
    const timing = new Timing();
    const calls: number[] = [];
    const coordinator = createBuildPreviewCoordinator((query) => {
      calls.push(query.clientIntentSequence);
      return Promise.resolve({ result: result(query.clientIntentSequence), settings: null });
    }, timing);

    await expect(
      coordinator.request({ kind: "context", mode: "draft", clientIntentSequence: 10 }),
    ).resolves.toMatchObject({ clientIntentSequence: 10 });
    await expect(
      coordinator.request({ kind: "context", mode: "draft", clientIntentSequence: 11 }),
    ).resolves.toBeNull();
    expect(calls).toEqual([10]);

    coordinator.invalidate();
    timing.value = 100;
    await expect(
      coordinator.request({ kind: "context", mode: "draft", clientIntentSequence: 12 }),
    ).resolves.toMatchObject({ clientIntentSequence: 12 });
    expect(calls).toEqual([10, 12]);
  });

  test("queues the same query again when dependencies invalidate an in-flight read", async () => {
    const timing = new Timing();
    const resolvers: ((value: BuildQueryResult) => void)[] = [];
    const coordinator = createBuildPreviewCoordinator(
      () =>
        new Promise((resolve) => {
          resolvers.push((value) => {
            resolve({ result: value, settings: null });
          });
        }),
      timing,
    );
    const first = coordinator.request({ kind: "context", mode: "draft", clientIntentSequence: 20 });
    coordinator.invalidate();
    const refreshed = coordinator.request({
      kind: "context",
      mode: "draft",
      clientIntentSequence: 21,
    });
    expect(coordinator.getPendingCount()).toBe(2);
    resolvers[0]?.(result(20));
    await expect(first).resolves.toBeNull();
    timing.value = 100;
    timing.fire();
    resolvers[1]?.(result(21));
    await expect(refreshed).resolves.toMatchObject({ clientIntentSequence: 21 });
  });
});
