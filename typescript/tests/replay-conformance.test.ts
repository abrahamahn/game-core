import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  acceptAction,
  continueGame,
  finishGame,
  GameAction,
  GameDefinitionRef,
  GameExecutionError,
  GameSession,
  GameSessionRef,
  GameVersion,
  ParticipantId,
  RandomSeed,
  rejectAction,
  replay,
  replayFromSnapshot,
  SeededRandom,
  type ActionContext,
  type GameRules,
  type GameSnapshot,
  type GameStateOwnership,
  type GameStatus,
  type RandomSource,
} from "../src/index.js";

interface State {
  readonly participant: string;
  readonly target: number;
  readonly turns: number;
  readonly total: number;
}

interface Event {
  readonly kind: "rolled";
  readonly value: number;
  readonly total: number;
}

interface Outcome {
  readonly winner: string;
  readonly total: number;
}

interface ActionFixture {
  readonly expectedVersion: number;
  readonly actor: string;
  readonly accepted: boolean;
  readonly error?: string;
  readonly version: number;
  readonly status: GameStatus;
  readonly turns: number;
  readonly total: number;
  readonly events: readonly Event[];
  readonly outcome?: Outcome;
  readonly captureSnapshot?: boolean;
}

interface StateFixture {
  readonly version: number;
  readonly status: GameStatus;
  readonly turns: number;
  readonly total: number;
  readonly randomCheckpoint: string;
  readonly outcome?: Outcome;
}

interface ReplayFixture {
  readonly profile: string;
  readonly seed: string;
  readonly definition: { readonly key: string; readonly version: string };
  readonly sessionId: string;
  readonly participant: string;
  readonly target: number;
  readonly actions: readonly ActionFixture[];
  readonly snapshot: StateFixture;
  readonly final: StateFixture;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("../../rust/fixtures/replay-v1.json", import.meta.url),
    "utf8",
  ),
) as ReplayFixture;

const ownership: GameStateOwnership<State, Outcome> = {
  cloneState: (state) => ({ ...state }),
  cloneOutcome: (outcome) => ({ ...outcome }),
};

const rules: GameRules<State, undefined, Event, Outcome, string> = {
  validate: (context: Readonly<ActionContext>, state: Readonly<State>) =>
    context.actor?.toString() === state.participant
      ? acceptAction()
      : rejectAction("NOT_ACTIVE_PARTICIPANT"),
  transition: (
    _context: Readonly<ActionContext>,
    state: Readonly<State>,
    _action: Readonly<undefined>,
    random: RandomSource,
  ) => {
    const value = random.nextIndex(6) + 1;
    const total = Math.min(state.target, state.total + value);
    const next = { ...state, turns: state.turns + 1, total };
    const events = [{ kind: "rolled", value, total }] as const;
    return total === state.target
      ? finishGame(next, events, { winner: state.participant, total })
      : continueGame(next, events);
  },
};

function reference(): GameSessionRef {
  return GameSessionRef.create(
    GameDefinitionRef.create(fixture.definition.key, fixture.definition.version),
    fixture.sessionId,
  );
}

function initialState(): State {
  return {
    participant: fixture.participant,
    target: fixture.target,
    turns: 0,
    total: 0,
  };
}

function action(vector: ActionFixture): GameAction<undefined> {
  return new GameAction(
    GameVersion.from(vector.expectedVersion),
    ParticipantId.parse(vector.actor),
    undefined,
  );
}

function errorCode(error: unknown): string {
  if (!(error instanceof GameExecutionError)) throw error;
  return error.sessionError?.code ?? String(error.rejection);
}

function requiredAction(index: number): ActionFixture {
  const vector = fixture.actions[index];
  if (vector === undefined) throw new Error(`missing fixture action ${String(index)}`);
  return vector;
}

function assertSession(
  session: GameSession<State, Outcome>,
  expected: Pick<StateFixture, "version" | "status" | "turns" | "total" | "outcome">,
): void {
  expect(session.version.value).toBe(expected.version);
  expect(session.status).toBe(expected.status);
  expect(session.state).toMatchObject({ turns: expected.turns, total: expected.total });
  expect(session.outcome).toEqual(expected.outcome);
}

describe("cross-language lifecycle replay conformance", () => {
  it("pins actions, failures, events, snapshots, outcomes, and random checkpoints", () => {
    expect(fixture.profile).toBe("game-core-replay-v1");
    const seed = RandomSeed.from(BigInt(fixture.seed));
    const random = new SeededRandom(seed);
    const session = GameSession.create<State, Outcome>(
      reference(),
      initialState(),
      ownership,
    );
    session.start(GameVersion.ZERO);
    let captured:
      | { readonly snapshot: GameSnapshot<State, Outcome>; readonly checkpoint: bigint }
      | undefined;

    for (const vector of fixture.actions) {
      const checkpoint = random.checkpoint();
      if (vector.accepted) {
        const applied = session.apply(rules, action(vector), random);
        expect(applied.events).toEqual(vector.events);
      } else {
        let actualError: unknown;
        try {
          session.apply(rules, action(vector), random);
        } catch (error: unknown) {
          actualError = error;
        }
        expect(errorCode(actualError)).toBe(vector.error);
        expect(random.checkpoint()).toBe(checkpoint);
      }
      assertSession(session, vector);
      if (vector.captureSnapshot === true) {
        captured = { snapshot: session.snapshot(), checkpoint: random.checkpoint() };
      }
    }

    if (captured === undefined) throw new Error("fixture did not capture a snapshot");
    expect(captured.snapshot.version.value).toBe(fixture.snapshot.version);
    expect(captured.snapshot.status).toBe(fixture.snapshot.status);
    expect(captured.snapshot.state).toMatchObject({
      turns: fixture.snapshot.turns,
      total: fixture.snapshot.total,
    });
    expect(captured.checkpoint.toString()).toBe(fixture.snapshot.randomCheckpoint);
    assertSession(session, fixture.final);
    expect(random.checkpoint().toString()).toBe(fixture.final.randomCheckpoint);

    const replayRandom = new SeededRandom(seed);
    const replayed = replay(
      reference(),
      initialState(),
      ownership,
      rules,
      fixture.actions.filter((vector) => vector.accepted).map(action),
      replayRandom,
    );
    expect(replayed.session.snapshot()).toEqual(session.snapshot());
    expect(replayed.transitions.flatMap((transition) => transition.events)).toEqual(
      fixture.actions.flatMap((vector) => vector.events),
    );

    const continuationRandom = new SeededRandom(seed);
    continuationRandom.restore(captured.checkpoint);
    const continued = replayFromSnapshot(
      captured.snapshot,
      ownership,
      rules,
      [action(requiredAction(5))],
      continuationRandom,
    );
    expect(continued.session.snapshot()).toEqual(session.snapshot());
    expect(continuationRandom.checkpoint()).toBe(random.checkpoint());
  });

  it("stops malformed history without consuming randomness", () => {
    const random = new SeededRandom(RandomSeed.from(BigInt(fixture.seed)));
    const checkpoint = random.checkpoint();
    expect(() =>
      replay(
        reference(),
        initialState(),
        ownership,
        rules,
        [action(requiredAction(3))],
        random,
      ),
    ).toThrow(GameExecutionError);
    expect(random.checkpoint()).toBe(checkpoint);
  });
});
