import type { GridPoint, Rotation, Size2D } from "../../sim/core/types.ts";

const VALID_ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export function isValidRotation(value: number): value is Rotation {
  return VALID_ROTATIONS.includes(value as Rotation);
}

export function isIntegerGridPoint(point: GridPoint): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y);
}

export function isValidFootprintSize(size: Size2D): boolean {
  return (
    Number.isSafeInteger(size.width) &&
    Number.isSafeInteger(size.height) &&
    size.width > 0 &&
    size.height > 0
  );
}

export function isValidFacilitySize(size: Size2D): boolean {
  return isValidFootprintSize(size);
}

function assertValidFootprintSize(size: Size2D): void {
  if (!isValidFootprintSize(size)) {
    throw new RangeError("Footprint dimensions must be positive safe integers.");
  }
}

function assertValidRotation(rotation: Rotation): void {
  if (!isValidRotation(rotation)) {
    throw new RangeError("Rotation must be 0, 90, 180, or 270 degrees.");
  }
}

export function resolveRotatedFootprintSize(size: Size2D, rotation: Rotation): Size2D {
  assertValidFootprintSize(size);
  assertValidRotation(rotation);
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

export function transformLocalFootprintPoint(
  point: GridPoint,
  unrotatedSize: Size2D,
  rotation: Rotation,
): GridPoint {
  assertValidFootprintSize(unrotatedSize);
  assertValidRotation(rotation);
  if (
    !isIntegerGridPoint(point) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= unrotatedSize.width ||
    point.y >= unrotatedSize.height
  ) {
    throw new RangeError("Local footprint point must belong to the unrotated footprint.");
  }

  switch (rotation) {
    case 0:
      return { x: point.x, y: point.y };
    case 90:
      return { x: unrotatedSize.height - 1 - point.y, y: point.x };
    case 180:
      return {
        x: unrotatedSize.width - 1 - point.x,
        y: unrotatedSize.height - 1 - point.y,
      };
    case 270:
      return { x: point.y, y: unrotatedSize.width - 1 - point.x };
  }
}

export function enumerateOccupiedTiles(
  position: GridPoint,
  unrotatedSize: Size2D,
  rotation: Rotation,
): GridPoint[] {
  if (!isIntegerGridPoint(position)) {
    throw new RangeError("Module position must use integer coordinates.");
  }
  const rotated = resolveRotatedFootprintSize(unrotatedSize, rotation);
  const tiles: GridPoint[] = [];
  for (let y = 0; y < rotated.height; y += 1) {
    for (let x = 0; x < rotated.width; x += 1) {
      tiles.push({ x: position.x + x, y: position.y + y });
    }
  }
  return tiles;
}

export function isGridPointInBounds(point: GridPoint, facilitySize: Size2D): boolean {
  return (
    isIntegerGridPoint(point) &&
    isValidFacilitySize(facilitySize) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < facilitySize.width &&
    point.y < facilitySize.height
  );
}
