# @abrahamahn/game-core

The TypeScript implementation of `game-core` provides deterministic, authoritative game-session
primitives without prescribing a concrete game, server, database, protocol, or UI.

It owns validated identities, a strict session lifecycle, optimistic versions, generic participant
presence, the `GameRules` execution boundary, ordered events, terminal outcomes, injected seeded
randomness, snapshots, restoration, and replay. Concrete turns, rounds, phases, roles, legal moves,
timers, and outcomes belong to application-owned rule types.

## Invariants

- Commands apply only to active sessions at the exact expected version.
- Validation runs before randomness; a rejected action changes neither state nor the random stream.
- Sessions clone application state and outcomes at every ownership boundary; callers and rules do
  not receive mutable references to the authoritative aggregate.
- A transition failure restores checkpointable randomness before propagating the failure.
- An accepted action advances the version exactly once.
- Terminal outcomes permanently finish a session.
- Snapshots reject lifecycle/version/outcome combinations the core could not produce.
- Replay uses the same authoritative path as live execution.
- Seeded randomness is pinned as `splitmix64-v1` and matches the Rust implementation.

## Example

```ts
import {
  acceptAction,
  continueGame,
  finishGame,
  GameAction,
  GameDefinitionRef,
  GameSession,
  GameSessionRef,
  GameVersion,
  RandomSeed,
  SeededRandom,
  type GameRules,
  type GameStateOwnership,
} from '@abrahamahn/game-core';

type State = { readonly count: number };
type Action = { readonly kind: 'increment' };
type Event = { readonly kind: 'advanced' };
type Outcome = { readonly final: number };

const rules: GameRules<State, Action, Event, Outcome, never> = {
  validate: () => acceptAction(),
  transition: (_context, state) => {
    const next = { count: state.count + 1 };
    const events = [{ kind: 'advanced' }] as const;
    return next.count === 3
      ? finishGame(next, events, { final: next.count })
      : continueGame(next, events);
  },
};

const definition = GameDefinitionRef.create('example.counter', '1.0.0');
const reference = GameSessionRef.create(definition, 'session-1');
const ownership: GameStateOwnership<State, Outcome> = {
  cloneState: (state) => ({ ...state }),
  cloneOutcome: (outcome) => ({ ...outcome }),
};
const session = GameSession.create<State, Outcome>(reference, { count: 0 }, ownership);
session.start(GameVersion.ZERO);
session.apply(
  rules,
  new GameAction(GameVersion.from(1), undefined, { kind: 'increment' }),
  new SeededRandom(RandomSeed.from(42)),
);
```

## Integration and extension points

Implement `GameRules` with application-owned types. Provide a `TransactionalRandomSource` and a
`GameStateOwnership` clone strategy, then persist snapshots and accepted actions through adapters
outside this package. Serialization should rebuild through
`GameSnapshot.create` so invalid persisted state fails closed. Storage atomicity, clocks, event
sinks, HTTP, WebSocket, and framework integration stay in the application because their useful
contracts depend on the chosen infrastructure.

When continuing from a snapshot, restore the supplied random stream to the corresponding point.
A seed plus the number/order of prior draws, or an application-owned randomness snapshot, is part
of the replay input; `game-core` never reads a process-global RNG.

There are no runtime dependencies. Dependency direction is always application -> concrete game
domain -> `game-core`.

## Development

Node.js 24.13+ and pnpm 10.26+ are required.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

This folder is independently installable and has no filesystem dependency on another project.
