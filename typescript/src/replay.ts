import { GameSession, GameVersion } from "./session.js";
import type { GameSessionRef } from "./identity.js";
import type { TransactionalRandomSource } from "./randomness.js";
import type {
  AppliedTransition,
  GameAction,
  GameRules,
  GameSnapshot,
  GameStateOwnership,
} from "./session.js";

export class ReplayResult<State, Outcome, Event> {
  public readonly transitions: readonly AppliedTransition<Event>[];

  public constructor(
    public readonly session: GameSession<State, Outcome>,
    transitions: readonly AppliedTransition<Event>[],
  ) {
    this.transitions = Object.freeze([...transitions]);
    Object.freeze(this);
  }
}

export function replay<State, Action, Event, Outcome, Rejection, Checkpoint>(
  reference: GameSessionRef,
  initialState: State,
  ownership: GameStateOwnership<State, Outcome>,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: TransactionalRandomSource<Checkpoint>,
): ReplayResult<State, Outcome, Event> {
  const session = GameSession.create<State, Outcome>(
    reference,
    initialState,
    ownership,
  );
  session.start(GameVersion.ZERO);
  return applyRecordedActions(session, rules, actions, random);
}

export function replayFromSnapshot<
  State,
  Action,
  Event,
  Outcome,
  Rejection,
  Checkpoint,
>(
  snapshot: GameSnapshot<State, Outcome>,
  ownership: GameStateOwnership<State, Outcome>,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: TransactionalRandomSource<Checkpoint>,
): ReplayResult<State, Outcome, Event> {
  return applyRecordedActions(
    GameSession.restore(snapshot, ownership),
    rules,
    actions,
    random,
  );
}

function applyRecordedActions<
  State,
  Action,
  Event,
  Outcome,
  Rejection,
  Checkpoint,
>(
  session: GameSession<State, Outcome>,
  rules: GameRules<State, Action, Event, Outcome, Rejection>,
  actions: Iterable<GameAction<Action>>,
  random: TransactionalRandomSource<Checkpoint>,
): ReplayResult<State, Outcome, Event> {
  const transitions: AppliedTransition<Event>[] = [];
  for (const action of actions) {
    transitions.push(session.apply(rules, action, random));
  }
  return new ReplayResult(session, transitions);
}
