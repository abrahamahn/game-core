import {
  acceptAction,
  continueGame,
  finishGame,
  GameAction,
  GameDefinitionKey,
  GameDefinitionRef,
  GameExecutionError,
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
  type GameTransition,
  type RandomSource,
  type RuleValidation,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';

interface State {
  readonly roster: ParticipantRoster;
  readonly turns: number;
  readonly total: number;
}

interface Action {
  readonly kind: 'roll';
}

interface Event {
  readonly kind: 'rolled';
  readonly value: number;
}

interface Outcome {
  readonly winner: string;
  readonly total: number;
}

type Rejection = { readonly code: 'MISSING_ACTOR' | 'INACTIVE_ACTOR' };

class Rules implements GameRules<State, Action, Event, Outcome, Rejection> {
  public validate(
    context: Readonly<ActionContext>,
    state: Readonly<State>,
    _action: Readonly<Action>,
  ): RuleValidation<Rejection> {
    if (context.actor === undefined) {
      return { accepted: false, rejection: { code: 'MISSING_ACTOR' } };
    }
    if (!state.roster.isActive(context.actor)) {
      return { accepted: false, rejection: { code: 'INACTIVE_ACTOR' } };
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
    const events = [{ kind: 'rolled', value }] as const;
    return next.turns === 2
      ? finishGame(next, events, {
          winner: context.actor?.toString() ?? '',
          total: next.total,
        })
      : continueGame(next, events);
  }
}

function reference(): GameSessionRef {
  return GameSessionRef.create(GameDefinitionRef.create('example.roll', 'rules-v1'), 'session-1');
}

function fixture(): {
  readonly state: State;
  readonly participant: ParticipantId;
} {
  const participant = ParticipantId.parse('participant-a');
  const roster = new ParticipantRoster();
  roster.join(participant);
  return { state: { roster, turns: 0, total: 0 }, participant };
}

describe('identity and participant lifecycle', () => {
  it('validates canonical identifiers', () => {
    expect(GameDefinitionKey.parse('board.strategy.standard').toString()).toBe(
      'board.strategy.standard',
    );
    expect(() => GameDefinitionKey.parse('Board/Strategy')).toThrowError(
      expect.objectContaining({ code: 'GAME_INVALID_DEFINITION_KEY' }),
    );
  });

  it('preserves a participant after leaving and rejects impossible transitions', () => {
    const participant = ParticipantId.parse('participant-a');
    const roster = new ParticipantRoster();
    roster.join(participant);
    expect(roster.isActive(participant)).toBe(true);
    expect(() => roster.join(participant)).toThrowError(ParticipantError);
    roster.leave(participant);
    expect(roster.get(participant)?.status).toBe('left');
    expect(() => roster.leave(participant)).toThrowError(
      expect.objectContaining({ code: 'GAME_PARTICIPANT_ALREADY_LEFT' }),
    );
    expect(
      () => new ParticipantRoster([roster.get(participant)!, roster.get(participant)!]),
    ).toThrow(expect.objectContaining({ code: 'GAME_PARTICIPANT_ALREADY_EXISTS' }));
  });
});

describe('authoritative execution', () => {
  it('applies valid actions, emits events, versions state, and finishes once', () => {
    const { state, participant } = fixture();
    const session = GameSession.create<State, Outcome>(reference(), state);
    expect(session.start(GameVersion.ZERO).value).toBe(1);
    const random = new SeededRandom(RandomSeed.from(42));
    const first = session.apply(
      new Rules(),
      new GameAction(GameVersion.from(1), participant, { kind: 'roll' }),
      random,
    );
    const second = session.apply(
      new Rules(),
      new GameAction(GameVersion.from(2), participant, { kind: 'roll' }),
      random,
    );

    expect(first.events).toHaveLength(1);
    expect(second.status).toBe('finished');
    expect(session.version.value).toBe(3);
    expect(session.outcome?.winner).toBe('participant-a');
    expect(() =>
      session.apply(
        new Rules(),
        new GameAction(GameVersion.from(3), participant, { kind: 'roll' }),
        random,
      ),
    ).toThrowError(
      expect.objectContaining({
        sessionError: expect.objectContaining({
          code: 'GAME_INVALID_LIFECYCLE_TRANSITION',
        }),
      }),
    );
  });

  it('rejects stale and illegal actions without mutating state or consuming randomness', () => {
    const { state } = fixture();
    const session = GameSession.create<State, Outcome>(reference(), state);
    session.start(GameVersion.ZERO);
    const random = new SeededRandom(RandomSeed.from(8));
    const pristine = new SeededRandom(RandomSeed.from(8));

    expect(() =>
      session.apply(
        new Rules(),
        new GameAction(GameVersion.ZERO, undefined, { kind: 'roll' }),
        random,
      ),
    ).toThrowError(GameExecutionError);
    expect(() =>
      session.apply(
        new Rules(),
        new GameAction(GameVersion.from(1), undefined, { kind: 'roll' }),
        random,
      ),
    ).toThrowError(expect.objectContaining({ rejection: { code: 'MISSING_ACTOR' } }));
    expect(session.state.turns).toBe(0);
    expect(random.nextU64()).toBe(pristine.nextU64());
  });

  it('rejects snapshots with impossible lifecycle facts', () => {
    const { state } = fixture();
    expect(() =>
      GameSnapshot.create(reference(), GameVersion.from(7), 'created', state, undefined),
    ).toThrowError(SessionError);
  });
});

describe('deterministic randomness and replay', () => {
  it('pins the seeded algorithm and cross-language stream', () => {
    expect(SEEDED_RANDOM_ALGORITHM).toBe('splitmix64-v1');
    const random = new SeededRandom(RandomSeed.from(0));
    expect(random.nextU64()).toBe(0xe220_a839_7b1d_cdafn);
    expect(random.nextU64()).toBe(0x6e78_9e6a_a1b9_65f4n);
    expect(random.nextU64()).toBe(0x06c4_5d18_8009_454fn);
    expect(() => random.nextIndex(0)).toThrowError(
      expect.objectContaining({ code: 'GAME_RANDOM_EMPTY_RANGE' }),
    );
    expect(() => RandomSeed.from(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('reconstructs identical state, outcomes, and events and continues snapshots', () => {
    const { state, participant } = fixture();
    const actions = [
      new GameAction(GameVersion.from(1), participant, {
        kind: 'roll',
      } as const),
      new GameAction(GameVersion.from(2), participant, {
        kind: 'roll',
      } as const),
    ];
    const first = replay(
      reference(),
      state,
      new Rules(),
      actions,
      new SeededRandom(RandomSeed.from(19)),
    );
    const secondFixture = fixture();
    const second = replay(
      reference(),
      secondFixture.state,
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
      new Rules(),
      actions.slice(0, 1),
      random,
    );
    const snapshot = one.session.snapshot((value) => ({
      ...value,
      roster: value.roster.clone(),
    }));
    const restored = replayFromSnapshot(snapshot, new Rules(), actions.slice(1), random);
    expect(restored.session.status).toBe('finished');
    expect(restored.session.version.value).toBe(3);
  });
});
