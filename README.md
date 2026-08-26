# game-core

`game-core` provides deterministic, authoritative game-session primitives in two independent
language packages:

- [`rust/`](./rust) — the `game-core` Rust crate;
- [`typescript/`](./typescript) — the `@abrahamahn/game-core` TypeScript package.

Both packages implement the same architectural boundary: applications own concrete game state,
actions, events, outcomes, and rules; `game-core` owns generic identity, lifecycle, optimistic
versioning, participant presence, injected seeded randomness, snapshots, and replay.

Neither implementation contains a particular game's rules or depends on an application,
framework, database, transport, cloud, or user interface. Each folder can be copied or checked
out and built without the other implementation.

See each package README for its API, example, extension points, and validation commands.
