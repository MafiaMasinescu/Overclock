import { describe, expect, test } from "vitest";

import {
  classifyReplayDiagnosticHost,
  type ReplayDiagnosticHost,
} from "../performance/replayHostClassification.ts";

function host(overrides: Partial<ReplayDiagnosticHost> = {}): ReplayDiagnosticHost {
  return {
    cpuModels: ["Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz"],
    platform: "win32",
    architecture: "x64",
    osRelease: "10.0.19045",
    nodeVersion: "v24.11.0",
    ...overrides,
  };
}

describe("Replay diagnostic host classification", () => {
  test("recognizes only the precisely normalized documented target", () => {
    expect(classifyReplayDiagnosticHost(host())).toBe("verified-target");
    expect(
      classifyReplayDiagnosticHost(host({ cpuModels: ["  Intel Core i7-2600   CPU @ 3.40GHz  "] })),
    ).toBe("verified-target");
  });

  test.each([
    { cpuModels: [] },
    { cpuModels: ["unknown"] },
    { cpuModels: ["Virtual CPU"] },
    { cpuModels: ["Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz", "unknown"] },
    { cpuModels: ["Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz"], platform: "linux" },
    { cpuModels: ["Intel(R) Core(TM) i7-2600 CPU @ 3.40GHz"], architecture: "arm64" },
  ])("keeps unknown, ambiguous, virtualized, or mismatched metadata non-gating", (override) => {
    expect(classifyReplayDiagnosticHost(host(override))).toBe("non-gating-host");
  });
});
