import { GameSession, GameVersion } from './session.js';
import type { GameSessionRef } from './identity.js';
import type { RandomSource } from './randomness.js';
import type { AppliedTransition, GameAction, GameRules, GameSnapshot } from './session.js';

export class ReplayResult<State, Outcome, Event> {
  public constructor(
    public readonly session: GameSession<State, Outcome>,
    public readonly transitions: readonly AppliedTransition<Event>[],
  ) {}
}

export function replay<State, Action, Event, Outcome, Rejection>(
  reference: GameSessionRef,
  initialState: State,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: RandomSource,
): ReplayResult<State, Outcome, Event> {
  const session = GameSession.create<State, Outcome>(reference, initialState);
  session.start(GameVersion.ZERO);
  return applyRecordedActions(session, rules, actions, random);
}

export function replayFromSnapshot<State, Action, Event, Outcome, Rejection>(
  snapshot: GameSnapshot<State, Outcome>,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: RandomSource,
): ReplayResult<State, Outcome, Event> {
  return applyRecordedActions(GameSession.restore(snapshot), rules, actions, random);
}

function applyRecordedActions<State, Action, Event, Outcome, Rejection>(
  session: GameSession<State, Outcome>,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: RandomSource,
): ReplayResult<State, Outcome, Event> {
  const transitions: AppliedTransition<Event>[] = [];
  for (const action of actions) {
    transitions.push(session.apply(rules, action, random));
  }
  return new ReplayResult(session, transitions);
}
