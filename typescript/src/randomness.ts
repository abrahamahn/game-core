const MASK_64 = 0xffff_ffff_ffff_ffffn;
const GAMMA = 0x9e37_79b9_7f4a_7c15n;

export const SEEDED_RANDOM_ALGORITHM = 'splitmix64-v1' as const;

export class RandomSeed {
  private constructor(public readonly value: bigint) {}

  public static from(value: bigint | number): RandomSeed {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError('Random seed must be an unsigned 64-bit integer');
    }
    const seed = typeof value === 'number' ? BigInt(value) : value;
    if (seed < 0n || seed > MASK_64) {
      throw new RangeError('Random seed must be an unsigned 64-bit integer');
    }
    return new RandomSeed(seed);
  }
}

export interface RandomSource {
  nextU64(): bigint;
  nextIndex(upperExclusive: number): number;
}

/** Random source whose position can be restored when an action fails before commit. */
export interface TransactionalRandomSource<Checkpoint = unknown> extends RandomSource {
  checkpoint(): Checkpoint;
  restore(checkpoint: Checkpoint): void;
}

export class SeededRandom implements TransactionalRandomSource<bigint> {
  #state: bigint;

  public constructor(seed: RandomSeed) {
    this.#state = seed.value;
  }

  public nextU64(): bigint {
    this.#state = (this.#state + GAMMA) & MASK_64;
    let value = this.#state;
    value = ((value ^ (value >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
    value = ((value ^ (value >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
    return (value ^ (value >> 31n)) & MASK_64;
  }

  public nextIndex(upperExclusive: number): number {
    if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
      throw new RandomError(
        upperExclusive === 0 ? 'GAME_RANDOM_EMPTY_RANGE' : 'GAME_RANDOM_RANGE_TOO_LARGE',
      );
    }
    const upper = BigInt(upperExclusive);
    const threshold = ((1n << 64n) - upper) % upper;
    for (;;) {
      const value = this.nextU64();
      if (value >= threshold) return Number(value % upper);
    }
  }

  public checkpoint(): bigint {
    return this.#state;
  }

  public restore(checkpoint: bigint): void {
    if (checkpoint < 0n || checkpoint > MASK_64) {
      throw new RangeError('Random checkpoint must be an unsigned 64-bit integer');
    }
    this.#state = checkpoint;
  }
}

export type RandomErrorCode = 'GAME_RANDOM_EMPTY_RANGE' | 'GAME_RANDOM_RANGE_TOO_LARGE';

export class RandomError extends Error {
  public override readonly name = 'RandomError';

  public constructor(public readonly code: RandomErrorCode) {
    super(code);
  }
}

export function shuffle(values: unknown[], random: RandomSource): void {
  for (let upper = values.length; upper >= 2; upper -= 1) {
    const selected = random.nextIndex(upper);
    const target = upper - 1;
    const current = values[target];
    const replacement = values[selected];
    if (current === undefined || replacement === undefined) {
      throw new RangeError('Shuffle index escaped the input');
    }
    values[target] = replacement;
    values[selected] = current;
  }
}
