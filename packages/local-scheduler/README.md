# @sentropic/local-scheduler

Generic, zero-dependency, offline local workstation task scheduler runtime for Node.js `>=22.0.0`.

## Guarantees

- **Zero runtime dependencies & zero network**: pure Node.js ESM built-ins only; no HTTP/TCP/TLS/undici imports or network globals.
- **Zero Python**: pure TypeScript/Node.js runtime, log rotation, and testing.
- **Fail-closed namespace-aware single-writer lock**: PID/time-namespace checks, `statfs` local-filesystem gating, two-phase `acquired` -> `spawning` -> `running` transitions, and serialized `<taskId>.lock.reclaim` recovery.
- **Atomic witness & pure health evaluator**: `LocalTaskWitnessV1` (`0600`), bounded `runs.log` and `skips.jsonl`, and zero-I/O `evaluateTaskHealth()`.
- **Injection-safe systemd unit generator**: `renderSystemdUnits()` with `# Managed-By` ownership headers, `UnsetEnvironment=`, `SuccessExitStatus=130 143`, and strict path/token escaping.

## Entrypoints

- `@sentropic/local-scheduler` — contract, errors, validation, state/env/witness/lock/skip readers, `evaluateTaskHealth`, `assertHostPidNamespace`, `createFakeSchedulerAdapter`
- `@sentropic/local-scheduler/runner` — never-rejecting `runScheduledTask` and `runScheduledTaskById`
- `@sentropic/local-scheduler/systemd` — `createSystemdUserAdapter`, `renderSystemdUnits`, `probeSystemdUserAvailability`, `computeExpectedIntervalMs`

> **Note for consumer tests**: calling `createFakeSchedulerAdapter()` without `stateDir` resolves and creates the default user state directory (`resolveStateDir()`). Always pass an isolated temporary `stateDir` (and `envFilePath`) in tests.
