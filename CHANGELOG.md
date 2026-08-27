# Changelog

## 0.2.0

- Require explicit TypeScript state/outcome ownership so callers, getters, validators, and rules
  cannot mutate authoritative session state by alias.
- Restore checkpointable randomness when transition execution fails before commit.
- Pin SplitMix64 raw output, bounded sampling, and Fisher-Yates ordering in a shared TypeScript/Rust
  conformance corpus.
- Verify both package artifacts in CI.

