import { describe, expect, test, vi } from "vitest";

import {
  MAX_OUTSTANDING_REQUESTS,
  createInboundSequenceGuard,
  createRequestCorrelator,
  createReplySequenceGuard,
  createRequestLedger,
  createRequestSequencer,
  parseWorkerRequest,
  parseWorkerReply,
  parseWorkerEnvelope,
  WORKER_REPLY_KINDS,
  WORKER_REQUEST_KINDS,
} from "../../src/app/worker/protocol.ts";

const epoch = "worker-session-1";
const COMMAND_ID = "75000000-0000-4000-8000-000000000001";

function initializeRequest(requestSequence = 0) {
  return {
    protocolVersion: 1,
    epoch,
    requestSequence,
    kind: "INITIALIZE_NEW",
    body: {
      seed: "protocol-test",
      contentVersion: "0.1.0",
      fingerprint: "0123456789abcdef",
    },
  };
}

describe("strict Worker wire protocol", () => {
  test("freezes the full request and reply discriminant set", () => {
    expect(WORKER_REQUEST_KINDS.toSorted()).toEqual([
      "ACK_PUBLICATION",
      "ACK_RESULT",
      "COMMAND",
      "CONFIRM_IMPORT",
      "CONTINUE_HOST",
      "CREATE_REPORT",
      "DELETE_REPORT",
      "DELETE_SLOT",
      "EXPORT_SLOT",
      "INITIALIZE_NEW",
      "LIST_REPORTS",
      "LIST_SLOTS",
      "LOAD_SLOT",
      "PREVIEW_IMPORT",
      "RECOVER",
      "REQUEST_FULL_SNAPSHOT",
      "REQUEST_REPORT",
      "REQUEST_SAVE",
      "SET_HOST_VISIBILITY",
      "SET_PRESENTATION_CONTEXT",
      "SHUTDOWN",
      "UPDATE_SETTINGS",
    ]);
    expect(WORKER_REPLY_KINDS.toSorted()).toEqual([
      "COMMAND_RECEIPT",
      "COMMAND_RESULT",
      "EVENTS_GAP",
      "EVENT_BATCH",
      "FATAL_ERROR",
      "HEARTBEAT",
      "READY",
      "RECOVERY_AVAILABLE",
      "REQUEST_ERROR",
      "REQUEST_RESULT",
      "SAVE_COMMITTED",
      "SESSION_REPLACED",
      "SHUTDOWN_COMPLETE",
      "SNAPSHOT_PUBLICATION",
      "SUSPENDED",
      "TRANSPORT_DEGRADED",
    ]);
  });

  test("accepts exact versioned requests and owns a detached copy", () => {
    const source = initializeRequest();
    const parsed = parseWorkerRequest(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.body).not.toBe(source.body);
  });

  test("accepts result acknowledgements and the declared committed-save reply", () => {
    expect(
      parseWorkerRequest({
        protocolVersion: 1,
        epoch,
        requestSequence: 4,
        kind: "ACK_RESULT",
        body: { outboundSequence: 3 },
      }),
    ).toMatchObject({ kind: "ACK_RESULT", body: { outboundSequence: 3 } });
    expect(
      parseWorkerReply({
        protocolVersion: 1,
        epoch,
        outboundSequence: 5,
        requestSequence: 4,
        kind: "SAVE_COMMITTED",
        body: {
          metadata: {
            slotId: "slot-1",
            savedAtIso: "2026-09-24T12:00:00.000Z",
            tick: 120,
            sizeBytes: 4096,
          },
        },
      }),
    ).toMatchObject({ kind: "SAVE_COMMITTED", body: { metadata: { slotId: "slot-1" } } });
  });

  test.each([
    { ...initializeRequest(), future: true },
    { ...initializeRequest(), protocolVersion: 2 },
    { ...initializeRequest(), kind: "STEP_DEBUG" },
    {
      ...initializeRequest(),
      body: { seed: "x", contentVersion: "0.1.0", fingerprint: "x", extra: 1 },
    },
  ])("rejects malformed or future request shape", (request) => {
    expect(() => parseWorkerRequest(request)).toThrow();
  });

  test("rejects accessor data before evaluating it or cloning", () => {
    const getter = vi.fn(() => "protocol-test");
    const body = {
      contentVersion: "0.1.0",
      fingerprint: "0123456789abcdef",
    } as Record<string, unknown>;
    Object.defineProperty(body, "seed", { enumerable: true, get: getter });
    const envelope = { ...initializeRequest(), body };
    expect(parseWorkerEnvelope(envelope).requestSequence).toBe(0);
    expect(() => parseWorkerRequest(envelope)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  test("copies bounded import bytes and enforces the independent import-size exception", () => {
    const sourceBytes = Uint8Array.from([1, 2, 3]).buffer;
    const request = parseWorkerRequest({
      protocolVersion: 1,
      epoch,
      requestSequence: 0,
      kind: "PREVIEW_IMPORT",
      body: { fileBytes: sourceBytes },
    });
    expect(request.kind).toBe("PREVIEW_IMPORT");
    if (request.kind !== "PREVIEW_IMPORT") throw new Error("Expected import request.");
    expect(request.body.fileBytes).not.toBe(sourceBytes);
    expect([...new Uint8Array(request.body.fileBytes)]).toEqual([1, 2, 3]);
    expect(() => parseWorkerRequest({ ...initializeRequest(-0), requestSequence: -0 })).toThrow();
    expect(() =>
      parseWorkerRequest({
        protocolVersion: 1,
        epoch,
        requestSequence: 0,
        kind: "PREVIEW_IMPORT",
        body: { fileBytes: new ArrayBuffer(8 * 1024 * 1024 + 1) },
      }),
    ).toThrow(/limit/i);
  });

  test("rejects malformed commands at transport admission", () => {
    expect(() =>
      parseWorkerRequest({
        protocolVersion: 1,
        epoch,
        requestSequence: 0,
        kind: "COMMAND",
        body: {
          command: { kind: "SET_PAUSED", commandId: "bad", paused: false, source: "player" },
        },
      }),
    ).toThrow();
  });

  test("checks epoch and exact next sequence without accepting duplicates or gaps", () => {
    const guard = createInboundSequenceGuard(epoch);
    expect(guard.accept(parseWorkerRequest(initializeRequest()))).toEqual({ accepted: true });
    expect(guard.accept(parseWorkerRequest(initializeRequest()))).toEqual({
      accepted: false,
      reason: "sequence-gap",
    });
    expect(
      guard.accept(parseWorkerRequest({ ...initializeRequest(2), requestSequence: 2 })),
    ).toEqual({ accepted: false, reason: "sequence-gap" });
    expect(
      guard.accept(parseWorkerRequest({ ...initializeRequest(1), epoch: "other-session" })),
    ).toEqual({ accepted: false, reason: "stale-epoch" });
  });

  test("checks reply outbound sequence and epoch independently", () => {
    const guard = createReplySequenceGuard(epoch);
    const reply = {
      protocolVersion: 1,
      epoch,
      outboundSequence: 0,
      requestSequence: null,
      kind: "HEARTBEAT",
      body: { tick: 0, lifecycle: "READY_HELD", visible: true },
    } as const;
    expect(guard.accept(parseWorkerReply(reply))).toEqual({ accepted: true });
    expect(guard.accept(parseWorkerReply(reply))).toEqual({
      accepted: false,
      reason: "sequence-gap",
    });
    expect(
      guard.accept(parseWorkerReply({ ...reply, epoch: "other-session", outboundSequence: 1 })),
    ).toEqual({
      accepted: false,
      reason: "stale-epoch",
    });
  });

  test("sequences requests from zero and closes cleanly at safe integer exhaustion", () => {
    const sequencer = createRequestSequencer(epoch);
    expect(sequencer.create("INITIALIZE_NEW", initializeRequest().body).requestSequence).toBe(0);
    const exhausted = createRequestSequencer(epoch, Number.MAX_SAFE_INTEGER);
    expect(exhausted.create("INITIALIZE_NEW", initializeRequest().body).requestSequence).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(() => exhausted.create("INITIALIZE_NEW", initializeRequest().body)).toThrow();
  });

  test("bounds outstanding count, aggregate bytes, maintenance and import ownership", () => {
    const ledger = createRequestLedger();
    for (let index = 0; index < MAX_OUTSTANDING_REQUESTS; index += 1) {
      expect(ledger.reserve(index, 1)).toEqual({ accepted: true });
    }
    expect(ledger.reserve(999, 1)).toEqual({ accepted: false, reason: "BUSY" });
    expect(ledger.release(0)).toBe(true);
    expect(ledger.reserve(999, 1)).toEqual({ accepted: true });
    ledger.clear();
    expect(ledger.reserve(1, 2 * 1024 * 1024 + 1)).toEqual({
      accepted: false,
      reason: "LIMIT_EXCEEDED",
    });
    expect(ledger.reserve(1, 32, "maintenance")).toEqual({ accepted: true });
    expect(ledger.reserve(2, 32, "maintenance")).toEqual({ accepted: false, reason: "BUSY" });
    expect(ledger.reserve(3, 32, "import")).toEqual({ accepted: false, reason: "BUSY" });
    expect(ledger.release(1)).toBe(true);
    expect(ledger.reserve(3, 32, "import")).toEqual({ accepted: true });
    expect(ledger.reserve(4, 32, "maintenance")).toEqual({ accepted: false, reason: "BUSY" });
  });

  test("correlates command result by epoch and request sequence, then verifies commandId", () => {
    const correlator = createRequestCorrelator();
    correlator.add(epoch, 4, COMMAND_ID);
    const reply = {
      protocolVersion: 1,
      epoch,
      outboundSequence: 2,
      requestSequence: 4,
      kind: "COMMAND_RESULT",
      body: {
        commandId: COMMAND_ID,
        result: { commandId: COMMAND_ID, accepted: true, appliedAtTick: 0 },
      },
    } as const;
    expect(correlator.settle(parseWorkerReply(reply))).toEqual({
      matched: true,
      commandId: COMMAND_ID,
    });
    expect(correlator.settle(parseWorkerReply(reply))).toEqual({
      matched: false,
      reason: "unknown",
    });

    correlator.add(epoch, 5, COMMAND_ID);
    const mismatched = {
      ...reply,
      outboundSequence: 3,
      requestSequence: 5,
      body: {
        commandId: "75000000-0000-4000-8000-000000000002",
        result: { commandId: COMMAND_ID, accepted: true, appliedAtTick: 0 },
      },
    };
    expect(() => correlator.settle(parseWorkerReply(mismatched))).toThrow(/commandId/);
  });

  test("releases a timed-out correlation without accepting its late result", () => {
    const correlator = createRequestCorrelator();
    correlator.add(epoch, 7, COMMAND_ID);
    expect(correlator.cancel("different-epoch", 7)).toBe(false);
    expect(correlator.cancel(epoch, 7)).toBe(true);
    expect(correlator.size()).toBe(0);
    const lateReply = parseWorkerReply({
      protocolVersion: 1,
      epoch,
      outboundSequence: 8,
      requestSequence: 7,
      kind: "COMMAND_RESULT",
      body: {
        commandId: COMMAND_ID,
        result: { commandId: COMMAND_ID, accepted: true, appliedAtTick: 0 },
      },
    });
    expect(correlator.settle(lateReply)).toEqual({ matched: false, reason: "unknown" });
  });

  test("accepts exact typed replies and rejects unknown reply kinds and keys", () => {
    const reply = {
      protocolVersion: 1,
      epoch,
      outboundSequence: 0,
      requestSequence: null,
      kind: "HEARTBEAT",
      body: { tick: 0, lifecycle: "READY_HELD", visible: true },
    };
    expect(parseWorkerReply(reply)).toEqual(reply);
    expect(() => parseWorkerReply({ ...reply, kind: "FUTURE" })).toThrow();
    expect(() => parseWorkerReply({ ...reply, extra: 1 })).toThrow();
    expect(
      parseWorkerReply({
        protocolVersion: 1,
        epoch,
        outboundSequence: 1,
        requestSequence: null,
        kind: "TRANSPORT_DEGRADED",
        body: { publicationSequence: 3 },
      }).kind,
    ).toBe("TRANSPORT_DEGRADED");
    expect(
      parseWorkerReply({
        protocolVersion: 1,
        epoch,
        outboundSequence: 2,
        requestSequence: null,
        kind: "EVENTS_GAP",
        body: { nextEventSequence: 5 },
      }),
    ).toMatchObject({ kind: "EVENTS_GAP", body: { nextEventSequence: 5 } });
  });
});
