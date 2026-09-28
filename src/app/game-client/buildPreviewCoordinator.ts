import type { BuildQuery, BuildQueryResult } from "../../sim/build/contracts.ts";
import type { BuildQueryResponse } from "./contracts.ts";

export interface BuildPreviewTiming {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BuildPreviewCoordinator {
  request(query: BuildQuery): Promise<BuildQueryResult | null>;
  invalidate(): void;
  clear(): void;
  getPendingCount(): number;
}

interface PendingRequest {
  readonly query: BuildQuery;
  readonly key: string;
  readonly invalidation: number;
  readonly resolve: (result: BuildQueryResult | null) => void;
}

const POINTER_INTERVAL_MS = 100;

/**
 * Bounded host-side query coalescing primitive. It permits one in-flight
 * request and one latest replacement, throttles pointer previews to 10 Hz,
 * and treats a rejected/unknown request as terminal rather than retrying it.
 */
export function createBuildPreviewCoordinator(
  queryBuild: (query: BuildQuery) => Promise<BuildQueryResponse>,
  timing: BuildPreviewTiming,
): BuildPreviewCoordinator {
  let inFlight: PendingRequest | null = null;
  let latest: PendingRequest | null = null;
  let timer: unknown = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let latestIntentSequence = -1;
  let lastCompletedQueryKey: string | null = null;
  let invalidation = 0;
  let disposed = false;

  function clearTimer(): void {
    if (timer !== null) timing.clearTimeout(timer);
    timer = null;
  }

  function settle(request: PendingRequest, result: BuildQueryResult | null): void {
    try {
      request.resolve(result);
    } catch {
      // A local overlay observer cannot poison the coordinator lifecycle.
    }
  }

  function pump(): void {
    timer = null;
    if (disposed || inFlight !== null || latest === null) return;
    const wait = Math.max(0, POINTER_INTERVAL_MS - (timing.now() - lastSentAt));
    if (wait > 0) {
      timer = timing.setTimeout(pump, wait);
      return;
    }
    const request = latest;
    latest = null;
    inFlight = request;
    lastSentAt = timing.now();
    void queryBuild(request.query).then(
      (response) => {
        if (inFlight !== request) return;
        inFlight = null;
        const result = response.result;
        const current = request.invalidation === invalidation;
        if (current) lastCompletedQueryKey = request.key;
        settle(
          request,
          current && result.clientIntentSequence === latestIntentSequence ? result : null,
        );
        pump();
      },
      () => {
        if (inFlight !== request) return;
        inFlight = null;
        settle(request, null);
        pump();
      },
    );
  }

  return {
    request(query) {
      if (disposed) return Promise.resolve(null);
      const queryKey = JSON.stringify({ ...query, clientIntentSequence: undefined });
      if (
        (lastCompletedQueryKey === queryKey && latest === null && inFlight === null) ||
        (latest?.key === queryKey && latest.invalidation === invalidation) ||
        (inFlight?.key === queryKey && inFlight.invalidation === invalidation)
      ) {
        return Promise.resolve(null);
      }
      latestIntentSequence = query.clientIntentSequence;
      if (latest !== null) settle(latest, null);
      const promise = new Promise<BuildQueryResult | null>((resolve) => {
        latest = { query, key: queryKey, invalidation, resolve };
      });
      pump();
      return promise;
    },
    invalidate() {
      invalidation += 1;
      lastCompletedQueryKey = null;
      if (latest !== null) settle(latest, null);
      latest = null;
    },
    clear() {
      disposed = true;
      clearTimer();
      if (latest !== null) settle(latest, null);
      if (inFlight !== null) settle(inFlight, null);
      latest = null;
      inFlight = null;
      latestIntentSequence = -1;
      lastCompletedQueryKey = null;
      invalidation += 1;
    },
    getPendingCount() {
      return (inFlight === null ? 0 : 1) + (latest === null ? 0 : 1);
    },
  };
}
