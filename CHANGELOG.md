# Changelog

## 0.3.0

- Make TypeScript identity, version, action, participant, transition, snapshot, and replay wrappers
  immutable at runtime, and keep the authoritative session reference behind a private field.
- Align opaque identity length/control validation and result/session version bounds across Rust and
  TypeScript.
- Allow Rust adapters to reconstruct a persisted `RandomCheckpoint` for exact replay continuation.
- Document the evidence-based reuse boundary: this package provides mechanics and is not a
  universal game bounded context or rules owner.

## 0.2.0

- Require explicit TypeScript state/outcome ownership so callers, getters, validators, and rules
  cannot mutate authoritative session state by alias.
- Restore checkpointable randomness when transition execution fails before commit.
- Pin SplitMix64 raw output, bounded sampling, and Fisher-Yates ordering in a shared TypeScript/Rust
  conformance corpus.
- Verify both package artifacts in CI.
