import {
  acceptAction,
  continueGame,
  finishGame,
  GameAction,
  GameDefinitionKey,
  GameDefinitionRef,
  GameExecutionError,
  GameResultRef,
  GameSession,
  GameSessionRef,
  GameSnapshot,
  GameVersion,
  ParticipantError,
  ParticipantId,
  ParticipantRoster,
  RandomSeed,
  SEEDED_RANDOM_ALGORITHM,
  SeededRandom,
  SessionError,
  replay,
  replayFromSnapshot,
  type ActionContext,
  type GameRules,
  type GameStateOwnership,
  type GameTransition,
  type RandomSource,
  type RuleValidation,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

interface State {
  readonly roster: ParticipantRoster;
  readonly turns: number;
  readonly total: number;
}

interface Action {
  readonly kind: "roll";
}

interface Event {
  readonly kind: "rolled";
  readonly value: number;
}

interface Outcome {
  readonly winner: string;
  readonly total: number;
}

interface Rejection {
  readonly code: "MISSING_ACTOR" | "INACTIVE_ACTOR";
}

class Rules implements GameRules<State, Action, Event, Outcome, Rejection> {
  public validate(
    context: Readonly<ActionContext>,
    state: Readonly<State>,
  ): RuleValidation<Rejection> {
    if (context.actor === undefined) {
      return { accepted: false, rejection: { code: "MISSING_ACTOR" } };
    }
    if (!state.roster.isActive(context.actor)) {
      return { accepted: false, rejection: { code: "INACTIVE_ACTOR" } };
    }
    return acceptAction();
  }

  public transition(
    context: Readonly<ActionContext>,
    state: Readonly<State>,
    _action: Readonly<Action>,
    random: RandomSource,
  ): GameTransition<State, Event, Outcome> {
    const value = random.nextIndex(6) + 1;
    const next: State = {
      roster: state.roster.clone(),
      turns: state.turns + 1,
      total: state.total + value,
    };
    const events = [{ kind: "rolled", value }] as const;
    return next.turns === 2
      ? finishGame(next, events, {
          winner: context.actor?.toString() ?? "",
          total: next.total,
        })
      : continueGame(next, events);
  }
}

class MutatingRejectRules
  implements GameRules<State, Action, Event, Outcome, Rejection>
{
  public validate(
    _context: Readonly<ActionContext>,
    state: Readonly<State>,
  ): RuleValidation<Rejection> {
    (state as { turns: number }).turns = 99;
    return { accepted: false, rejection: { code: "MISSING_ACTOR" } };
  }

  public transition(): GameTransition<State, Event, Outcome> {
    throw new Error("rejected actions never transition");
  }
}

class ThrowAfterRandomRules
  implements GameRules<State, Action, Event, Outcome, Rejection>
{
  public validate(): RuleValidation<Rejection> {
    return acceptAction();
  }

  public transition(
    _context: Readonly<ActionContext>,
    _state: Readonly<State>,
    _action: Readonly<Action>,
    random: RandomSource,
  ): GameTransition<State, Event, Outcome> {
    random.nextU64();
    throw new Error("rule implementation failed after consuming randomness");
  }
}

function reference(): GameSessionRef {
  return GameSessionRef.create(
    GameDefinitionRef.create("example.roll", "rules-v1"),
    "session-1",
  );
}

function fixture(): {
  readonly state: State;
  readonly participant: ParticipantId;
} {
  const participant = ParticipantId.parse("participant-a");
  const roster = new ParticipantRoster();
  roster.join(participant);
  return { state: { roster, turns: 0, total: 0 }, participant };
}

const stateOwnership: GameStateOwnership<State, Outcome> = {
  cloneState: (state) => ({
    roster: state.roster.clone(),
    turns: state.turns,
    total: state.total,
  }),
  cloneOutcome: (outcome) => ({ ...outcome }),
};

describe("identity and participant lifecycle", () => {
  it("validates canonical identifiers", () => {
    expect(GameDefinitionKey.parse("board.strategy.standard").toString()).toBe(
      "board.strategy.standard",
    );
    expect(() => GameDefinitionKey.parse("Board/Strategy")).toThrow(
      expect.objectContaining({ code: "GAME_INVALID_DEFINITION_KEY" }),
    );

    const unicodeReference = GameSessionRef.create(
      GameDefinitionRef.create("board.strategy", "v1"),
      "🂡".repeat(160),
    );
    expect(Array.from(unicodeReference.sessionId.toString())).toHaveLength(160);
    expect(() =>
      GameSessionRef.create(
        GameDefinitionRef.create("board.strategy", "v1"),
        "🂡".repeat(161),
      ),
    ).toThrow(expect.objectContaining({ code: "GAME_INVALID_SESSION_ID" }));
    expect(() =>
      GameSessionRef.create(
        GameDefinitionRef.create("board.strategy", "v1"),
        "session\u0085control",
      ),
    ).toThrow(expect.objectContaining({ code: "GAME_INVALID_SESSION_ID" }));

    expect(
      GameResultRef.create(reference(), "result-1", Number.MAX_SAFE_INTEGER)
        .version,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(() =>
      GameResultRef.create(
        reference(),
        "result-1",
        Number.MAX_SAFE_INTEGER + 1,
      ),
    ).toThrow(
      expect.objectContaining({ code: "GAME_INVALID_RESULT_VERSION" }),
    );
  });

  it("preserves a participant after leaving and rejects impossible transitions", () => {
    const participant = ParticipantId.parse("participant-a");
    const roster = new ParticipantRoster();
    roster.join(participant);
    expect(roster.isActive(participant)).toBe(true);
    expect(() => {
      roster.join(participant);
    }).toThrow(ParticipantError);
    roster.leave(participant);
    expect(roster.get(participant)?.status).toBe("left");
    expect(() => {
      roster.leave(participant);
    }).toThrow(
      expect.objectContaining({ code: "GAME_PARTICIPANT_ALREADY_LEFT" }),
    );
    const existing = roster.get(participant);
    if (existing === undefined) throw new Error("expected participant");
    expect(() => new ParticipantRoster([existing, existing])).toThrow(
      expect.objectContaining({ code: "GAME_PARTICIPANT_ALREADY_EXISTS" }),
    );
    expect(ParticipantId.parse("🂡".repeat(160)).toString()).toBe(
      "🂡".repeat(160),
    );
    expect(() => ParticipantId.parse("🂡".repeat(161))).toThrow(
      expect.objectContaining({ code: "GAME_INVALID_PARTICIPANT_ID" }),
    );
    expect(() => ParticipantId.parse("participant\u0085control")).toThrow(
      expect.objectContaining({ code: "GAME_INVALID_PARTICIPANT_ID" }),
    );
  });
});

describe("authoritative execution", () => {
  it("applies valid actions, emits events, versions state, and finishes once", () => {
    const { state, participant } = fixture();
    const session = GameSession.create<State, Outcome>(
      reference(),
      state,
      stateOwnership,
    );
    expect(session.start(GameVersion.ZERO).value).toBe(1);
    const random = new SeededRandom(RandomSeed.from(42));
    const first = session.apply(
      new Rules(),
      new GameAction(GameVersion.from(1), participant, { kind: "roll" }),
      random,
    );
    const second = session.apply(
      new Rules(),
      new GameAction(GameVersion.from(2), participant, { kind: "roll" }),
      random,
    );

    expect(first.events).toHaveLength(1);
    expect(second.status).toBe("finished");
    expect(session.version.value).toBe(3);
    expect(session.outcome?.winner).toBe("participant-a");
    let failure: unknown;
    try {
      session.apply(
        new Rules(),
        new GameAction(GameVersion.from(3), participant, { kind: "roll" }),
        random,
      );
    } catch (error: unknown) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GameExecutionError);
    if (!(failure instanceof GameExecutionError))
      throw new Error("expected execution error");
    expect(failure.sessionError?.code).toBe(
      "GAME_INVALID_LIFECYCLE_TRANSITION",
    );
  });

  it("rejects stale and illegal actions without mutating state or consuming randomness", () => {
    const { state } = fixture();
    const session = GameSession.create<State, Outcome>(
      reference(),
      state,
      stateOwnership,
    );
    session.start(GameVersion.ZERO);
    const random = new SeededRandom(RandomSeed.from(8));
    const pristine = new SeededRandom(RandomSeed.from(8));

    expect(() =>
      session.apply(
        new Rules(),
        new GameAction(GameVersion.ZERO, undefined, { kind: "roll" }),
        random,
      ),
    ).toThrow(GameExecutionError);
    expect(() =>
      session.apply(
        new Rules(),
        new GameAction(GameVersion.from(1), undefined, { kind: "roll" }),
        random,
      ),
    ).toThrow(
      expect.objectContaining({ rejection: { code: "MISSING_ACTOR" } }),
    );
    expect(session.state.turns).toBe(0);
    expect(random.nextU64()).toBe(pristine.nextU64());
  });

  it("rejects snapshots with impossible lifecycle facts", () => {
    const { state } = fixture();
    expect(() =>
      GameSnapshot.create(
        reference(),
        GameVersion.from(7),
        "created",
        state,
        undefined,
      ),
    ).toThrow(SessionError);
    expect(() => GameVersion.MAX_SAFE.next()).toThrow(
      expect.objectContaining({ code: "GAME_VERSION_EXHAUSTED" }),
    );
  });

  it("owns state across caller, getter, and rejecting-validator mutations", () => {
    const { state, participant } = fixture();
    const session = GameSession.create<State, Outcome>(
      reference(),
      state,
      stateOwnership,
    );
    expect(Object.isFrozen(session.reference)).toBe(true);
    expect(Object.isFrozen(session.version)).toBe(true);
    expect(Reflect.set(session, "reference", reference())).toBe(false);
    const rosterParticipant = state.roster.get(participant);
    if (rosterParticipant === undefined) throw new Error("expected participant");
    expect(Object.isFrozen(rosterParticipant)).toBe(true);
    expect(Reflect.set(rosterParticipant, "status", "left")).toBe(false);
    expect(Reflect.set(session.version, "value", 99)).toBe(false);
    expect(session.version.value).toBe(0);
    (state as { turns: number }).turns = 40;
    const exposed = session.state;
    (exposed as { turns: number }).turns = 50;
    expect(session.state.turns).toBe(0);

    session.start(GameVersion.ZERO);
    expect(() =>
      session.apply(
        new MutatingRejectRules(),
        new GameAction(GameVersion.from(1), participant, { kind: "roll" }),
        new SeededRandom(RandomSeed.from(1)),
      ),
    ).toThrow(GameExecutionError);
    expect(session.state.turns).toBe(0);
  });

  it("restores checkpointable randomness when transition execution throws", () => {
    const { state, participant } = fixture();
    const session = GameSession.create<State, Outcome>(
      reference(),
      state,
      stateOwnership,
    );
    session.start(GameVersion.ZERO);
    const random = new SeededRandom(RandomSeed.from(77));
    const pristine = new SeededRandom(RandomSeed.from(77));

    expect(() =>
      session.apply(
        new ThrowAfterRandomRules(),
        new GameAction(GameVersion.from(1), participant, { kind: "roll" }),
        random,
      ),
    ).toThrow(/failed after consuming randomness/u);
    expect(session.version.value).toBe(1);
    expect(session.state.turns).toBe(0);
    expect(random.nextU64()).toBe(pristine.nextU64());
  });
});

describe("deterministic randomness and replay", () => {
  it("pins the seeded algorithm and cross-language stream", () => {
    expect(SEEDED_RANDOM_ALGORITHM).toBe("splitmix64-v1");
    const random = new SeededRandom(RandomSeed.from(0));
    expect(random.nextU64()).toBe(0xe220_a839_7b1d_cdafn);
    expect(random.nextU64()).toBe(0x6e78_9e6a_a1b9_65f4n);
    expect(random.nextU64()).toBe(0x06c4_5d18_8009_454fn);
    expect(() => random.nextIndex(0)).toThrow(
      expect.objectContaining({ code: "GAME_RANDOM_EMPTY_RANGE" }),
    );
    expect(() => RandomSeed.from(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );

    const source = new SeededRandom(RandomSeed.from(91));
    source.nextU64();
    const checkpoint = source.checkpoint();
    const restored = new SeededRandom(RandomSeed.from(0));
    restored.restore(checkpoint);
    expect(restored.nextU64()).toBe(source.nextU64());
    expect(() => {
      restored.restore(1 as unknown as bigint);
    }).toThrow(RangeError);
  });

  it("reconstructs identical state, outcomes, and events and continues snapshots", () => {
    const { state, participant } = fixture();
    const actions = [
      new GameAction(GameVersion.from(1), participant, {
        kind: "roll",
      } as const),
      new GameAction(GameVersion.from(2), participant, {
        kind: "roll",
      } as const),
    ];
    const first = replay(
      reference(),
      state,
      stateOwnership,
      new Rules(),
      actions,
      new SeededRandom(RandomSeed.from(19)),
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.transitions)).toBe(true);
    expect(Object.isFrozen(first.transitions[0])).toBe(true);
    expect(Object.isFrozen(first.transitions[0]?.events)).toBe(true);
    const secondFixture = fixture();
    const second = replay(
      reference(),
      secondFixture.state,
      stateOwnership,
      new Rules(),
      actions,
      new SeededRandom(RandomSeed.from(19)),
    );
    expect(first.session.state.total).toBe(second.session.state.total);
    expect(first.transitions).toEqual(second.transitions);

    const oneActionFixture = fixture();
    const random = new SeededRandom(RandomSeed.from(19));
    const one = replay(
      reference(),
      oneActionFixture.state,
      stateOwnership,
      new Rules(),
      actions.slice(0, 1),
      random,
    );
    const snapshot = one.session.snapshot();
    const restored = replayFromSnapshot(
      snapshot,
      stateOwnership,
      new Rules(),
      actions.slice(1),
      random,
    );
    expect(restored.session.status).toBe("finished");
    expect(restored.session.version.value).toBe(3);
  });
});
