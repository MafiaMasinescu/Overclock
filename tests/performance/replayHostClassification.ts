export interface ReplayDiagnosticHost {
  readonly cpuModels: readonly string[];
  readonly platform: string;
  readonly architecture: string;
  readonly osRelease: string;
  readonly nodeVersion: string;
}

export type ReplayTargetClassification = "verified-target" | "non-gating-host";

const TARGET_CPU = "intel core i7-2600 cpu @ 3.40ghz";

function normalizeCpuModel(model: string): string {
  return model
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("(r)", "")
    .replaceAll("(tm)", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyReplayDiagnosticHost(
  host: ReplayDiagnosticHost,
): ReplayTargetClassification {
  if (host.platform !== "win32" || host.architecture !== "x64" || host.cpuModels.length === 0) {
    return "non-gating-host";
  }
  const normalized = host.cpuModels.map(normalizeCpuModel);
  return normalized.every((model) => model === TARGET_CPU) ? "verified-target" : "non-gating-host";
}
