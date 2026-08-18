const FNV1A_32_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_32_PRIME = 0x01000193;
const MULBERRY32_INCREMENT = 0x6d2b79f5;
const UINT32_RANGE = 0x1_0000_0000;
const UINT32_MAX = 0xffff_ffff;

export interface SeededRng {
  nextUint32(): number;
  nextFloat(): number;
  getState(): number;
}

function assertSeed(seed: string): void {
  if (seed.trim().length === 0) {
    throw new Error("Seed must contain a non-whitespace character.");
  }
}

export function seedToUint32(seed: string): number {
  assertSeed(seed);

  let hash = FNV1A_32_OFFSET_BASIS;
  for (let index = 0; index < seed.length; index += 1) {
    const codeUnit = seed.charCodeAt(index);
    hash ^= codeUnit & 0xff;
    hash = Math.imul(hash, FNV1A_32_PRIME);
    hash ^= codeUnit >>> 8;
    hash = Math.imul(hash, FNV1A_32_PRIME);
  }

  return hash >>> 0;
}

class Mulberry32Rng implements SeededRng {
  private state: number;

  constructor(state: number) {
    if (!Number.isInteger(state) || state < 0 || state > UINT32_MAX) {
      throw new Error("RNG state must be an unsigned 32-bit integer.");
    }
    this.state = state;
  }

  nextUint32(): number {
    this.state = (this.state + MULBERRY32_INCREMENT) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  getState(): number {
    return this.state;
  }
}

export function createSeededRng(seed: string): SeededRng {
  return new Mulberry32Rng(seedToUint32(seed));
}

export function createSeededRngFromState(state: number): SeededRng {
  return new Mulberry32Rng(state);
}
