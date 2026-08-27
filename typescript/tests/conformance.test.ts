import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  RandomSeed,
  SEEDED_RANDOM_ALGORITHM,
  SeededRandom,
  shuffle,
} from "../src/index.js";

interface RandomnessVector {
  readonly seed: string;
  readonly outputs: readonly string[];
  readonly indexUpperExclusive: number;
  readonly indexes: readonly number[];
  readonly shuffleInput: readonly number[];
  readonly shuffled: readonly number[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../rust/fixtures/randomness-v1.json", import.meta.url),
    "utf8",
  ),
) as {
  readonly profile: string;
  readonly algorithm: string;
  readonly vectors: readonly RandomnessVector[];
};

describe("cross-language randomness conformance", () => {
  it("pins raw output, bounded sampling, and shuffle ordering", () => {
    expect(fixture.profile).toBe("game-core-randomness-v1");
    expect(fixture.algorithm).toBe(SEEDED_RANDOM_ALGORITHM);
    for (const vector of fixture.vectors) {
      const seed = RandomSeed.from(BigInt(vector.seed));
      const raw = new SeededRandom(seed);
      expect(
        vector.outputs.map(() => raw.nextU64().toString()),
        vector.seed,
      ).toEqual(vector.outputs);

      const bounded = new SeededRandom(seed);
      expect(
        vector.indexes.map(() => bounded.nextIndex(vector.indexUpperExclusive)),
      ).toEqual(vector.indexes);

      const values = [...vector.shuffleInput];
      shuffle(values, new SeededRandom(seed));
      expect(values).toEqual(vector.shuffled);
    }
  });
});
