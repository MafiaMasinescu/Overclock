// Fake in-memory transport adapter for store tests (Task 18.3).
//
// TEST-ONLY: no production module imports this adapter. It mirrors the
// future wire ordering rules (epoch binding plus monotonic publication
// sequences) in front of the store so 18.3 tests prove epoch/base/sequence
// handling without a real Worker. The real transport stays Task 19 work.

import type { GridPublication } from "../../sim/selectors/gridPublication.ts";
import type { UiSnapshot } from "../../sim/selectors/presentationTypes.ts";
import type { ApplyRejectionReason, GameClientStore } from "./store.ts";

export interface FakeTransportInput {
  readonly epoch: string;
  readonly sequence: number;
  readonly snapshot: UiSnapshot;
  readonly grid: GridPublication | null;
}

export type FakeTransportResult =
  | { readonly delivered: true }
  | {
      readonly delivered: false;
      readonly reason: "stale-epoch" | "sequence-gap" | ApplyRejectionReason;
    };

export interface FakeTransport {
  deliver(input: FakeTransportInput): FakeTransportResult;
  // Explicit epoch rotation (host-driven load/recovery handshake).
  resetForEpoch(epoch: string): void;
}

export function createFakeTransport(store: GameClientStore): FakeTransport {
  let expectedEpoch: string | null = null;
  let expectedSequence = 0;

  return {
    deliver(input: FakeTransportInput): FakeTransportResult {
      if (expectedEpoch === null) {
        expectedEpoch = input.epoch;
        expectedSequence = 0;
      } else if (input.epoch !== expectedEpoch) {
        return { delivered: false, reason: "stale-epoch" };
      }
      if (input.sequence !== expectedSequence) {
        return { delivered: false, reason: "sequence-gap" };
      }
      const applied = store.applyPublication({
        epoch: input.epoch,
        snapshot: input.snapshot,
        grid: input.grid,
      });
      if (!applied.applied) return { delivered: false, reason: applied.reason };
      expectedSequence += 1;
      return { delivered: true };
    },
    resetForEpoch(epoch: string): void {
      expectedEpoch = epoch;
      expectedSequence = 0;
    },
  };
}
