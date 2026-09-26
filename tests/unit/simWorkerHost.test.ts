import { describe, expect, expectTypeOf, test, vi } from "vitest";

import { loadContentBundle } from "../../src/content/loader/contentLoader.ts";
import type { ContentBundle } from "../../src/content/schemas/contentSchemas.ts";
import { parseSimCommand } from "../../src/sim/commands/commandSchema.ts";
import { hashCanonicalState } from "../../src/sim/replay/canonicalState.ts";
import { hashSimulationContent } from "../../src/sim/replay/replayContracts.ts";
import { persistenceError } from "../../src/save/persistenceErrors.ts";
import { createReplayRecorder } from "../../src/sim/replay/replayRecorder.ts";
import { runReplay } from "../../src/sim/replay/replayRunner.ts";
import {
  MAX_RESULT_QUEUE_ENTRIES,
  parseWorkerReply,
  type WorkerReply,
} from "../../src/app/worker/protocol.ts";
import {
  createSimWorkerHost,
  type HostTimingAdapter,
  type HostCapture,
  type SimWorkerHost,
  type WorkerSaveCapture,
  type WorkerSaveMetadata,
  type WorkerSavePersistence,
  type WorkerSaveSessionInfo,
  type WorkerLoadCandidate,
} from "../../src/app/worker/simWorkerHost.ts";

const content = loadContentBundle();
const EPOCH = "host-test-epoch";

class ManualTiming {
  private nowMs = 0;
  private nextId = 0;
  private readonly jobs = new Map<number, { due: number; delayMs: number; callback: () => void }>();

  readonly adapter: HostTimingAdapter = {
    now: () => this.nowMs,
    setTimeout: (callback, delayMs) => {
      const id = ++this.nextId;
      this.jobs.set(id, { due: this.nowMs + delayMs, delayMs, callback });
      return id;
    },
    clearTimeout: (handle) => {
      if (typeof handle === "number") this.jobs.delete(handle);
    },
  };

  advanceBy(milliseconds: number): void {
    const target = this.nowMs + milliseconds;
    for (let count = 0; count < 10_000; count += 1) {
      const next = [...this.jobs.entries()]
        .filter(([, job]) => job.due <= target)
        .toSorted((left, right) => left[1].due - right[1].due)[0];
      if (next === undefined) break;
      this.nowMs = next[1].due;
      this.jobs.delete(next[0]);
      next[1].callback();
    }
    this.nowMs = target;
  }

  jumpAndRun(milliseconds: number): void {
    this.nowMs += milliseconds;
    const next = [...this.jobs.entries()].toSorted((left, right) => left[1].due - right[1].due)[0];
    if (next === undefined || next[1].due > this.nowMs) return;
    this.jobs.delete(next[0]);
    next[1].callback();
  }

  elapseWithoutDelivery(milliseconds: number): void {
    this.nowMs += milliseconds;
  }

  setTime(milliseconds: number): void {
    this.nowMs = milliseconds;
  }

  fireNextRegardlessOfDueTime(): void {
    const next = [...this.jobs.entries()].toSorted((left, right) => left[1].due - right[1].due)[0];
    if (next === undefined) return;
    this.jobs.delete(next[0]);
    next[1].callback();
  }

  fireDueOnce(): void {
    const next = [...this.jobs.entries()]
      .filter(([, job]) => job.due <= this.nowMs)
      .toSorted((left, right) => left[1].due - right[1].due)[0];
    if (next === undefined) return;
    this.jobs.delete(next[0]);
    next[1].callback();
  }

  pendingTimers(delayMs?: number): number {
    return [...this.jobs.values()].filter((job) => delayMs === undefined || job.delayMs === delayMs)
      .length;
  }
}

interface Harness {
  readonly host: SimWorkerHost;
  readonly timing: ManualTiming;
  readonly replies: WorkerReply[];
  readonly content: ContentBundle;
  readonly send: (kind: string, body: unknown) => Promise<void>;
  readonly sendAtEpoch: (epoch: string, kind: string, body: unknown) => Promise<void>;
}

function createHarness(
  contentBundle: ContentBundle = content,
  persistence?: WorkerSavePersistence,
): Harness {
  const replies: WorkerReply[] = [];
  const timing = new ManualTiming();
  const host = createSimWorkerHost({
    content: contentBundle,
    timing: timing.adapter,
    ...(persistence !== undefined ? { persistence } : {}),
    postMessage: (reply) => replies.push(parseWorkerReply(reply)),
  });
  const sequences = new Map<string, number>();
  const sendAtEpoch = async (epoch: string, kind: string, body: unknown): Promise<void> => {
    const requestSequence = sequences.get(epoch) ?? 0;
    await host.receive({
      protocolVersion: 1,
      epoch,
      requestSequence,
      kind,
      body,
    });
    sequences.set(epoch, requestSequence + 1);
  };
  const send = (kind: string, body: unknown): Promise<void> => sendAtEpoch(EPOCH, kind, body);
  return { host, timing, replies, content: contentBundle, send, sendAtEpoch };
}

async function initialize(harness: Harness): Promise<void> {
  await harness.send("INITIALIZE_NEW", {
    seed: "worker-host-test",
    contentVersion: content.contentVersion,
    fingerprint: hashSimulationContent(harness.content),
  });
  const ready = harness.replies.find((reply) => reply.kind === "READY");
  expect(ready?.kind).toBe("READY");
  if (ready?.kind !== "READY") throw new Error("Host did not become ready.");
  await harness.send("ACK_PUBLICATION", {
    publicationSequence: ready.body.publication.publicationSequence,
  });
}

function command(
  commandId: string,
  kind: "SET_PAUSED" | "SET_SPEED" | "SET_GUIDANCE_MODE" | "BUY_MODULE",
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return { commandId, source: "player", kind, ...rest };
}

function latestSnapshotTick(replies: readonly WorkerReply[]): number | null {
  for (const reply of [...replies].reverse()) {
    if (reply.kind === "READY" || reply.kind === "SNAPSHOT_PUBLICATION") {
      return reply.body.snapshot.tick;
    }
  }
  return null;
}

describe("serial SimWorkerHost and fixed-step scheduling", () => {
  test("requires every persistence adapter to erase pending import candidates", () => {
    expectTypeOf<WorkerSavePersistence["discardImport"]>().toEqualTypeOf<() => void>();
  });

  test.each(["LOAD_SLOT", "RECOVER"] as const)(
    "invalidates an import preview before %s and prevents durable confirmation",
    async (replacementKind) => {
      const session: WorkerSaveSessionInfo = {
        slotId: "slot-import-epoch",
        createdAtIso: "2026-09-24T12:00:00.000Z",
        settings: {
          language: "en",
          telemetryPreset: "standard",
          reducedEffects: false,
          reducedMotion: false,
          frameCap: 60,
          volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
        },
        localStats: {
          realPlayTimeSeconds: 0,
          taskCompletions: 0,
          taskAbandons: 0,
          emergencyShutdowns: 0,
          benchmarkAttempts: 0,
          designApplications: 0,
        },
      };
      const confirmImport = vi.fn(() =>
        Promise.resolve({
          slotId: "imported-slot",
          revision: 1,
          tick: 12,
          savedAtIso: "2026-09-24T12:00:00.000Z",
          sizeBytes: 42,
          appliedSettings: false,
          settings: null,
        }),
      );
      const discardImport = vi.fn();
      let loadCapture: HostCapture | null = null;
      const persistence: WorkerSavePersistence = {
        startNewRun: () => Promise.resolve(session),
        save: () =>
          Promise.resolve({
            slotId: session.slotId,
            savedAtIso: session.createdAtIso,
            tick: 0,
            sizeBytes: 42,
          }),
        updateSettings: (settings) => Promise.resolve(settings),
        prepareLoad: () => {
          if (loadCapture === null) throw new Error("Missing load capture.");
          return Promise.resolve({
            state: loadCapture.state,
            nextQueueSequence: loadCapture.nextQueueSequence,
            createdAtIso: session.createdAtIso,
            localStats: session.localStats,
            checkpoint: {
              slotId: session.slotId,
              savedAtIso: session.createdAtIso,
              tick: loadCapture.state.tick,
              year: loadCapture.state.campaign.currentYear,
              captureSequence: 0,
              sourceKind: "manual",
              skippedCorruptRecords: 0,
            },
            promote: () => Promise.resolve(session),
            rollback: () => Promise.resolve(),
          });
        },
        previewImport: () =>
          Promise.resolve({
            token: "old-epoch-token",
            preview: {
              sourceSchemaVersion: 1,
              sourceSaveVersion: 1,
              contentVersion: content.contentVersion,
              simulatedYear: 1940,
              tick: 12,
              cashUsd: 0,
              verticalSliceCompleted: false,
              savedAtIso: session.createdAtIso,
              migrationRequired: false,
              compatibility: "compatible",
              destinationSuggestion: { kind: "new-slot" },
              compressedBytes: 42,
              uncompressedBytes: 42,
              slotId: "imported-slot",
            },
            allocatedSlotId: "imported-slot",
          }),
        discardImport,
        confirmImport,
        close: () => Promise.resolve(),
      };
      const harness = createHarness(content, persistence);
      await initialize(harness);
      loadCapture = await harness.host.captureAtBarrier();

      await harness.send("PREVIEW_IMPORT", {
        fileBytes: new Uint8Array([1, 2, 3]).buffer,
        destination: { kind: "new" },
      });
      const preview = harness.replies.findLast(
        (reply) => reply.kind === "REQUEST_RESULT" && reply.body.result.kind === "import-preview",
      );
      expect(preview?.kind).toBe("REQUEST_RESULT");
      if (preview?.kind !== "REQUEST_RESULT") throw new Error("Expected import preview result.");
      expect(preview.body.result.kind).toBe("import-preview");

      await harness.send(replacementKind, { slotId: session.slotId });
      const replaced = harness.replies.findLast((reply) => reply.kind === "SESSION_REPLACED");
      expect(replaced?.kind).toBe("SESSION_REPLACED");
      if (replaced?.kind !== "SESSION_REPLACED") throw new Error("Expected epoch transition.");

      await harness.sendAtEpoch(replaced.body.nextEpoch, "CONFIRM_IMPORT", {
        token: "old-epoch-token",
        destination: { kind: "new" },
        expectedRevision: null,
        applySettings: false,
      });

      expect(confirmImport).not.toHaveBeenCalled();
      expect(discardImport).toHaveBeenCalledOnce();
      expect(harness.replies.findLast((reply) => reply.kind === "REQUEST_ERROR")).toMatchObject({
        kind: "REQUEST_ERROR",
        body: { code: "TOKEN_CONSUMED", operation: "CONFIRM_IMPORT" },
      });
      harness.host.destroy();
    },
  );

  test.each([
    ["LOAD_SLOT", "prepare"],
    ["LOAD_SLOT", "promote"],
    ["RECOVER", "prepare"],
    ["RECOVER", "promote"],
  ] as const)(
    "retains an import preview when %s fails during %s",
    async (replacementKind, failurePoint) => {
      const session: WorkerSaveSessionInfo = {
        slotId: "slot-import-failed-transition",
        createdAtIso: "2026-09-24T12:00:00.000Z",
        settings: {
          language: "en",
          telemetryPreset: "standard",
          reducedEffects: false,
          reducedMotion: false,
          frameCap: 60,
          volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
        },
        localStats: {
          realPlayTimeSeconds: 0,
          taskCompletions: 0,
          taskAbandons: 0,
          emergencyShutdowns: 0,
          benchmarkAttempts: 0,
          designApplications: 0,
        },
      };
      let loadCapture: HostCapture | null = null;
      const discardImport = vi.fn();
      const confirmImport = vi.fn(() =>
        Promise.resolve({
          slotId: "imported-slot",
          revision: 1,
          tick: 12,
          savedAtIso: session.createdAtIso,
          sizeBytes: 42,
          appliedSettings: false,
          settings: null,
        }),
      );
      const persistence: WorkerSavePersistence = {
        startNewRun: () => Promise.resolve(session),
        save: () =>
          Promise.resolve({
            slotId: session.slotId,
            savedAtIso: session.createdAtIso,
            tick: 0,
            sizeBytes: 42,
          }),
        updateSettings: (settings) => Promise.resolve(settings),
        prepareLoad: () => {
          if (failurePoint === "prepare") return Promise.reject(new Error("prepare failed"));
          if (loadCapture === null) throw new Error("Missing load capture.");
          return Promise.resolve({
            state: loadCapture.state,
            nextQueueSequence: loadCapture.nextQueueSequence,
            createdAtIso: session.createdAtIso,
            localStats: session.localStats,
            checkpoint: {
              slotId: session.slotId,
              savedAtIso: session.createdAtIso,
              tick: loadCapture.state.tick,
              year: loadCapture.state.campaign.currentYear,
              captureSequence: 0,
              sourceKind: "manual",
              skippedCorruptRecords: 0,
            },
            promote: () => Promise.reject(new Error("promote failed")),
            rollback: () => Promise.resolve(),
          });
        },
        previewImport: () =>
          Promise.resolve({
            token: "retained-token",
            preview: {
              sourceSchemaVersion: 1,
              sourceSaveVersion: 1,
              contentVersion: content.contentVersion,
              simulatedYear: 1940,
              tick: 12,
              cashUsd: 0,
              verticalSliceCompleted: false,
              savedAtIso: session.createdAtIso,
              migrationRequired: false,
              compatibility: "compatible",
              destinationSuggestion: { kind: "new-slot" },
              compressedBytes: 42,
              uncompressedBytes: 42,
              slotId: "imported-slot",
            },
            allocatedSlotId: "imported-slot",
          }),
        discardImport,
        confirmImport,
        close: () => Promise.resolve(),
      };
      const harness = createHarness(content, persistence);
      await initialize(harness);
      loadCapture = await harness.host.captureAtBarrier();

      await harness.send("PREVIEW_IMPORT", {
        fileBytes: new Uint8Array([1, 2, 3]).buffer,
        destination: { kind: "new" },
      });
      await harness.send(replacementKind, { slotId: session.slotId });
      expect(discardImport).not.toHaveBeenCalled();

      await harness.send("CONFIRM_IMPORT", {
        token: "retained-token",
        destination: { kind: "new" },
        expectedRevision: null,
        applySettings: false,
      });

      expect(confirmImport).toHaveBeenCalledOnce();
      expect(
        harness.replies.findLast(
          (reply) =>
            reply.kind === "REQUEST_RESULT" && reply.body.result.kind === "import-confirmed",
        ),
      ).toBeDefined();
      harness.host.destroy();
    },
  );

  test("foreground timer cannot start a save during a pending load promotion", async () => {
    const session: WorkerSaveSessionInfo = {
      slotId: "slot-host-test",
      createdAtIso: "2026-09-24T12:00:00.000Z",
      settings: {
        language: "en",
        telemetryPreset: "standard",
        reducedEffects: false,
        reducedMotion: false,
        frameCap: 60,
        volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
      },
      localStats: {
        realPlayTimeSeconds: 0,
        taskCompletions: 0,
        taskAbandons: 0,
        emergencyShutdowns: 0,
        benchmarkAttempts: 0,
        designApplications: 0,
      },
    };
    let resolveLoad!: (candidate: WorkerLoadCandidate) => void;
    const save = vi.fn(() =>
      Promise.resolve({
        slotId: session.slotId,
        savedAtIso: session.createdAtIso,
        tick: 0,
        sizeBytes: 42,
      }),
    );
    const prepareLoad = vi.fn(
      () =>
        new Promise<WorkerLoadCandidate>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const persistence: WorkerSavePersistence = {
      startNewRun: () => Promise.resolve(session),
      save,
      updateSettings: (settings) => Promise.resolve(settings),
      prepareLoad,
      discardImport: () => undefined,
      close: () => Promise.resolve(),
    };
    const harness = createHarness(content, persistence);
    await initialize(harness);
    const captured = await harness.host.captureAtBarrier();
    const loading = harness.send("LOAD_SLOT", { slotId: session.slotId });
    await vi.waitFor(() => {
      expect(prepareLoad).toHaveBeenCalledOnce();
    });

    harness.timing.advanceBy(60_000);
    expect(save).not.toHaveBeenCalled();

    resolveLoad({
      state: captured.state,
      nextQueueSequence: captured.nextQueueSequence,
      createdAtIso: session.createdAtIso,
      localStats: session.localStats,
      checkpoint: {
        slotId: session.slotId,
        savedAtIso: session.createdAtIso,
        tick: captured.state.tick,
        year: captured.state.campaign.currentYear,
        captureSequence: 0,
        sourceKind: "manual",
        skippedCorruptRecords: 0,
      },
      promote: () => Promise.resolve(session),
      rollback: () => Promise.resolve(),
    });
    await loading;
    expect(save).not.toHaveBeenCalled();
    expect(harness.host.getLifecycle()).toBe("READY_HELD");
    harness.host.destroy();
  });

  test("coalesces foreground autosaves to the newest boundary while a write is pending", async () => {
    const captures: WorkerSaveCapture[] = [];
    const resolveWrites: ((metadata: WorkerSaveMetadata) => void)[] = [];
    const persistence: WorkerSavePersistence = {
      startNewRun: () =>
        Promise.resolve({
          slotId: "slot-host-test",
          createdAtIso: "2026-09-24T12:00:00.000Z",
          settings: {
            language: "en",
            telemetryPreset: "standard",
            reducedEffects: false,
            reducedMotion: false,
            frameCap: 60,
            volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
          },
          localStats: {
            realPlayTimeSeconds: 0,
            taskCompletions: 0,
            taskAbandons: 0,
            emergencyShutdowns: 0,
            benchmarkAttempts: 0,
            designApplications: 0,
          },
        }),
      save: vi.fn(
        (capture: WorkerSaveCapture) =>
          new Promise<WorkerSaveMetadata>((resolve) => {
            captures.push(capture);
            resolveWrites.push(resolve);
          }),
      ),
      updateSettings: (settings: WorkerSaveCapture["settings"]) => Promise.resolve(settings),
      discardImport: () => undefined,
      close: () => Promise.resolve(),
    };
    const harness = createHarness(content, persistence);
    await initialize(harness);

    harness.timing.advanceBy(59_999);
    expect(captures).toHaveLength(0);
    harness.timing.advanceBy(1);
    expect(captures).toHaveLength(1);
    expect(harness.host.getLifecycle()).toBe("MAINTENANCE");

    await harness.send("COMMAND", {
      command: parseSimCommand({
        commandId: "76000000-0000-4000-8000-000000000250",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    });
    expect(
      harness.replies.some(
        (reply) => reply.kind === "COMMAND_RESULT" && reply.body.result.accepted,
      ),
    ).toBe(true);

    harness.timing.advanceBy(60_000);
    expect(captures).toHaveLength(1);
    resolveWrites[0]?.({
      slotId: "slot-host-test",
      savedAtIso: "2026-09-24T12:01:00.000Z",
      tick: 0,
      sizeBytes: 42,
    });
    await vi.waitFor(() => {
      expect(captures).toHaveLength(2);
    });
    expect(captures[1]).toMatchObject({ state: { tick: 0 }, nextQueueSequence: 1 });
    resolveWrites[1]?.({
      slotId: "slot-host-test",
      savedAtIso: "2026-09-24T12:02:00.000Z",
      tick: 0,
      sizeBytes: 42,
    });
    await vi.waitFor(() => {
      expect(harness.host.getLifecycle()).toBe("READY_HELD");
    });
    harness.host.destroy();
  });

  test("saves current settings and counts only visible unpaused play time", async () => {
    const captures: WorkerSaveCapture[] = [];
    const settings = {
      language: "en" as const,
      telemetryPreset: "standard" as const,
      reducedEffects: false,
      reducedMotion: false,
      frameCap: 60 as const,
      volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
    };
    const localStats = {
      realPlayTimeSeconds: 0,
      taskCompletions: 0,
      taskAbandons: 0,
      emergencyShutdowns: 0,
      benchmarkAttempts: 0,
      designApplications: 0,
    };
    const persistence: WorkerSavePersistence = {
      startNewRun: () =>
        Promise.resolve({
          slotId: "slot-host-test",
          createdAtIso: "2026-09-24T12:00:00.000Z",
          settings,
          localStats,
        }),
      save: (capture) =>
        Promise.resolve().then(() => {
          captures.push(capture);
          return {
            slotId: "slot-host-test",
            savedAtIso: "2026-09-24T12:00:01.000Z",
            tick: capture.state.tick,
            sizeBytes: 42,
          };
        }),
      updateSettings: (nextSettings) => Promise.resolve(nextSettings),
      discardImport: () => undefined,
      close: () => Promise.resolve(),
    };
    const harness = createHarness(content, persistence);
    await initialize(harness);

    const clockCommand = (commandId: string, paused: boolean): Promise<void> =>
      harness.send("COMMAND", {
        command: parseSimCommand({ commandId, source: "player", kind: "SET_PAUSED", paused }),
      });
    await clockCommand("76000000-0000-4000-8000-000000000251", false);
    harness.timing.advanceBy(600);
    await clockCommand("76000000-0000-4000-8000-000000000252", true);
    harness.timing.advanceBy(1_500);
    await clockCommand("76000000-0000-4000-8000-000000000253", false);
    harness.timing.advanceBy(400);

    const updatedSettings = {
      ...settings,
      language: "ro" as const,
      telemetryPreset: "compact" as const,
      reducedEffects: true,
      frameCap: 45 as const,
    };
    await harness.send("UPDATE_SETTINGS", { settings: updatedSettings });
    await harness.send("REQUEST_SAVE", { reason: "manual" });

    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      settings: updatedSettings,
    });
    expect(captures[0]?.localStats.realPlayTimeSeconds).toBeGreaterThan(0.8);
    expect(captures[0]?.localStats.realPlayTimeSeconds).toBeLessThan(1.2);
    harness.host.destroy();
  });

  test("hiding requests a best-effort autosave and excludes hidden time from the interval", async () => {
    const captures: WorkerSaveCapture[] = [];
    const resolveWrites: ((metadata: WorkerSaveMetadata) => void)[] = [];
    const session: WorkerSaveSessionInfo = {
      slotId: "slot-host-test",
      createdAtIso: "2026-09-24T12:00:00.000Z",
      settings: {
        language: "en",
        telemetryPreset: "standard",
        reducedEffects: false,
        reducedMotion: false,
        frameCap: 60,
        volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
      },
      localStats: {
        realPlayTimeSeconds: 0,
        taskCompletions: 0,
        taskAbandons: 0,
        emergencyShutdowns: 0,
        benchmarkAttempts: 0,
        designApplications: 0,
      },
    };
    const persistence: WorkerSavePersistence = {
      startNewRun: () => Promise.resolve(session),
      save: (capture) =>
        new Promise((resolve) => {
          captures.push(capture);
          resolveWrites.push(resolve);
        }),
      updateSettings: (settings) => Promise.resolve(settings),
      discardImport: () => undefined,
      close: () => Promise.resolve(),
    };
    const harness = createHarness(content, persistence);
    await initialize(harness);

    await harness.send("SET_HOST_VISIBILITY", { visible: false });
    expect(captures).toHaveLength(1);
    expect(harness.host.getLifecycle()).toBe("MAINTENANCE");
    await harness.send("COMMAND", {
      command: parseSimCommand({
        commandId: "76000000-0000-4000-8000-000000000254",
        source: "player",
        kind: "ENTER_DESIGN_MODE",
      }),
    });
    harness.timing.advanceBy(120_000);
    expect(captures).toHaveLength(1);

    await harness.send("SET_HOST_VISIBILITY", { visible: true });
    harness.timing.advanceBy(60_000);
    resolveWrites[0]?.({
      slotId: session.slotId,
      savedAtIso: "2026-09-24T12:01:00.000Z",
      tick: 0,
      sizeBytes: 42,
    });
    await vi.waitFor(() => {
      expect(captures).toHaveLength(2);
    });
    expect(captures[1]?.nextQueueSequence).toBe(1);
    resolveWrites[1]?.({
      slotId: session.slotId,
      savedAtIso: "2026-09-24T12:02:00.000Z",
      tick: 0,
      sizeBytes: 42,
    });
    await vi.waitFor(() => {
      expect(harness.host.getLifecycle()).toBe("READY_HELD");
    });
    harness.host.destroy();
  });

  test("manual save captures same-tick command state and its next queue sequence", async () => {
    const replies: WorkerReply[] = [];
    const timing = new ManualTiming();
    const saves: { capture: unknown; reason: string }[] = [];
    const persistence = {
      startNewRun: vi.fn(() =>
        Promise.resolve({
          slotId: "slot-host-test",
          createdAtIso: "2026-09-24T12:00:00.000Z",
          settings: {
            language: "en",
            telemetryPreset: "standard",
            reducedEffects: false,
            reducedMotion: false,
            frameCap: 60,
            volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
          } as const,
          localStats: {
            realPlayTimeSeconds: 0,
            taskCompletions: 0,
            taskAbandons: 0,
            emergencyShutdowns: 0,
            benchmarkAttempts: 0,
            designApplications: 0,
          },
        }),
      ),
      save: vi.fn((capture: unknown, reason: string) =>
        Promise.resolve().then(() => {
          saves.push({ capture, reason });
          return {
            slotId: "slot-host-test",
            savedAtIso: "2026-09-24T12:00:01.000Z",
            tick: 0,
            sizeBytes: 42,
          };
        }),
      ),
      updateSettings: (settings: WorkerSaveCapture["settings"]) => Promise.resolve(settings),
      discardImport: () => undefined,
      close: vi.fn(() => Promise.resolve()),
    };
    const hostOptions = {
      content,
      timing: timing.adapter,
      persistence,
      postMessage: (reply: WorkerReply) => replies.push(parseWorkerReply(reply)),
    };
    const host = createSimWorkerHost(hostOptions);
    let sequence = 0;
    const send = async (kind: string, body: unknown): Promise<void> => {
      await host.receive({
        protocolVersion: 1,
        epoch: EPOCH,
        requestSequence: sequence,
        kind,
        body,
      });
      sequence += 1;
    };

    await send("INITIALIZE_NEW", {
      seed: "save-barrier-test",
      contentVersion: content.contentVersion,
      fingerprint: hashSimulationContent(content),
    });
    const ready = replies.find((reply) => reply.kind === "READY");
    if (ready?.kind !== "READY") throw new Error("Expected a ready Worker host.");
    await send("ACK_PUBLICATION", {
      publicationSequence: ready.body.publication.publicationSequence,
    });
    await send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000101", "SET_GUIDANCE_MODE", {
        mode: "engineering",
      }),
    });
    await send("REQUEST_SAVE", { reason: "manual" });

    expect(persistence.startNewRun).toHaveBeenCalledOnce();
    expect(persistence.save).toHaveBeenCalledOnce();
    expect(saves[0]).toMatchObject({ reason: "manual" });
    expect(saves[0]?.capture).toMatchObject({ nextQueueSequence: 1 });
    const save = replies.find(
      (reply) => reply.kind === "REQUEST_RESULT" && reply.body.result.kind === "save",
    );
    expect(save?.kind).toBe("REQUEST_RESULT");
    if (save?.kind !== "REQUEST_RESULT") throw new Error("Expected save completion.");
    expect(save.body.result).toMatchObject({
      kind: "save",
      metadata: { slotId: "slot-host-test", tick: 0, sizeBytes: 42 },
    });
    host.destroy();
  });

  test("returns stable storage codes when a requested save cannot commit", async () => {
    const persistence: WorkerSavePersistence = {
      startNewRun: () =>
        Promise.resolve({
          slotId: "slot-save-quota",
          createdAtIso: "2026-09-24T12:00:00.000Z",
          settings: {
            language: "en",
            telemetryPreset: "standard",
            reducedEffects: false,
            reducedMotion: false,
            frameCap: 60,
            volumes: { master: 1, music: 1, ui: 1, machinery: 1, alerts: 1 },
          },
          localStats: {
            realPlayTimeSeconds: 0,
            taskCompletions: 0,
            taskAbandons: 0,
            emergencyShutdowns: 0,
            benchmarkAttempts: 0,
            designApplications: 0,
          },
        }),
      save: () => Promise.reject(persistenceError("QUOTA_EXCEEDED", "private storage details")),
      updateSettings: (settings) => Promise.resolve(settings),
      discardImport: () => undefined,
      close: () => Promise.resolve(),
    };
    const harness = createHarness(content, persistence);
    await initialize(harness);
    await harness.send("REQUEST_SAVE", { reason: "manual" });
    await vi.waitFor(() => {
      expect(harness.replies.some((reply) => reply.kind === "REQUEST_ERROR")).toBe(true);
    });
    expect(harness.replies.find((reply) => reply.kind === "REQUEST_ERROR")).toMatchObject({
      body: { code: "QUOTA_EXCEEDED" },
    });
    expect(JSON.stringify(harness.replies)).not.toContain("private storage details");
    harness.host.destroy();
  });

  test("checks the bundled content handshake and publishes a full READY projection", async () => {
    const harness = createHarness();
    await harness.send("INITIALIZE_NEW", {
      seed: "worker-host-test",
      contentVersion: content.contentVersion,
      fingerprint: hashSimulationContent(content),
    });
    const ready = harness.replies[0];
    expect(ready?.kind).toBe("READY");
    if (ready?.kind !== "READY") throw new Error("Expected READY reply.");
    expect(ready.epoch).toBe(EPOCH);
    expect(ready.outboundSequence).toBe(0);
    expect(ready.requestSequence).toBe(0);
    expect(ready.body.publication.heatmap.full).toBe(true);
    expect(ready.body.publication.epoch).toBe(EPOCH);
    expect(ready.body.fingerprint).toBe(hashSimulationContent(content));
    expect(ready.body.snapshot.header.paused).toBe(true);
  });

  test("rejects a mismatched content fingerprint before constructing a session", async () => {
    const harness = createHarness();
    await harness.send("INITIALIZE_NEW", {
      seed: "worker-host-test",
      contentVersion: content.contentVersion,
      fingerprint: "ffffffffffffffff",
    });
    expect(harness.replies).toHaveLength(1);
    expect(harness.replies[0]?.kind).toBe("REQUEST_ERROR");
    if (harness.replies[0]?.kind !== "REQUEST_ERROR")
      throw new Error("Expected handshake rejection.");
    expect(harness.replies[0].body.code).toBe("INCOMPATIBLE_CONTENT");
    expect(harness.host.getLifecycle()).toBe("FATAL");
  });

  test("bounds a stalled publication to one degraded signal and an explicit full resync", async () => {
    const harness = createHarness();
    await harness.send("INITIALIZE_NEW", {
      seed: "worker-host-test",
      contentVersion: content.contentVersion,
      fingerprint: hashSimulationContent(content),
    });
    expect(harness.replies.some((reply) => reply.kind === "READY")).toBe(true);

    harness.timing.advanceBy(1_002);
    expect(harness.replies.filter((reply) => reply.kind === "TRANSPORT_DEGRADED")).toHaveLength(1);
    expect(harness.replies.filter((reply) => reply.kind === "SNAPSHOT_PUBLICATION")).toHaveLength(
      0,
    );
    harness.timing.advanceBy(2_000);
    expect(harness.replies.filter((reply) => reply.kind === "TRANSPORT_DEGRADED")).toHaveLength(1);

    await harness.send("REQUEST_FULL_SNAPSHOT", {});
    const publications = harness.replies.filter(
      (reply) => reply.kind === "SNAPSHOT_PUBLICATION" && reply.body.publication !== null,
    );
    expect(publications).toHaveLength(1);
    const resync = publications[0];
    if (resync?.kind !== "SNAPSHOT_PUBLICATION" || resync.body.publication === null) {
      throw new Error("Expected one full resync publication.");
    }
    expect(resync.body.publication.heatmap.full).toBe(true);
    await harness.send("ACK_PUBLICATION", {
      publicationSequence: resync.body.publication.publicationSequence,
    });
  });

  test("stops admission and emits transport overflow when terminal results remain unacknowledged", async () => {
    const harness = createHarness();
    await harness.send("INITIALIZE_NEW", {
      seed: "worker-host-result-queue",
      contentVersion: content.contentVersion,
      fingerprint: hashSimulationContent(content),
    });
    const ready = harness.replies.find((reply) => reply.kind === "READY");
    if (ready?.kind !== "READY") throw new Error("Expected READY before result-queue check.");
    await harness.send("ACK_RESULT", { outboundSequence: ready.outboundSequence });
    await harness.send("ACK_PUBLICATION", {
      publicationSequence: ready.body.publication.publicationSequence,
    });
    const publicationAckResult = harness.replies.findLast(
      (reply) => reply.kind === "REQUEST_RESULT" && reply.body.result.kind === "snapshot",
    );
    if (publicationAckResult === undefined)
      throw new Error("Expected publication acknowledgement result.");
    await harness.send("ACK_RESULT", { outboundSequence: publicationAckResult.outboundSequence });

    const responseCountBefore = harness.replies.filter(
      (reply) => reply.kind === "REQUEST_RESULT" || reply.kind === "REQUEST_ERROR",
    ).length;
    for (let index = 0; index < MAX_RESULT_QUEUE_ENTRIES; index += 1) {
      await harness.send("SET_PRESENTATION_CONTEXT", {
        selectedIds: [],
        inspectedEntityId: null,
        heatmapEnabled: true,
      });
    }
    expect(
      harness.replies.filter(
        (reply) => reply.kind === "REQUEST_RESULT" || reply.kind === "REQUEST_ERROR",
      ),
    ).toHaveLength(responseCountBefore + MAX_RESULT_QUEUE_ENTRIES);

    await harness.send("SET_PRESENTATION_CONTEXT", {
      selectedIds: [],
      inspectedEntityId: null,
      heatmapEnabled: true,
    });
    expect(harness.host.getLifecycle()).toBe("FATAL");
    expect(harness.replies.findLast((reply) => reply.kind === "FATAL_ERROR")).toMatchObject({
      kind: "FATAL_ERROR",
      body: { code: "TRANSPORT_OVERFLOW" },
    });
  });

  test("processes paused gameplay commands immediately and routes clock commands outside the queue", async () => {
    const harness = createHarness();
    await initialize(harness);
    const replay = createReplayRecorder({ content, seed: "worker-host-test" });
    const speedCommand = parseSimCommand(
      command("76000000-0000-4000-8000-000000000001", "SET_SPEED", { speed: 4 }),
    );
    await harness.send("COMMAND", {
      command: speedCommand,
    });
    replay.perform({ kind: "clock", command: speedCommand });
    const guidanceCommand = parseSimCommand(
      command("76000000-0000-4000-8000-000000000002", "SET_GUIDANCE_MODE", {
        mode: "engineering",
      }),
    );
    await harness.send("COMMAND", {
      command: guidanceCommand,
    });
    replay.perform({ kind: "enqueue", command: guidanceCommand });
    replay.perform({ kind: "process-pending" });
    const receipts = harness.replies.filter((reply) => reply.kind === "COMMAND_RECEIPT");
    expect(receipts).toHaveLength(1);
    if (receipts[0]?.kind !== "COMMAND_RECEIPT") throw new Error("Expected command receipt.");
    expect(receipts[0].body.receipt.queueSequence).toBe(0);
    const results = harness.replies.filter((reply) => reply.kind === "COMMAND_RESULT");
    expect(results).toHaveLength(2);
    const capture = await harness.host.captureAtBarrier();
    expect(capture.nextQueueSequence).toBe(1);
    expect(capture.state.tick).toBe(0);
    capture.state.tick = 77;
    const ownedCapture = await harness.host.captureAtBarrier();
    expect(ownedCapture.state.tick).toBe(0);
    const artifact = replay.finish();
    const replayReport = runReplay({
      content,
      initialState: artifact.initialState,
      log: artifact.log,
    });
    expect(replayReport.status).toBe("matched");
    expect(replayReport.finalStateHash).toBe(hashCanonicalState(ownedCapture.state));
    expect(replayReport.finalQueuePosition).toEqual({ nextSequence: 1, pendingCount: 0 });
    expect(harness.replies.filter((reply) => reply.kind === "SNAPSHOT_PUBLICATION")).toHaveLength(
      0,
    );
    harness.timing.advanceBy(99);
    expect(harness.replies.filter((reply) => reply.kind === "SNAPSHOT_PUBLICATION")).toHaveLength(
      0,
    );
    harness.timing.advanceBy(1);
    expect(harness.replies.filter((reply) => reply.kind === "SNAPSHOT_PUBLICATION")).toHaveLength(
      1,
    );
    expect(latestSnapshotTick(harness.replies)).toBe(0);
  });

  test("advances only complete 100 ms ticks at the active speed and keeps pause authoritative", async () => {
    const harness = createHarness();
    await initialize(harness);
    expect(harness.timing.pendingTimers(25)).toBe(0);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000003", "SET_PAUSED", { paused: false }),
    });
    expect(harness.timing.pendingTimers(25)).toBe(1);
    harness.timing.advanceBy(99);
    expect(latestSnapshotTick(harness.replies)).toBe(0);
    harness.timing.advanceBy(1);
    await harness.send("REQUEST_FULL_SNAPSHOT", {});
    expect(latestSnapshotTick(harness.replies)).toBe(1);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000004", "SET_PAUSED", { paused: true }),
    });
    expect(harness.timing.pendingTimers(25)).toBe(0);
    harness.timing.advanceBy(500);
    expect(latestSnapshotTick(harness.replies)).toBe(1);
  });

  test("settles the preceding real-time interval using the old speed at a speed barrier", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000005", "SET_PAUSED", { paused: false }),
    });
    harness.timing.elapseWithoutDelivery(25);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000006", "SET_SPEED", { speed: 4 }),
    });
    expect(latestSnapshotTick(harness.replies)).toBe(0);
    harness.timing.advanceBy(25);
    await harness.send("REQUEST_FULL_SNAPSHOT", {});
    expect(latestSnapshotTick(harness.replies)).toBe(1);
  });

  test("does not apply a clock command after the timing barrier makes the host fatal", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000051", "SET_PAUSED", {
        paused: false,
      }),
    });
    harness.timing.setTime(-1);

    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000052", "SET_SPEED", { speed: 2 }),
    });

    expect(harness.host.getLifecycle()).toBe("FATAL");
    expect(harness.replies.some((reply) => reply.kind === "FATAL_ERROR")).toBe(true);
    expect(
      harness.replies.some(
        (reply) =>
          reply.kind === "COMMAND_RESULT" &&
          reply.body.commandId === "76000000-0000-4000-8000-000000000052",
      ),
    ).toBe(false);
  });

  test("holds scheduler time across serialized maintenance work and resumes from a fresh origin", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000011", "SET_PAUSED", {
        paused: false,
      }),
    });
    harness.timing.advanceBy(100);
    expect((await harness.host.captureAtBarrier()).state.tick).toBe(1);

    let markEntered: (() => void) | null = null;
    let releaseHold!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const maintenance = harness.host.runMaintenance(
      () =>
        new Promise<void>((resolve) => {
          releaseHold = resolve;
          markEntered?.();
        }),
    );
    await entered;
    expect(harness.host.getLifecycle()).toBe("MAINTENANCE");
    const queuedCommand = harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000012", "SET_GUIDANCE_MODE", {
        mode: "engineering",
      }),
    });
    let secondOperationStarted = false;
    await expect(
      harness.host.runMaintenance(() => {
        secondOperationStarted = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow("already active");
    harness.timing.advanceBy(500);
    expect(harness.replies.filter((reply) => reply.kind === "COMMAND_RESULT").length).toBe(1);
    expect(secondOperationStarted).toBe(false);
    releaseHold();
    await Promise.all([maintenance, queuedCommand]);
    expect(harness.host.getLifecycle()).toBe("RUNNING");
    expect((await harness.host.captureAtBarrier()).state.tick).toBe(1);
    harness.timing.advanceBy(100);
    expect((await harness.host.captureAtBarrier()).state.tick).toBe(2);
  });

  test("caps a normal burst at 20 ticks, discards excess debt and requires explicit continue", async () => {
    const capped = createHarness();
    await initialize(capped);
    await capped.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000007", "SET_SPEED", { speed: 4 }),
    });
    await capped.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000008", "SET_PAUSED", { paused: false }),
    });
    capped.timing.jumpAndRun(500);
    expect(latestSnapshotTick(capped.replies)).toBe(20);

    const overflow = createHarness();
    await initialize(overflow);
    await overflow.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000009", "SET_SPEED", { speed: 4 }),
    });
    await overflow.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000010", "SET_PAUSED", { paused: false }),
    });
    overflow.timing.jumpAndRun(525);
    expect(latestSnapshotTick(overflow.replies)).toBe(0);
    const suspended = overflow.replies.findLast((reply) => reply.kind === "SUSPENDED");
    expect(suspended?.kind).toBe("SUSPENDED");
    if (suspended?.kind !== "SUSPENDED") throw new Error("Expected suspended hold.");
    expect(suspended.body).toEqual({ reason: "debt", requiresContinue: true });
    expect(overflow.timing.pendingTimers(25)).toBe(0);
    await overflow.send("CONTINUE_HOST", {});
    expect(overflow.timing.pendingTimers(25)).toBe(1);
  });

  test("long gaps suspend without offline ticks and visibility suspension resumes without replay", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000011", "SET_PAUSED", { paused: false }),
    });
    harness.timing.jumpAndRun(2_001);
    expect(latestSnapshotTick(harness.replies)).toBe(0);
    const suspended = harness.replies.findLast((reply) => reply.kind === "SUSPENDED");
    expect(suspended?.kind).toBe("SUSPENDED");
    if (suspended?.kind !== "SUSPENDED") throw new Error("Expected suspended hold.");
    expect(suspended.body).toEqual({ reason: "long-gap", requiresContinue: true });
    await harness.send("SET_HOST_VISIBILITY", { visible: false });
    await harness.send("SET_HOST_VISIBILITY", { visible: true });
    expect(harness.timing.pendingTimers(25)).toBe(0);
    await harness.send("CONTINUE_HOST", {});
    expect(harness.timing.pendingTimers(25)).toBe(1);
    await harness.send("SET_HOST_VISIBILITY", { visible: false });
    expect(harness.timing.pendingTimers(25)).toBe(0);
    const hidden = harness.replies.findLast((reply) => reply.kind === "SUSPENDED");
    expect(hidden?.kind).toBe("SUSPENDED");
    if (hidden?.kind !== "SUSPENDED") throw new Error("Expected hidden hold.");
    expect(hidden.body).toEqual({ reason: "hidden", requiresContinue: false });
    harness.timing.elapseWithoutDelivery(5_000);
    await harness.send("SET_HOST_VISIBILITY", { visible: true });
    expect(harness.timing.pendingTimers(25)).toBe(1);
    harness.timing.advanceBy(25);
    expect(latestSnapshotTick(harness.replies)).toBe(0);
  });

  test("rejects invalid command transport data without a receipt but preserves domain rejection results", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000012", "BUY_MODULE", {
        definitionId: "unknown-module",
        quantity: 0,
      }),
    });
    expect(harness.replies.filter((reply) => reply.kind === "COMMAND_RECEIPT")).toHaveLength(0);
    expect(harness.replies.at(-1)?.kind).toBe("REQUEST_ERROR");
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000013", "BUY_MODULE", {
        definitionId: "unknown-module",
        quantity: 1,
      }),
    });
    expect(harness.replies.filter((reply) => reply.kind === "COMMAND_RECEIPT")).toHaveLength(1);
    const result = harness.replies.findLast((reply) => reply.kind === "COMMAND_RESULT");
    expect(result?.kind).toBe("COMMAND_RESULT");
    if (result?.kind !== "COMMAND_RESULT") throw new Error("Expected domain command result.");
    expect(result.body.result.accepted).toBe(false);
  });

  test("publishes an epoch-scoped committed rejection fact after the command result", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000018", "BUY_MODULE", {
        definitionId: "unknown-module",
        quantity: 1,
      }),
    });
    const commandResultIndex = harness.replies.findLastIndex(
      (reply) => reply.kind === "COMMAND_RESULT",
    );
    const factBatch = harness.replies.findLast((reply) => reply.kind === "EVENT_BATCH");
    expect(factBatch?.kind).toBe("EVENT_BATCH");
    if (factBatch?.kind !== "EVENT_BATCH") throw new Error("Expected committed rejection fact.");
    expect(commandResultIndex).toBeGreaterThan(-1);
    expect(harness.replies.indexOf(factBatch)).toBeGreaterThan(commandResultIndex);
    expect(factBatch.body.firstEventSequence).toBe(0);
    expect(factBatch.body.events).toHaveLength(1);
    expect(factBatch.body.events[0]).toMatchObject({
      eventSequence: 0,
      event: {
        eventId: `${EPOCH}-event-0`,
        kind: "COMMAND_REJECTED",
        commandId: "76000000-0000-4000-8000-000000000018",
        severity: "warning",
      },
    });
  });

  test("observes an accepted task transition from the committed simulator projection", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: {
        commandId: "76000000-0000-4000-8000-000000000019",
        source: "player",
        kind: "ACCEPT_TASK",
        definitionId: "task-ballistic-table-verification",
        expectedTick: 0,
      },
    });
    const batch = harness.replies.findLast((reply) => reply.kind === "EVENT_BATCH");
    expect(batch?.kind).toBe("EVENT_BATCH");
    if (batch?.kind !== "EVENT_BATCH") throw new Error("Expected committed task fact.");
    expect(batch.body.events).toHaveLength(1);
    expect(batch.body.events[0]?.event).toMatchObject({
      kind: "TASK_ACCEPTED",
      taskInstanceId: "task-instance-00000001",
      eventId: `${EPOCH}-event-0`,
    });
    expect(harness.replies.findLast((reply) => reply.kind === "COMMAND_RESULT")).toMatchObject({
      kind: "COMMAND_RESULT",
      body: { result: { accepted: true } },
    });
  });

  test("publishes purchase and research facts with exact committed identifiers", async () => {
    const researchContent: ContentBundle = {
      ...content,
      era: { ...content.era, startingResearchData: 12 },
    };
    const harness = createHarness(researchContent);
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000020", "BUY_MODULE", {
        definitionId: "module-power-distribution",
        quantity: 1,
      }),
    });
    await harness.send("COMMAND", {
      command: {
        commandId: "76000000-0000-4000-8000-000000000021",
        source: "player",
        kind: "START_RESEARCH",
        nodeId: "research-stable-power-distribution",
        reservedComputeShare: 0.1,
        expectedTick: 0,
      },
    });
    const batches = harness.replies.filter((reply) => reply.kind === "EVENT_BATCH");
    expect(batches).toHaveLength(2);
    expect(batches[0]).toMatchObject({
      kind: "EVENT_BATCH",
      body: {
        firstEventSequence: 0,
        events: [
          {
            eventSequence: 0,
            event: {
              kind: "MODULE_PURCHASED",
              definitionId: "module-power-distribution",
              quantity: 1,
            },
          },
        ],
      },
    });
    expect(batches[1]).toMatchObject({
      kind: "EVENT_BATCH",
      body: {
        firstEventSequence: 1,
        events: [
          {
            eventSequence: 1,
            event: { kind: "RESEARCH_STARTED", nodeId: "research-stable-power-distribution" },
          },
        ],
      },
    });
    expect(harness.replies.filter((reply) => reply.kind === "COMMAND_RESULT")).toHaveLength(2);
  });

  test("does not admit gaps, duplicate requests, stale epochs or production STEP_DEBUG", async () => {
    const harness = createHarness();
    await initialize(harness);
    const before = harness.replies.length;
    await harness.host.receive({
      protocolVersion: 1,
      epoch: "stale-epoch",
      requestSequence: 2,
      kind: "COMMAND",
      body: {
        command: command("76000000-0000-4000-8000-000000000014", "SET_GUIDANCE_MODE", {
          mode: "skip",
        }),
      },
    });
    expect(harness.replies).toHaveLength(before);
    await harness.host.receive({
      protocolVersion: 1,
      epoch: EPOCH,
      requestSequence: 2,
      kind: "STEP_DEBUG",
      body: { ticks: 100 },
    });
    expect(harness.replies.at(-1)?.kind).toBe("REQUEST_ERROR");
    expect(latestSnapshotTick(harness.replies)).toBe(0);
  });

  test("shutdown clears the timer and becomes terminal", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000015", "SET_PAUSED", { paused: false }),
    });
    expect(harness.timing.pendingTimers(25)).toBe(1);
    await harness.send("SHUTDOWN", {});
    expect(harness.timing.pendingTimers()).toBe(0);
    expect(harness.replies.at(-1)?.kind).toBe("SHUTDOWN_COMPLETE");
    await expect(harness.send("REQUEST_FULL_SNAPSHOT", {})).rejects.toThrow();
  });

  test("a nonmonotonic host clock freezes scheduling after preserving completed ticks", async () => {
    const harness = createHarness();
    await initialize(harness);
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000016", "SET_PAUSED", { paused: false }),
    });
    harness.timing.advanceBy(100);
    await harness.send("REQUEST_FULL_SNAPSHOT", {});
    expect(latestSnapshotTick(harness.replies)).toBe(1);
    harness.timing.setTime(99);
    harness.timing.fireNextRegardlessOfDueTime();
    const fatal = harness.replies.findLast((reply) => reply.kind === "FATAL_ERROR");
    expect(fatal?.kind).toBe("FATAL_ERROR");
    if (fatal?.kind !== "FATAL_ERROR") throw new Error("Expected sanitized host fatal report.");
    expect(fatal.body).toMatchObject({ code: "WORKER_ERROR", tick: 1, stage: null });
    expect(harness.host.getLifecycle()).toBe("FATAL");
    expect(harness.timing.pendingTimers(25)).toBe(0);
    const completedCommand = harness.replies.find((reply) => reply.kind === "COMMAND_RESULT");
    if (completedCommand === undefined) throw new Error("Expected a completed command result.");
    await harness.send("ACK_RESULT", { outboundSequence: completedCommand.outboundSequence });
    await harness.send("COMMAND", {
      command: command("76000000-0000-4000-8000-000000000017", "SET_GUIDANCE_MODE", {
        mode: "skip",
      }),
    });
    expect(harness.replies.at(-1)).toMatchObject({
      kind: "REQUEST_ERROR",
      body: { code: "OUTCOME_UNKNOWN", operation: "COMMAND" },
    });
    expect(harness.replies.filter((reply) => reply.kind === "COMMAND_RECEIPT")).toHaveLength(0);
  });
});
