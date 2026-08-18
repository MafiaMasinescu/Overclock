export const MICRODOLLARS_PER_USD = 1_000_000;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer.`);
  }
}

function roundHalfAwayFromZero(value: number): number {
  assertFinite(value, "Monetary value");
  const magnitude = Math.floor(Math.abs(value) + 0.5);
  if (!Number.isSafeInteger(magnitude)) {
    throw new RangeError("Monetary value exceeds the safe-integer range.");
  }
  if (magnitude === 0) {
    return 0;
  }
  return value < 0 ? -magnitude : magnitude;
}

export function usdToMicrodollars(valueUsd: number): number {
  assertFinite(valueUsd, "USD value");
  const scaled = valueUsd * MICRODOLLARS_PER_USD;
  assertFinite(scaled, "Scaled USD value");
  return roundHalfAwayFromZero(scaled);
}

export function microdollarsToUsd(valueMicrodollars: number): number {
  assertSafeInteger(valueMicrodollars, "Microdollar value");
  if (valueMicrodollars === 0) {
    return 0;
  }
  return valueMicrodollars / MICRODOLLARS_PER_USD;
}

export function quantizeUsd(valueUsd: number): number {
  return microdollarsToUsd(usdToMicrodollars(valueUsd));
}

export function isMicrodollarAlignedUsd(valueUsd: number): boolean {
  if (!Number.isFinite(valueUsd)) {
    return false;
  }
  try {
    return microdollarsToUsd(usdToMicrodollars(valueUsd)) === valueUsd;
  } catch {
    return false;
  }
}

export function addMicrodollars(left: number, right: number): number {
  assertSafeInteger(left, "Left microdollar value");
  assertSafeInteger(right, "Right microdollar value");
  const result = left + right;
  assertSafeInteger(result, "Microdollar sum");
  return result;
}

export function multiplyMicrodollars(value: number, multiplier: number): number {
  assertSafeInteger(value, "Microdollar value");
  assertSafeInteger(multiplier, "Microdollar multiplier");
  const result = value * multiplier;
  assertSafeInteger(result, "Microdollar product");
  return result;
}

export function divideMicrodollarsHalfAwayFromZero(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, "Microdollar numerator");
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError("Microdollar denominator must be a positive safe integer.");
  }

  const magnitude = Math.abs(numerator);
  const quotient = Math.floor(magnitude / denominator);
  const remainder = magnitude % denominator;
  const roundedMagnitude = remainder >= Math.ceil(denominator / 2) ? quotient + 1 : quotient;
  assertSafeInteger(roundedMagnitude, "Rounded microdollar quotient");
  if (roundedMagnitude === 0) {
    return 0;
  }
  return numerator < 0 ? -roundedMagnitude : roundedMagnitude;
}

function assertFiniteNonnegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be nonnegative.`);
  }
}

export function calculateEnergyCostUsd(
  powerWatts: number,
  simulatedSeconds: number,
  energyPriceUsdPerKwh: number,
): number {
  assertFiniteNonnegative(powerWatts, "Power");
  assertFiniteNonnegative(simulatedSeconds, "Simulated seconds");
  assertFiniteNonnegative(energyPriceUsdPerKwh, "Energy price");

  const wattSeconds = powerWatts * simulatedSeconds;
  assertFinite(wattSeconds, "Energy");
  const energyKWh = wattSeconds / 3_600_000;
  const costUsd = energyKWh * energyPriceUsdPerKwh;
  assertFinite(costUsd, "Energy cost");
  return quantizeUsd(costUsd);
}
