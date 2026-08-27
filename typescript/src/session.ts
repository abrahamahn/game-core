import type { GameSessionRef } from "./identity.js";
import type { ParticipantId } from "./participant.js";
import type { RandomSource, TransactionalRandomSource } from "./randomness.js";

export type GameStatus = "created" | "active" | "finished";
export type LifecycleOperation = "start" | "apply_action";

export class GameVersion {
  public static readonly ZERO = new GameVersion(0);
  public static readonly MAX_SAFE = new GameVersion(Number.MAX_SAFE_INTEGER);

  private constructor(public readonly value: number) {
    Object.freeze(this);
  }

  public static from(value: number): GameVersion {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError("Game version must be a non-negative safe integer");
    }
    return value === 0 ? GameVersion.ZERO : new GameVersion(value);
  }

  public equals(other: GameVersion): boolean {
    return this.value === other.value;
  }

  public next(): GameVersion {
    if (this.equals(GameVersion.MAX_SAFE)) {
      throw new SessionError("GAME_VERSION_EXHAUSTED");
    }
    return GameVersion.from(this.value + 1);
  }
}

export class GameAction<Action> {
  public constructor(
    public readonly expectedVersion: GameVersion,
    public readonly actor: ParticipantId | undefined,
    public readonly payload: Action,
  ) {
    Object.freeze(this);
  }
}

export interface ActionContext {
  readonly session: GameSessionRef;
  readonly actor: ParticipantId | undefined;
  readonly version: GameVersion;
}

export interface ActionRejection<Code extends string = string> {
  readonly code: Code;
  readonly message?: string;
}

export type RuleValidation<Rejection> =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly rejection: Rejection };

export function acceptAction(): RuleValidation<never> {
  return { accepted: true };
}

export function rejectAction<Rejection>(
  rejection: Rejection,
): RuleValidation<Rejection> {
  return { accepted: false, rejection };
}

export type GameTransition<State, Event, Outcome> =
  | {
      readonly kind: "continue";
      readonly state: State;
      readonly events: readonly Event[];
    }
  | {
      readonly kind: "finish";
      readonly state: State;
      readonly events: readonly Event[];
      readonly outcome: Outcome;
    };

export function continueGame<State, Event, Outcome = never>(
  state: State,
  events: readonly Event[],
): GameTransition<State, Event, Outcome> {
  return { kind: "continue", state, events };
}

export function finishGame<State, Event, Outcome>(
  state: State,
  events: readonly Event[],
  outcome: Outcome,
): GameTransition<State, Event, Outcome> {
  return { kind: "finish", state, events, outcome };
}

export interface GameRules<State, Action, Event, Outcome, Rejection> {
  validate(
    context: Readonly<ActionContext>,
    state: Readonly<State>,
    action: Readonly<Action>,
  ): RuleValidation<Rejection>;
  transition(
    context: Readonly<ActionContext>,
    state: Readonly<State>,
    action: Readonly<Action>,
    random: RandomSource,
  ): GameTransition<State, Event, Outcome>;
}

/** Defines how a session takes exclusive ownership of application-defined state and outcomes. */
export interface GameStateOwnership<State, Outcome> {
  cloneState(state: Readonly<State>): State;
  cloneOutcome(outcome: Readonly<Outcome>): Outcome;
}

export interface AppliedTransition<Event> {
  readonly priorVersion: GameVersion;
  readonly nextVersion: GameVersion;
  readonly status: GameStatus;
  readonly events: readonly Event[];
}

export class GameSession<State, Outcome> {
  readonly #reference: GameSessionRef;
  #version: GameVersion;
  #status: GameStatus;
  #state: State;
  #outcome: Outcome | undefined;
  readonly #ownership: GameStateOwnership<State, Outcome>;

  private constructor(
    reference: GameSessionRef,
    version: GameVersion,
    status: GameStatus,
    state: State,
    outcome: Outcome | undefined,
    ownership: GameStateOwnership<State, Outcome>,
  ) {
    this.#reference = reference;
    this.#version = version;
    this.#status = status;
    this.#ownership = ownership;
    this.#state = ownership.cloneState(state);
    this.#outcome =
      outcome === undefined ? undefined : ownership.cloneOutcome(outcome);
  }

  public static create<State, Outcome = never>(
    reference: GameSessionRef,
    initialState: State,
    ownership: GameStateOwnership<State, Outcome>,
  ): GameSession<State, Outcome> {
    return new GameSession<State, Outcome>(
      reference,
      GameVersion.ZERO,
      "created",
      initialState,
      undefined,
      ownership,
    );
  }

  public static restore<State, Outcome>(
    snapshot: GameSnapshot<State, Outcome>,
    ownership: GameStateOwnership<State, Outcome>,
  ): GameSession<State, Outcome> {
    snapshot.validate();
    return new GameSession(
      snapshot.reference,
      snapshot.version,
      snapshot.status,
      snapshot.state,
      snapshot.outcome,
      ownership,
    );
  }

  public get version(): GameVersion {
    return this.#version;
  }

  public get reference(): GameSessionRef {
    return this.#reference;
  }

  public get status(): GameStatus {
    return this.#status;
  }

  public get state(): Readonly<State> {
    return this.#ownership.cloneState(this.#state);
  }

  public get outcome(): Readonly<Outcome> | undefined {
    return this.#outcome === undefined
      ? undefined
      : this.#ownership.cloneOutcome(this.#outcome);
  }

  public start(expectedVersion: GameVersion): GameVersion {
    this.ensureVersion(expectedVersion);
    if (this.#status !== "created") {
      throw SessionError.invalidLifecycle(this.#status, "start");
    }
    const nextVersion = this.#version.next();
    this.#version = nextVersion;
    this.#status = "active";
    return nextVersion;
  }

  public apply<Action, Event, Rejection, Checkpoint>(
    rules: GameRules<State, Action, Event, Outcome, Rejection>,
    action: GameAction<Action>,
    random: TransactionalRandomSource<Checkpoint>,
  ): AppliedTransition<Event> {
    try {
      this.ensureVersion(action.expectedVersion);
      if (this.#status !== "active") {
        throw SessionError.invalidLifecycle(this.#status, "apply_action");
      }
      const nextVersion = this.#version.next();
      const context: ActionContext = {
        session: this.reference,
        actor: action.actor,
        version: this.#version,
      };
      const validation = rules.validate(
        context,
        this.#ownership.cloneState(this.#state),
        action.payload,
      );
      if (!validation.accepted) {
        throw GameExecutionError.rejected(validation.rejection);
      }
      const checkpoint = random.checkpoint();
      let transition: GameTransition<State, Event, Outcome>;
      let ownedState: State;
      let ownedOutcome: Outcome | undefined;
      try {
        transition = rules.transition(
          context,
          this.#ownership.cloneState(this.#state),
          action.payload,
          random,
        );
        ownedState = this.#ownership.cloneState(transition.state);
        ownedOutcome =
          transition.kind === "finish"
            ? this.#ownership.cloneOutcome(transition.outcome)
            : undefined;
      } catch (error: unknown) {
        random.restore(checkpoint);
        throw error;
      }
      const priorVersion = this.#version;
      this.#state = ownedState;
      this.#version = nextVersion;
      if (transition.kind === "finish") {
        this.#outcome = ownedOutcome;
        this.#status = "finished";
      }
      return Object.freeze({
        priorVersion,
        nextVersion,
        status: this.#status,
        events: Object.freeze([...transition.events]),
      });
    } catch (error: unknown) {
      if (error instanceof GameExecutionError) throw error;
      if (error instanceof SessionError)
        throw GameExecutionError.session(error);
      throw error;
    }
  }

  public snapshot(): GameSnapshot<State, Outcome> {
    return GameSnapshot.create(
      this.reference,
      this.#version,
      this.#status,
      this.#ownership.cloneState(this.#state),
      this.#outcome === undefined
        ? undefined
        : this.#ownership.cloneOutcome(this.#outcome),
    );
  }

  private ensureVersion(expected: GameVersion): void {
    if (!expected.equals(this.#version)) {
      throw SessionError.versionConflict(expected, this.#version);
    }
  }
}

export class GameSnapshot<State, Outcome> {
  private constructor(
    public readonly reference: GameSessionRef,
    public readonly version: GameVersion,
    public readonly status: GameStatus,
    public readonly state: State,
    public readonly outcome: Outcome | undefined,
  ) {
    Object.freeze(this);
  }

  public static create<State, Outcome>(
    reference: GameSessionRef,
    version: GameVersion,
    status: GameStatus,
    state: State,
    outcome: Outcome | undefined,
  ): GameSnapshot<State, Outcome> {
    const snapshot = new GameSnapshot(
      reference,
      version,
      status,
      state,
      outcome,
    );
    snapshot.validate();
    return snapshot;
  }

  public validate(): void {
    const valid =
      (this.status === "created" &&
        this.version.value === 0 &&
        this.outcome === undefined) ||
      (this.status === "active" &&
        this.version.value > 0 &&
        this.outcome === undefined) ||
      (this.status === "finished" &&
        this.version.value > 1 &&
        this.outcome !== undefined);
    if (!valid) throw new SessionError("GAME_INVALID_SNAPSHOT");
  }
}

export type SessionErrorCode =
  | "GAME_VERSION_CONFLICT"
  | "GAME_INVALID_LIFECYCLE_TRANSITION"
  | "GAME_VERSION_EXHAUSTED"
  | "GAME_INVALID_SNAPSHOT";

export class SessionError extends Error {
  public override readonly name = "SessionError";

  public constructor(
    public readonly code: SessionErrorCode,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
  }

  public static versionConflict(
    expected: GameVersion,
    actual: GameVersion,
  ): SessionError {
    return new SessionError("GAME_VERSION_CONFLICT", {
      expected: expected.value,
      actual: actual.value,
    });
  }

  public static invalidLifecycle(
    status: GameStatus,
    operation: LifecycleOperation,
  ): SessionError {
    return new SessionError("GAME_INVALID_LIFECYCLE_TRANSITION", {
      status,
      operation,
    });
  }
}

export class GameExecutionError<Rejection> extends Error {
  public override readonly name = "GameExecutionError";

  private constructor(
    public readonly sessionError: SessionError | undefined,
    public readonly rejection: Rejection | undefined,
  ) {
    super(sessionError?.code ?? "GAME_ACTION_REJECTED");
  }

  public static session(error: SessionError): GameExecutionError<never> {
    return new GameExecutionError<never>(error, undefined);
  }

  public static rejected<Rejection>(
    rejection: Rejection,
  ): GameExecutionError<Rejection> {
    return new GameExecutionError(undefined, rejection);
  }
}
