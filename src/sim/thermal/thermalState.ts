import type { FacilityState } from "../core/types.ts";
import type { ThermalIssue } from "./contracts.ts";

export interface ThermalBalancingContract {
  readonly minimumTemperatureC: number;
  readonly maximumTemperatureC: number;
}

export function validateThermalState(
  facility: Readonly<FacilityState>,
  balancing: Readonly<ThermalBalancingContract>,
): ThermalIssue[] {
  const issues: ThermalIssue[] = [];
  const { width, height } = facility.size;
  const validSize =
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
  if (!validSize) {
    issues.push({
      path: "facility.size",
      message: "must contain positive safe integer dimensions",
    });
  }
  if (!Number.isFinite(facility.ambientTemperatureC)) {
    issues.push({ path: "facility.ambientTemperatureC", message: "must be finite" });
  }
  const lowerTemperatureC = Math.max(
    balancing.minimumTemperatureC,
    facility.ambientTemperatureC - 10,
  );
  const validBounds =
    Number.isFinite(balancing.minimumTemperatureC) &&
    Number.isFinite(balancing.maximumTemperatureC) &&
    Number.isFinite(lowerTemperatureC) &&
    lowerTemperatureC <= balancing.maximumTemperatureC;
  if (!validBounds) {
    issues.push({ path: "balancing.thermal", message: "must resolve finite ordered clamp bounds" });
  }
  if (!Number.isSafeInteger(facility.thermalRevision) || facility.thermalRevision < 0) {
    issues.push({
      path: "facility.thermalRevision",
      message: "must be a nonnegative safe integer",
    });
  }

  const expectedTileCount = validSize ? width * height : 0;
  if (facility.thermalTiles.length !== expectedTileCount) {
    issues.push({
      path: "facility.thermalTiles",
      message: "must cover the facility with exactly one tile per position",
    });
  }
  for (let index = 0; index < facility.thermalTiles.length; index += 1) {
    const tile = facility.thermalTiles[index];
    if (tile === undefined) continue;
    const { x, y } = tile.position;
    const expectedX = validSize ? index % width : undefined;
    const expectedY = validSize ? Math.floor(index / width) : undefined;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      issues.push({ path: `facility.thermalTiles[${index}].position`, message: "must be integer" });
    } else {
      if (validSize && (x < 0 || x >= width || y < 0 || y >= height)) {
        issues.push({
          path: `facility.thermalTiles[${index}].position`,
          message: "must be within facility bounds",
        });
      }
      if (x !== expectedX || y !== expectedY) {
        issues.push({
          path: `facility.thermalTiles[${index}].position`,
          message: "must use exact row-major facility coverage",
        });
      }
    }
    if (!Number.isFinite(tile.temperatureC)) {
      issues.push({
        path: `facility.thermalTiles[${index}].temperatureC`,
        message: "must be finite",
      });
    } else if (
      validBounds &&
      (tile.temperatureC < lowerTemperatureC || tile.temperatureC > balancing.maximumTemperatureC)
    ) {
      issues.push({
        path: `facility.thermalTiles[${index}].temperatureC`,
        message: "must be within resolved clamp bounds",
      });
    }
  }

  for (const moduleId of Object.keys(facility.modules).toSorted()) {
    const module = facility.modules[moduleId];
    if (module === undefined) continue;
    if (!Number.isFinite(module.binEfficiencyRatio) || module.binEfficiencyRatio <= 0) {
      issues.push({
        path: `facility.modules.${moduleId}.binEfficiencyRatio`,
        message: "must be finite and positive for thermal heat generation",
      });
    }
    if (!Number.isFinite(module.binThermalRatio) || module.binThermalRatio <= 0) {
      issues.push({
        path: `facility.modules.${moduleId}.binThermalRatio`,
        message: "must be finite and positive for thermal heat generation",
      });
    }
  }
  return issues;
}

export function assertValidThermalState(
  facility: Readonly<FacilityState>,
  balancing: Readonly<ThermalBalancingContract>,
): void {
  const issues = validateThermalState(facility, balancing);
  if (issues.length > 0) {
    throw new Error(
      `Invalid thermal state:\n${issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n")}`,
    );
  }
}
