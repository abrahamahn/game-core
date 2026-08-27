# game-core

`game-core` provides deterministic, authoritative game-session primitives in two independent
language packages:

- [`rust/`](./rust) — the `game-core` Rust crate;
- [`typescript/`](./typescript) — the `@abrahamahn/game-core` TypeScript package.

Both packages implement the same architectural boundary: applications own concrete game state,
actions, events, outcomes, and rules; `game-core` owns generic identity, lifecycle, optimistic
versioning, participant presence, injected seeded randomness, snapshots, and replay.

TypeScript sessions require an application-owned clone strategy so mutable JavaScript references
cannot escape the authoritative aggregate. TypeScript accepted execution also requires
checkpointable randomness, while Rust's infallible transition contract exposes equivalent seeded
stream checkpoints for durable replay adapters.

Neither implementation contains a particular game's rules or depends on an application,
framework, database, transport, cloud, or user interface. Each folder can be copied or checked
out and built without the other implementation.

## Reuse boundary

`game-core` is a mechanics package, not a universal semantic Game bounded context. Adopt a
primitive only where real consumers share its meaning and failure contract. In particular, the
three-state session wrapper is appropriate only for occurrences that genuinely follow that
lifecycle; it must not flatten Blackjack hands, Baccarat shoes/coups, Poker tables/hands, Rooms,
tournaments, settlement, fairness provenance, or presentation into one generic aggregate.

Concrete game domains remain authoritative for their rules profiles, actions, state, results,
corrections, visibility, and history facts. Applications remain authoritative for command
receipts/idempotency, durable deadlines, storage transactions, fairness protocols, value movement,
and transport. This boundary lets Ganbate reuse deterministic mechanics without turning shared
code into a shared semantic owner.

See each package README for its API, example, extension points, and validation commands.
