# SPEC_EVOL — Local Scheduled Tasks (r4)

## Changes from r3

This r4 specification marks the design **SOLID (Opus 5.5 r3 review)** (0 blockers in `.h2a/reviews/local-scheduler-spec-r3-opus.md`), with only **one** owner decision remaining pending (`loginctl enable-linger`, §8). All text edits from r3 minors **`m-25`–`m-31`** and nits **`m-32 (a)–(j)`** are folded into this document; implementation, test, and build deliverables remain tracked in Lots S1–S3 (§7.2) and `h2a` cross-lane notes `X-1`–`X-4` (§4.4).

| Review Ref | Spec edit in r4 | Remaining build / external item | Section(s) |
|---|---|---|---|
| **m-25** | Restored `$` → `$$` escaping on **all** `ExecStart=` tokens (path and non-path) after path checks; kept `$` literal in `Environment=` and `EnvironmentFile=`; rejected lone `;` `ExecStart=` args; corrected the r2 `m-18` row note. | Add `$$` / `${X}` script-path golden test and `systemd-analyze verify` coverage in Lots S1/S2. | Changes, §3.1, §6.6, §7.1 |
| **m-26** | Specified the `@internal` test seam (`runScheduledTaskInternal(..., { hostPidGuard })`, never re-exported in `exports`, zero guard-skip env vars/flags in `src/**`) and the `tests/fixtures/ci-runner.mjs` trampoline for CI systemd & host qualification (c); reworded "bypassed by the internal test trampoline". | Implement `src/runner.ts` internal seam, `tests/fixtures/ci-runner.mjs`, and static guard tests in Lots S1/S2. | §2.1, §3.2, §7.1 |
| **m-27** | Added `'RUNNER_INTERNAL_ERROR'` → exit `70` (runner result only, no error class); defined `not_run` (`exitCode: 70`, lock released if held) for pre-witness lock I/O failures and `outcome = childOutcome` (`exitCode: 70`, `witness: null`) for post-child write failures; updated `runScheduledTaskById` doc to `2/70/77`. | Implement error code, I/O failure branches, and 4 `ENOSPC` injection tests in Lot S1. | §2.2, §2.7, §4.2, §7.1 |
| **m-28** | **(a)** Specified the two `ExecMainStatus === 77` diagnostics in `status()` (refused allow-list witness within 5 s vs pre-lock guard/mode refusal). **(b)** Added `readTaskLockSummary`, `readLastSkipEntry`, optional `lock`/`lastSkip` fields on `EvaluateTaskHealthInput` & `LocalTaskStatusV1`, and the stuck-lock hint rule + §4.4 wiring. | Implement readers, `status()` / §4.4 wiring, and truth-table test in Lots S1/S2/H1. | §1.3, §2.6, §3.2, §4.2, §4.4, §7.1 |
| **m-29** | Specified `enable` rollback on `SYSTEMCTL_FAILED`: re-render & restore previous units (verifying digests) + `daemon-reload` when a prior manifest exists; run best-effort `disable -- <timer>` before unlinking + `daemon-reload` when no prior manifest exists; added `rolledBack: boolean` to `SystemctlFailedError`. | Implement rollback logic and CI `systemctl` failure-injection tests in Lot S2. | §3.2, §4.2, §7.1 |
| **m-30** | Enforced constant child `PATH=/usr/bin:/bin` (never inherited); added pre-lock `POLICY_REFUSED_STATE_DIR` (exit `77`, `not_run`) when `manifest.stateDir` mismatches resolved `stateDir`; added env-file override hint for `PATH` / `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`; corrected §3.1 `EnvironmentFile=` precedence claims. | Implement invariant checks, hint emission, and 3 unit tests in Lots S1/S2/H1. | §2.2, §2.6, §3.1, §3.2, §4.2, §4.4, §6.4, §7.1 |
| **m-31** | Strengthened rule (a) to require strict UUID format on both `record.bootId` and current boot id; narrowed rule (b) `Z` zombie death proof to `Threads: 1` + concordant start under time-ns gate; made non-`ESRCH`/`EPERM` `kill` errors and unreadable `/proc/<pid>/stat` yield `skipped_locked`; cited `succession-lock.ts:862-916`. | Implement hardened classifier and 2 new lock tests (unreadable boot id, multi-threaded zombie) in Lot S1. Optional `/etc/machine-id` field left deferred/optional. | §0, §2.3, §4.1, §7.1 |
| **m-32** | Applied all 10 nits **(a)–(j)**: `ci.yml:24-49`/`29-49` ranges; `probeStateDirObservability` non-dir/symlink rule; fake adapter `stateDir` (`0700`) creation + probe reuse; `<taskId>.lock.reclaim` `phase: 'acquired'` / `childPgid: null`; `skips.jsonl` rotated only by lock holder at step 8; `schedule_missed` hint wording; `LocalTaskWitnessV1.refusal` narrowed to `'allowlist' \| 'file-mode'`; S3 wire compatibility (server-side grace map + receiver-first rollout); `files` tarball allowlist; updated S1 (`16–24 h`), S2 (`12–17 h`), and critical-path (`32–47 h`) estimates. | Implement fake adapter, rotator, schema check, `package.json` `files` in Lot S1, and S3 rollout order if Lot S3 opens. | §1.3, §2.2–§2.8, §4.2, §5.2, §7.1–§7.3 |

## Changes from r2

This specification preserves the r3 closures of `B-5` and `m-16`–`m-24` from `.h2a/reviews/local-scheduler-spec-r2-opus.md` (alongside r2's closures of `B-1`–`B-4`, `m-1`–`m-15`, Notes 1–4).

| Review Ref | Verdict in r3 | Summary of change | Section(s) |
|---|---|---|---|
| **B-5** | **Closed** | Host PID namespace guard at runner step 2 **before** any lock operation (stderr, exit `77`, no lock touched, no `last-run.json`, `skips.jsonl` entry); kill-switches before allow-list; lock `pidNs`, `timeNs`, two-phase `phase: 'acquired' \| 'spawning' \| 'running'`; namespace/time-ns rule (b), `uid === geteuid()`, opaque `nlink === 1`, `spawning` boot-only reclaim, no force-unlock in v1; removed `requireHostPidNamespace` from public API. | §2.1–§2.3, §2.5, §2.7, §3.2, §4.2, §4.3, §6.7, §7.1 |
| **m-16** | **Closed** | Fixed dead-timer masking in `evaluateTaskHealth()`: stale `skipped_disabled` falls through to `schedule_missed`/`critical`; single `failed` past `deadlineMs` escalates to `critical`. | §2.6, §7.1 |
| **m-17** | **Closed** | Never-rejecting runner (`outcome: 'not_run'`, `error`); full error-code → exit-code table; `probeStateDirObservability` rule; disk-backed `createFakeSchedulerAdapter`; `ON_CALENDAR_PRESETS`/`REGEX`; Node interpreter rule. | §1.3, §2.6, §3.2, §4.2, §4.4, §6.5, §7.1 |
| **m-18** | **Closed** *(refined in r4 per m-25)* | Pinned `envFilePath` once at `enable()`; unified path sanitization; unquoted `EnvironmentFile=-<escaped-abs-path>` with glob rejection (`*`, `?`, `[`) per `systemd.exec(5)` / systemd 259. *(r3 kept `$` → `$$` on non-path `ExecStart=` tokens only; r4 m-25 restores `$` → `$$` on all `ExecStart=` tokens.)* | §2.1, §2.4, §2.6, §3.1, §3.2, §4.2, §4.4, §6.4, §6.6, §7.1 |
| **m-19** | **Closed** | Added `SuccessExitStatus=130 143` to `.service` template, notes, and golden snapshot. | §2.7, §3.1, §7.1 |
| **m-20** | **Closed** | Rejected `BLOCKED_LOADER_ENV_VARS` at `enable()`, stripped at run, and added `UnsetEnvironment=` to `.service`. | §2.2, §3.1, §3.2, §6.4, §6.5, §7.1 |
| **m-21** | **Closed** | Adopted Option (A) for gated Lot S3 (`heartbeat` arming + per-watch `heartbeatGraceMs >= deadlineMs`). | §0, §5.1, §5.2 |
| **m-22** | **Closed** | Named `Dockerfile.systemd-ci` from `$(LLM_MESH_NODE_IMAGE)`; ext4 fixtures under `/workspace/.tmp/`; split `BRxx-EX1a`/`BRxx-EX1b`/`BRxx-EX2` (`ci.yml:29-49` range fixed in r4 per m-32(a)). | §7.1, §7.2 |
| **m-23** | **Closed** | Attributed the global zero-Python rule to the owner and noted its extension by this dossier to the workstation scheduled task. | §0, §6.1 |
| **m-24** | **Closed** | Re-pinned `h2a` `origin/main` `bed33a0eb990` (`resume [slug]` at `:5544`); `O_APPEND` local-fs inode lock wording; removed `'unknown'` trigger; marked `trigger` informational. | §0, §2.3, §2.5, §4.3, §4.4 |

*Minors deferred from r3: **none** (all text edits folded into r4; build/test tasks listed in table above and §7.2).*

---

## 0. Status, authority, and reading convention

- **Status**: **SOLID (Opus 5.5 r3 review) — r4 specification** (2026-11-25). Reviewed with 0 blockers in `.h2a/reviews/local-scheduler-spec-r3-opus.md`; r3 minors `m-25`–`m-31` and nits `m-32` folded into r4. Owner decision pending on `loginctl enable-linger` only (§8).
- **Track reference**: h2a Track `01M89GM3RQ3GQ5KYJ7DA6PPMWS` (follow-on to session-archiving Track `01M89AYACBDVV85VH3YB7DY7FQ`, `PILOT-r1.md`, `DESIGN-r4.md`, `REVIEW-opus-r4.md`).
- **Owner authority**:
  - **2026-11-25 Q-P1 ("Sentropic d'abord")**: automatic local CLI session archiving must run on a **generic Sentropic process** built first in `sentropic`; `h2a` pilots it as the first consumer; capitalisation into `@sentropic/cluster-mesh` happens only if opportune. Verbatim owner direction on Q1: *"automatique - comment - tout de suite souhaité mais tout depend de qui pilote. ce doit être h2a avec un processus générique de sentropic, si opportun capitalisé cluster mesh"*.
  - **2026-11-25 Q2-A / Q3-A / Claude 90-day retention**: Claude Code native retention stays at `90` days (`cleanupPeriodDays = 90`, oldest remaining local sessions dated `2026-10-26`, first native purge estimated `2027-01-24`); `h2a` owns conservation-only archiving, automatic restore in `h2a resume` / `h2a run --resume`, and incremental CLI rollout (Claude → Vibe → `agy`/`muse` post-spike; Codex untouched).
  - **Zero Python rule** (authority: owner's global instruction « 0 Python dans les repos et les jobs (k8s/CI) »; precedent: `spec/SPEC_EVOL_SANDBOX_NODE.md:71`; applied by this dossier to the workstation scheduled task as well): zero Python anywhere in Sentropic repositories, packages, generated units, jobs, or tests. Pure Node.js / TypeScript ESM and native OS primitives only.
- **Transverse architectural and repository invariants**:
  - **Make-Only & Docker-First** (`rules/MASTER.md:11-21`, `origin/main`): all build, typecheck, test, pack, and publish commands run through `Makefile` targets inside Docker containers; `Makefile` edits and any host-only qualification target require explicit `BRxx-EXn` scope exceptions (`rules/MASTER.md:32-33`).
  - **D1=B everywhere** (`spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:10`): every domain package remains independently integrable, testable, and disableable, owns its runtime and data, and never imports `@sentropic/cluster-mesh` merely to operate.
  - **Harness tooling-only** (`packages/harness/README.md:7-8`; `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:40,308`): never co-ship a runtime package with `@sentropic/harness`.
  - **No competing Sentropic CLI** (`rules/MASTER.md:36`, `origin/main`): `CLI = h2a`; no `@sentropic/cli` or `@sentropic/build-cli`.
- **Inspected `origin/main` baselines (read-only)**:
  - `sentropic`: `f47bf4f759bbb8da4ac4d680cc885c4530f079e5`
  - `h2a`: `bed33a0eb990a3d0d21712e27bd7d7aabfaf6793` *(r1/r2 baseline was `f025cd2d8ccf6aab734cd39da3c942d2a21f4003`; among cited files only `packages/h2a-runtime/src/index.ts` shifted `resume [slug]` from `:5519` to `:5544` — re-pin when H1 starts)*
- **Reading convention**:
  - **CURRENT**: verified in `origin/main` at the cited `file:line`.
  - **TARGET**: required behavior specified by this document, not claimed as implemented.
  - **PARTIAL**: reusable seam or idiom exists, not yet generalised.
  - **GATED**: optional future capability blocked behind an explicit opportunity condition.

### CURRENT evidence baseline

| Area | Verified CURRENT evidence (`origin/main`) | Consequence for this spec |
|---|---|---|
| External triggers stub (BR-30) | `plan/36-BRANCH_feat-external-triggers.md:15,20-24`; `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:267-284` | Stub only (no code, no `SPEC_VOL_EXTERNAL_TRIGGERS.md`). Targets server-side multi-tenant ingress (`TenantContext` mandatory, `:282`) dispatching `@sentropic/flow` DAGs via `@sentropic/events`, blocked behind BR-26 (`:15`). Cannot carry local workstation OS timers today. |
| Flow runtime (`@sentropic/flow`) | `packages/flow/README.md:1-3`; `packages/flow/package.json:34-36`; `packages/flow/src/job-queue.ts:4-13`; `packages/flow/src/processing-loop.ts:22-31` | Postgres-backed `FOR UPDATE SKIP LOCKED` job queue + Hono runtime; unpublished WIP under BR-32; zero calendar or OS scheduling. Unusable for local workstation tasks. |
| Harness (`@sentropic/harness`) | `packages/harness/README.md:7-10`; `packages/harness/package.json:4,31-39`; `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:40,308` | Strictly tooling-only, emit-only (`VerificationRun`), zero runtime dependents. Must not host a task scheduler runtime. |
| Cluster Mesh (`@sentropic/cluster-mesh`) | `packages/cluster-mesh/src/mesh.ts:74-85`; `ops-job-failure-types.ts:15-105`; `ops-job-failure-contract.ts:46-52,142-168`; `incident-schedule.ts:36-44`; `incident-policy.ts:45-46,67-82`; `incident-state.ts:58-65,105-108`; `api/src/services/notifications/ops-sweep.ts:283-288` | Control-plane composition + notification contracts, no scheduler runtime. `OpsJobFailureV1` closes `source` to `'k8s' \| 'app'` and `kind` to `'CronJob' \| 'Job' \| 'app-job'`. Only `heartbeat` events open a dormant watch (`incident-policy.ts:45-46`, `incident-state.ts:105-108`); `succeeded` with no prior state is a no-op (`incident-policy.ts:67-82`); `heartbeatGraceMs` is a single global `1 h` (`incident-state.ts:58-65`). |
| Publishable workspace & CI pattern | `package.json:4-9`; `package-lock.json:19996-20007`; `Makefile:115,614,2353-2406`; `.github/workflows/ci.yml:24-49,388-390,1123-1124,1726-1745,3420-3441,3727-3729`; `scripts/ci/publishable-manifests.mjs:22-39`; `scripts/ci/consumer-boundaries.json:21`; `scripts/ci/api-tool-deps-key.mjs:22-24` | New `@sentropic/*` packages live under `packages/<slug>`, register in root `package-lock.json` (`make lock-root`), all 3 arrays of `publishable-manifests.mjs`, `consumer-boundaries.json`, and `ci.yml` (`bootstrap_publish_target` closed choice list + jobs), define Docker-first `Makefile` targets (`$(LLM_MESH_NODE_IMAGE)` = `node:24-bookworm-slim`), and require an owner-triggered `bootstrap_publish_target` first release using `NPM_TOKEN` before steady-state OIDC publishing. |
| `h2a` local safety idioms & runtime layout | `packages/h2a/src/runtime/loop/supervisor.ts:11-36,66-82,151-183`; `packages/h2a/src/runtime/mirror/push-daemon.ts:149-166`; `packages/h2a/src/runtime/local-files/locks.ts:14-27,262-295,382-398`; `packages/h2a/src/runtime/local-files/succession-lock.ts:360-387,789-830,862-916`; `packages/h2a-runtime/src/file-lock.ts:13-16`; `packages/h2a-runtime/src/status-projection.ts`; `packages/h2a-runtime/src/index.ts:5544`; `packages/h2a/package.json:71-72,96-98`; `contrib/systemd/README.md:1-65` | `locks.ts` + `succession-lock.ts` (`classifyLiveness(..., { protocol: 'identity' })` at `:862-916`) prove fail-closed namespace- and time-namespace-aware death proof + qualified `statfs` + UID/`nlink` checks + serialized guard-lock recovery; `file-lock.ts:13-16` is explicitly best-effort (not mutual exclusion); `h2a status`/`h2a resume` live in `packages/h2a-runtime`; `h2a` bin `dist/bin.js` uses `#!/usr/bin/env node`; deployed units need `H2A_ROOT` captured explicitly. |

---

## 1. Package placement and name

### 1.1 Decision: new package `packages/local-scheduler` (`@sentropic/local-scheduler`)

**TARGET**: Create a small, self-contained, zero-runtime-dependency TypeScript package at `packages/local-scheduler`, published to npm as **`@sentropic/local-scheduler`**, consumed directly by `@sentropic/h2a-runtime` (first consumer) and any future Sentropic workstation consumer.

### 1.2 Why this placement (and why every alternative is rejected)

| Candidate | Verdict | Evidence (`origin/main`) |
|---|---|---|
| **`@sentropic/local-scheduler` (new package in `sentropic/packages/local-scheduler`)** | **Selected** | Zero runtime deps (Node `>=22` built-ins only), honours Q-P1 ("Sentropic d'abord"), honours **D1=B** (`SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:10`), honours `harness` tooling-only rule (`SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:308`), honours `CLI = h2a` (`rules/MASTER.md:36` — library + internal runner, not a user-facing Sentropic CLI), and ships independently before `2027-01-10`. |
| Inside `@sentropic/harness` | **Rejected** | Violates `packages/harness/README.md:7-8` ("Tooling-only: zero product-runtime coupling") and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:40,308` ("Never co-ship a runtime package with `@sentropic/harness`"). |
| Inside `@sentropic/flow` | **Rejected** | `packages/flow/package.json:34-36` pulls `hono`; `packages/flow/src/job-queue.ts:4-13` and `processing-loop.ts:22-31` are server-side Postgres workflow orchestration; unpublished WIP (`packages/flow/README.md:3`). |
| Inside `@sentropic/cluster-mesh` | **Rejected** | Violates **D1=B** (`spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md:10`): `h2a` local archiving must operate without importing `cluster-mesh` as a runtime requirement (`packages/cluster-mesh/src/mesh.ts:74-85`). |
| Wait for / build inside BR-30 (`@sentropic/triggers`) | **Rejected for critical path; compatible seam** | `plan/36-BRANCH_feat-external-triggers.md:15,20-24` and `spec/SPEC_STUDY_ARCHITECTURE_BOUNDARIES.md:267-284` scope BR-30 to multi-tenant server triggers (`TenantContext` mandatory at `:282`) dispatching `@sentropic/flow` DAGs and emitting `@sentropic/events`, blocked on BR-26 (`:15`). Waiting misses the `2027-01-10` J-14 gate. **Alignment**: `LocalTaskScheduleV1` provides a **compatible seam**; the exact mapping (including a no-tenant local mode and an idempotency key `<taskId>:<scheduledSlotIso>`) will be defined when BR-30 freezes `TriggerSource`. |
| New user-facing CLI `@sentropic/cli` | **Rejected** | Eradicated by `rules/MASTER.md:36` (`CLI = h2a: no sentropic CLI package`). Operator verbs (`enable`/`disable`/`status`/`uninstall`) are exposed by each consumer CLI (first: `h2a archive schedule ...`). |

### 1.3 Package layout and exports

```text
packages/local-scheduler/
  package.json                 # name: "@sentropic/local-scheduler", type: "module", sideEffects: false,
                               # files: ["dist", "README.md", "LICENSE"], engines: { "node": ">=22.0.0" }, dependencies: {}
  tsconfig.json
  Dockerfile.systemd-ci        # Built from $(LLM_MESH_NODE_IMAGE) + systemd, systemd-sysv, dbus-user-session (Lot S2)
  README.md
  LICENSE
  src/
    index.ts                   # Public contract, constants, errors, validation, manifest/witness/env/lock/skip I/O, health, fake adapter
    errors.ts                  # LocalSchedulerError hierarchy + closed LocalSchedulerErrorCode union
    contract.ts                # LocalTaskSpecV1, LocalTaskManifestV1, EnablePolicyV1, validation, allow-list & shebang check
    env-file.ts                # Pure parseSchedulerEnvFile(text), readSchedulerEnvFile(), kill-switch evaluation
    state-dir.ts               # resolveStateDir(), probeStateDirObservability(), readTaskManifest()
    witness.ts                 # LocalTaskWitnessV1 schema (v1), atomic write, readTaskWitness(), skips.jsonl appender/reader
    health.ts                  # Pure evaluateTaskHealth() dead-man / paused / interrupted / unobservable / clock-skew evaluator
    lock.ts                    # Fail-closed single-writer lock + pidNs/timeNs + qualified statfs + guard-lock recovery + childPgid + readTaskLockSummary()
    host-pid-guard.ts          # Linux init PID namespace proof (fail-closed under bwrap/containers)
    log-rotator.ts             # Pure Node bounded log capture & size-based rotation (0600)
    runner.ts                  # One-shot execution supervisor (spawn shell:false, timeout, SIGTERM->SIGKILL, witness)
    adapter.ts                 # OsSchedulerAdapter interface + createFakeSchedulerAdapter()
    systemd/
      index.ts                 # SystemdUserAdapter (enable, disable, uninstall, status, linger check, --runtime mode)
      unit-generator.ts        # Pure injection-safe .service + .timer emitter
      systemctl.ts             # Safe execFile('systemctl'|'systemd-analyze'|'loginctl', ['--', ...]) wrappers
  tests/
    ...
```

Package subpath exports (`package.json` `"exports"`):
- `@sentropic/local-scheduler`:
  - Constants & schemas: `LOCAL_TASK_SPEC_V1`, `LOCAL_TASK_MANIFEST_V1`, `LOCAL_TASK_WITNESS_V1`, `ON_CALENDAR_PRESETS`, `ON_CALENDAR_CUSTOM_REGEX`, `BLOCKED_LOADER_ENV_VARS`.
  - Types: `LocalTaskSpecV1`, `LocalTaskScheduleV1`, `LocalTaskCommandV1`, `LocalTaskResourcesV1`, `LocalTaskRunnerEntryV1`, `LocalTaskManifestV1`, `LocalTaskWitnessV1`, `LocalTaskSkipEntryV1`, `LocalTaskLockSummaryV1`, `LocalTaskOutcomeV1`, `LocalTaskTriggerV1`, `LocalTaskRefusalReasonV1`, `LocalTaskKillSwitchMatchV1`, `LocalTaskHealthStatus`, `EvaluateTaskHealthInput`, `LocalTaskHealthVerdict`, `StateDirObservabilityResult`, `EnablePolicyV1`, `EnableResultV1`, `DisableResultV1`, `UninstallOptionsV1`, `UninstallResultV1`, `LocalTaskStatusV1`, `SystemdRuntimeStateV1`, `OsSchedulerAdapter`, `FakeSchedulerAdapter`, `LocalSchedulerErrorCode`.
  - Errors: `LocalSchedulerError`, `SchedulerUnavailableError`, `InvalidTaskSpecError`, `UnmanagedUnitError`, `PolicyRefusalError`, `ManifestCorruptError`, `TaskNotFoundError`, `SystemctlFailedError`.
  - Functions: `validateTaskSpec`, `resolveStateDir`, `resolveSchedulerEnvFilePath`, `probeStateDirObservability`, `readTaskManifest`, `readTaskWitness`, `readTaskLockSummary`, `readLastSkipEntry`, `parseSchedulerEnvFile`, `readSchedulerEnvFile`, `evaluateKillSwitch`, `isTaskKillSwitchActive`, `evaluateTaskHealth`, `assertHostPidNamespace`, `createFakeSchedulerAdapter`.
- `@sentropic/local-scheduler/systemd`:
  - `createSystemdUserAdapter`, `renderSystemdUnits`, `probeSystemdUserAvailability`, `computeExpectedIntervalMs`.
- `@sentropic/local-scheduler/runner`:
  - `RunScheduledTaskOptionsV1`, `RunScheduledTaskResultV1`, `runScheduledTask`, `runScheduledTaskById`.

Zero external runtime dependencies (`dependencies: {}`). `devDependencies`: `"typescript": "5.4.5"`, `"@types/node": "^22.0.0"` (aligned with Node `>=22.0.0`), `"vitest": "4.0.18"` (matching `Makefile:2361` locked CI tool versions).

---

## 2. The task contract

### 2.1 Task specification (`LocalTaskSpecV1`) and manifest (`LocalTaskManifestV1`)

Every registered task is persisted as an immutable validated manifest at `${stateDir}/tasks/<taskId>/manifest.json` (`0600`), where `stateDir` and `envFilePath` are resolved once at `enable` (`resolveStateDir()`, `resolveSchedulerEnvFilePath()`) and pinned into the generated `.service` unit (§3.1, §4.2).

```ts
export const LOCAL_TASK_SPEC_V1 = 1 as const;
export const LOCAL_TASK_MANIFEST_V1 = 1 as const;

export const ON_CALENDAR_PRESETS = ['hourly', 'daily', 'weekly', 'monthly'] as const;
/**
 * Strict allow-list for custom systemd OnCalendar expressions:
 * - Presets: hourly | daily | weekly | monthly
 * - Custom: 1..64 ASCII chars in [0-9A-Za-z*,./:~ -], no '%', no leading '-', no trailing '\'.
 * Also verified via `systemd-analyze calendar --iterations=8 -- <expr>` at enable time.
 */
export const ON_CALENDAR_CUSTOM_REGEX = /^(?!-)[0-9A-Za-z*,./:~ -]{1,64}$/;

/** Loader/runtime-injection env vars forbidden in command.env, envAllowlist, child env, and unit env (§6.5). */
export const BLOCKED_LOADER_ENV_VARS = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
] as const;

export interface LocalTaskScheduleV1 {
  /** Validated preset or strict OnCalendar expression (verified by systemd-analyze). */
  readonly onCalendar: string;
  /** Catch up missed runs after power-off/suspend (systemd Persistent=true). Default: true. */
  readonly persistent: boolean;
  /** Jitter delay in seconds (0..3600). Default: 300. */
  readonly randomizedDelaySec?: number;
  /** Timer coalescing window in seconds (1..3600). Default: 60. */
  readonly accuracySec?: number;
  /**
   * Optional consumer cross-check for the nominal period in milliseconds (>= 60_000).
   * Authoritative expectedIntervalMs is computed at enable time (presets: hourly=3_600_000,
   * daily=86_400_000, weekly=604_800_000, monthly=2_678_400_000; custom: max consecutive gap
   * over `systemd-analyze calendar --iterations=8 -- <expr>`) and stored in manifest.json.
   * If provided here, enable rejects with InvalidTaskSpecError (exit 2) when deviation > 10%.
   */
  readonly expectedIntervalMs?: number;
  /**
   * Grace multiplier applied to manifest.expectedIntervalMs before flagging schedule_missed.
   * Range: 1.1..5.0. Default: 1.5 (e.g. 36 h for daily, 10.5 d for weekly).
   */
  readonly graceMultiplier?: number;
}

export interface LocalTaskCommandV1 {
  /**
   * Absolute canonical path to executable binary (ELF or non-env shebang checked at enable & run).
   * For Node.js consumers, bin MUST be a Node interpreter (e.g. process.execPath) and args[0] MUST
   * be the canonical absolute entry script path (checked against allowedScripts; §6.5).
   */
  readonly bin: string;
  /** Literal argv passed via spawn(bin, args, { shell: false }). Max 64 args, 1024 chars each. */
  readonly args: readonly string[];
  /** Optional absolute working directory. Defaults to $HOME. */
  readonly cwd?: string;
  /**
   * Static non-secret environment variables captured at enable time and stored ONLY in
   * manifest.json (NEVER written to .service unit files). Validated against the secret denylist,
   * BLOCKED_LOADER_ENV_VARS, and control-char rules (§6.4, §6.5). Example: { H2A_ROOT: '/home/user/src/a2a-cli' }.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Optional additional non-secret environment variable names forwarded from the runner
   * environment when already defined in the user manager. Secret-shaped names and
   * BLOCKED_LOADER_ENV_VARS are rejected at enable and stripped at run (§6.4, §6.5).
   */
  readonly envAllowlist?: readonly string[];
}

export interface LocalTaskResourcesV1 {
  /** Scheduling niceness (0..19). Default: 15. Negative values rejected. */
  readonly nice?: number;
  /** I/O scheduling class (best-effort; see §2.9). Default: 'idle'. */
  readonly ioSchedulingClass?: 'idle' | 'best-effort';
  /** Systemd MemoryMax (e.g. '512M', '1G'; bounds 64M..4G). Default: '512M'. */
  readonly memoryMax?: string;
  /** Systemd CPUQuota percentage (e.g. '50%'; bounds 5%..100%). Default: '50%'. */
  readonly cpuQuota?: string;
  /** Maximum tasks/threads in the service cgroup (8..512). Default: 64. */
  readonly tasksMax?: number;
}

export interface LocalTaskSpecV1 {
  readonly v: typeof LOCAL_TASK_SPEC_V1;
  /** Lowercase ASCII slug: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/ (3..64 chars). */
  readonly taskId: string;
  /** Consumer namespace slug: /^[a-z0-9][a-z0-9-]{0,31}$/ (e.g. 'h2a'). */
  readonly owner: string;
  /** Human-readable single-line label (<= 120 chars, no control chars, no '%', no '\'). */
  readonly description: string;
  readonly schedule: LocalTaskScheduleV1;
  /** One-shot idempotent command invoked by the runner. */
  readonly command: LocalTaskCommandV1;
  /** Hard execution timeout in ms (5_000..7_200_000). Default: 900_000 (15 min). */
  readonly timeoutMs: number;
  /** SIGTERM-to-SIGKILL grace window in ms (1_000..60_000). Default: 15_000. */
  readonly killGraceMs?: number;
  /** Optional consumer-familiar kill-switch env var name (e.g. 'H2A_ARCHIVE_OFF'). */
  readonly killSwitchEnv?: string;
  readonly resources?: LocalTaskResourcesV1;
}

export interface LocalTaskRunnerEntryV1 {
  /** Canonical executable invoked by systemd ExecStart (e.g. '/usr/bin/node'). */
  readonly bin: string;
  /** Literal argv prefix; systemd unit emits ExecStart = bin + args + [taskId]. */
  readonly args: readonly string[];
}

export interface LocalTaskManifestV1 {
  readonly v: typeof LOCAL_TASK_MANIFEST_V1;
  readonly spec: LocalTaskSpecV1;
  readonly runner: LocalTaskRunnerEntryV1;
  readonly enabled: boolean;
  /** UTC ISO-8601 Z when first installed (preserved across updates/re-enables). */
  readonly installedAt: string;
  /** UTC ISO-8601 Z of the latest enable transition (anchors dead-man after re-enable). */
  readonly enabledAt: string;
  /** Resolved absolute stateDir pinned into the generated .service unit. */
  readonly stateDir: string;
  /** Resolved absolute env-file path pinned into the generated .service unit (EnvironmentFile=-). */
  readonly envFilePath: string;
  /** Authoritative nominal interval in ms computed at enable time. */
  readonly expectedIntervalMs: number;
  readonly units: {
    readonly serviceSha256: string;
    readonly timerSha256: string;
  };
}
```

*Note (`m-26` host PID guard seam)*: The host PID namespace guard is **never** a manifest or public-API toggle (`requireHostPidNamespace` is absent from `LocalTaskSpecV1` and all public types). Production entry points (`runScheduledTask`, `runScheduledTaskById`, `createSystemdUserAdapter`) accept no guard-skip option and read **no** environment variable, file, or CLI flag that skips the guard. The bypass exists exclusively as a parameter of package-internal functions (e.g. `runScheduledTaskInternal(..., { hostPidGuard })` in `src/runner.ts` and its internal adapter counterpart in `src/systemd/index.ts`), never re-exported in `package.json` `"exports"`. The CI systemd lifecycle and host qualification (c) cross the systemd process boundary by allow-listing a test trampoline `policy.runner = { bin: node, args: ['<pkg>/tests/fixtures/ci-runner.mjs'] }` under `tests/` (excluded from the npm tarball via `"files"`), which imports the internal function from `dist/` and injects a passing guard (§7.1).

### 2.2 Idempotency, execution order, and timeout / signal handling

- Every task command MUST be **one-shot** (one bounded pass, then exit) and **idempotent** (safe to re-run after crash, reboot, interruption, or `Persistent=true` catch-up without duplicating data or corrupting state).
- **Mandatory runner execution order** (enforces host PID isolation before any lock operation and guarantees that only the lock holder writes `last-run.json`):
  1. **Verify `stateDir` and `manifest.json`**: check ownership and modes (`0700`/`0600`, no symlinks, owned by `process.getuid()`), validate `manifest.json`, and verify `manifest.stateDir === resolvedStateDir` (`m-30`, catching any `EnvironmentFile=` override of `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`). On failure → log one line to `stderr`, never touch locks or `last-run.json`, return `{ outcome: 'not_run', exitCode: 2 | 77, witness: null, error }` (exit `2` for `TASK_NOT_FOUND` / `MANIFEST_CORRUPT` / `INVALID_TASK_SPEC`; exit `77` for `POLICY_REFUSED_FILE_MODE` / `POLICY_REFUSED_STATE_DIR`).
  2. **Host PID namespace guard BEFORE any lock operation** (§3.4):
     - On failure: log one line to `stderr`, exit **`77`**.
     - **Never** create, reclaim, or remove a lock. **Never** write `last-run.json`.
     - If `skips.jsonl` is writable (task dir owned by `process.getuid()`, mode `0700`, not symlinked), append `{ "v": 1, "runId": "<uuid>", "at": "<UTC Z>", "pid": <pid>, "outcome": "refused_policy", "refusal": "sandbox" }` (never rotate here).
     - Return `{ outcome: 'refused_policy', exitCode: 77, witness: null, error: { code: 'POLICY_REFUSED_SANDBOX', message } }`.
  3. **Acquire single-writer lock** (`${stateDir}/locks/<taskId>.lock`, §2.3).
     - If held by another live holder (or unreclaimable / undecidable) → append `{ "v": 1, "runId": "<uuid>", "at": "<UTC Z>", "pid": <pid>, "outcome": "skipped_locked" }` to `skips.jsonl` (never rotate here), do **NOT** touch `last-run.json`, emit structured JSON line to `stdout`, return `{ outcome: 'skipped_locked', exitCode: 0, witness: null }` (exit **`0`**).
     - On lock directory or lock publication I/O failure (`m-27`) → release lock if held, return `{ outcome: 'not_run', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message } }`.
  4. **While holding the lock, evaluate kill-switches** (§2.4). Kill-switches run **before** the allow-list so a deliberate operator pause is cleanly recorded even when the target command binary temporarily moved or broke. If active → write `last-run.json` (`outcome: 'skipped_disabled'`, `killSwitch: { scope, name }`, preserving `lastSuccessAt`, `lastSuccessRunId`, `consecutiveFailures`), emit JSON line to `stdout`, release lock, exit **`0`**.
  5. **While holding the lock, evaluate command allow-list, shebang check, and dangerous-env check** (§6.5). On failure → write `last-run.json` (`outcome: 'refused_policy'`, `refusal: 'allowlist' | 'file-mode'`), emit JSON line to `stdout`, release lock, exit **`77`**.
  6. **Spawn protocol** (two-phase lock transition closing the spawn window):
     - Immediately **before** `spawn`: atomically rewrite the lock record with `phase: 'spawning'` (same `nonce`, using the rename protocol in §2.3), updating the holder's owned `(dev, ino)`. On pre-spawn rewrite I/O failure (`m-27`), release the lock and return `{ outcome: 'not_run', exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message } }`.
     - Build sanitized child `env` (minimal base with constant `PATH: '/usr/bin:/bin'` never inherited from the runner environment + `manifest.spec.command.env` + `envAllowlist` + declared kill-switch names, stripping all secret-shaped names and `BLOCKED_LOADER_ENV_VARS`).
     - Call `child_process.spawn(command.bin, command.args, { shell: false, detached: true, cwd, env })` (`pgid === child.pid`).
     - Immediately **after** `spawn`: atomically rewrite the lock record with `{ childPid: child.pid, childPgid: child.pid, phase: 'running' }` (same `nonce`, updating the holder's owned `(dev, ino)`). Start monotonic clock (`performance.now()`).
  7. Install hard timeout timer (`timeoutMs`) and `SIGTERM`/`SIGINT` listeners:
     - On timeout: send `SIGTERM` to `-child.pid`, wait up to `killGraceMs` (default `15_000` ms, matching `h2a-mirror-push.service:63`), then `SIGKILL` to `-child.pid` → outcome `'timed_out'`, exit **`124`**.
     - On `SIGTERM` or `SIGINT` (e.g. user logout with `Linger=no` or `systemctl --user stop`): forward `SIGTERM` to `-child.pid`, wait up to `killGraceMs`, then `SIGKILL` to `-child.pid` → outcome `'interrupted'`, exit **`143`** (`SIGTERM`) or **`130`** (`SIGINT`), without incrementing `consecutiveFailures`.
  8. Write `last-run.json` atomically (`0600`), append & rotate `runs.log` (`0600`), rotate `skips.jsonl` if over threshold (`m-32(e)` — lock holder only), emit one JSON summary line to `stdout`, release lock, and exit. If writing `last-run.json` fails after the child ran (`m-27`, e.g. `ENOSPC`), still release the lock and return `{ outcome: childOutcome, exitCode: 70, witness: null, error: { code: 'RUNNER_INTERNAL_ERROR', message } }`.
- **Systemd stop/timeout coordination**: `.service` sets `KillMode=mixed`, `SuccessExitStatus=130 143`, `TimeoutStartSec = ceil((timeoutMs + killGraceMs) / 1000) + 30`, and `TimeoutStopSec = ceil(killGraceMs / 1000) + 15`. On timeout or logout stop, systemd signals the runner first (`KillMode=mixed`), letting the runner cleanly drain the child process group, persist the witness, and release the lock before systemd kills any remaining cgroup processes as a backstop.
- **Manual "run now" rule**: whenever `systemd --user` is available, operators trigger an immediate pass via **`systemctl --user start sentropic-task-<taskId>.service`** (systemd enforces unit singleton execution and cgroup cleanup on stop). Invoking `runScheduledTask` / `runScheduledTaskById` directly is reserved for tests and systemd-less diagnostics.

### 2.3 Single-writer lock (fail-closed, namespace-aware)

Generalising `h2a` `packages/h2a/src/runtime/local-files/locks.ts:14-27,262-295,382-398` and `packages/h2a/src/runtime/local-files/succession-lock.ts:360-387,789-830,862-916`:

- **Location**: `${stateDir}/locks/<taskId>.lock` (mode `0600`, inside `0700` directory).
- **Lock payload (`0600` JSON)**:
  ```json
  {
    "v": 1,
    "taskId": "h2a-session-archive",
    "pid": 41203,
    "pidStartTime": "18492014",
    "pidNs": "pid:[4026531836]",
    "timeNs": "time:[4026531834]",
    "phase": "running",
    "childPid": 41219,
    "childPgid": 41219,
    "host": "workstation-01",
    "bootId": "8f2a9c4b-...",
    "nonce": "3b9e8f1c0a2d4e6f...",
    "acquiredAt": "2026-12-01T03:10:00.000Z"
  }
  ```
  - `bootId`: trimmed `/proc/sys/kernel/random/boot_id`.
  - `pidStartTime`: field 22 of `/proc/self/stat` (parsed after the last `')'` to tolerate spaces/parens in `comm`; defeats PID reuse).
  - `pidNs`: `readlinkSync('/proc/self/ns/pid')`, or `null` if unreadable (`succession-lock.ts:363-373`).
  - `timeNs`: `readlinkSync('/proc/self/ns/time')`, or `null` if unreadable (`succession-lock.ts:379-387`).
  - `phase`: `'acquired' | 'spawning' | 'running'`. Starts as `'acquired'` with `childPid: null, childPgid: null`; immediately before `spawn`, the holder atomically rewrites the lock with `phase: 'spawning'`; immediately after `spawn`, it atomically rewrites the lock with `childPid: child.pid, childPgid: child.pid, phase: 'running'`.
  - **Atomic lock-record rewrite protocol**: write complete JSON with **`nonce` unchanged** to same-directory temp file (`<taskId>.lock.<pid>.<nonce>.<seq>.tmp`, `0600`) → `fsync(fd)` → `close(fd)` → `rename(tmp, lockPath)` → `fsync(locksDir)`, and record the new `(dev, ino)` as the holder's owned generation.
- **Atomic acquisition**:
  1. Write complete JSON (`phase: 'acquired'`, `childPid: null`, `childPgid: null`) to `<taskId>.lock.<pid>.<nonce>.tmp` (`0600`), `fsync(fd)`, `close(fd)`.
  2. Publish via `linkSync(tmp, lockPath)` (fallback `openSync(lockPath, 'wx', 0o600)` only on `EPERM`/`EXDEV`/`ENOTSUP`), unlink `tmp`, `fsync(locksDir)`.
- **Contention & pre-lock sandbox refusal log (`skips.jsonl`, never touches `last-run.json`)**:
  - Non-blocking. Only the lock holder ever writes `last-run.json`.
  - A losing contender (or a runner refused pre-lock by the host PID guard) only appends one compact JSON line (`< 4096` bytes) to `${stateDir}/tasks/<taskId>/skips.jsonl` (`0600`, bounded at `256 KiB` with single-generation rotation `skips.jsonl.1` performed exclusively by the lock holder at step 8), opened with `O_APPEND` (on Linux local filesystems, concurrent small `O_APPEND` writes are serialized by the kernel inode lock).
  - Schema (`LocalTaskSkipEntryV1`):
    ```ts
    export type LocalTaskSkipEntryV1 =
      | { readonly v: 1; readonly runId: string; readonly at: string; readonly pid: number; readonly outcome: 'skipped_locked' }
      | { readonly v: 1; readonly runId: string; readonly at: string; readonly pid: number; readonly outcome: 'refused_policy'; readonly refusal: 'sandbox' };
    ```
  - A losing contender logs to `stdout` and exits `0`; a sandbox refusal logs one line to `stderr` and exits `77`.
- **Fail-closed stale-lock reclaim rule**:
  > Reclaim requires `lstatSync(lockPath).uid === process.geteuid()` on qualified local storage, and a strict death proof:
  > (a) `record.bootId` and the current boot id both match `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` and differ (an unreadable or malformed current boot id makes (a) inapplicable); or
  > (b) `record.host === os.hostname()` AND `record.pidNs !== null` AND `record.pidNs === currentPidNs` AND the runner is dead (`process.kill(record.pid, 0)` throws `ESRCH`; OR `/proc/<pid>/stat` state is `Z` AND `/proc/<pid>/status` reports `Threads: 1` AND field 22 is concordant under the time-namespace gate `record.timeNs !== null && record.timeNs === currentTimeNs`; OR field 22 differs from `record.pidStartTime`, counted only when `record.timeNs !== null && record.timeNs === currentTimeNs`) AND either the child group is dead (`process.kill(-record.childPgid, 0)` throws `ESRCH`) or `record.childPgid === null && record.phase === 'acquired'`.
  >
  > Any `process.kill(pid, 0)` error other than `ESRCH`/`EPERM`, or an unreadable `/proc/<pid>/stat` (or `/proc/<pid>/status` for `Z`) for a present PID, yields `skipped_locked`.
  >
  > A record with `record.phase === 'spawning'` and no `childPgid` is reclaimable only by rule (a). Every other case yields `skipped_locked`.
  >
  > **TTL expiry is never a proof.** A holder that is past its expected duration/timeout but alive (e.g. across a host suspend where wall clock advances while Node's `CLOCK_MONOTONIC` timer is paused), belongs to another host (`record.host !== os.hostname()`), belongs to another PID namespace (`record.pidNs !== currentPidNs`), or has an unreadable namespace (`null`) yields `skipped_locked` and is left to the dead-man alert.
  >
  > A lock that no rule can clear is cleared at the next boot by rule (a); the dead-man alert covers the gap; there is no force-unlock in v1.
  - **Qualified local storage gate** (mirroring `h2a` `locks.ts:262-265`): stale reclaim is permitted ONLY on Linux filesystems whose `statfsSync(locksDir).type >>> 0` is in `{ 0xef53 (ext4), 0x58465342 (xfs), 0x9123683e (btrfs), 0xf2f52010 (f2fs) }`. On any other filesystem (NFS, SMB, FUSE, overlayfs, unknown), reclaim fails closed and returns `skipped_locked`.
  - **Corrupt/opaque lock files**: never reclaimed by age alone. Reclaimable ONLY on qualified local storage when `st.uid === process.geteuid()` AND `st.nlink === 1` AND `predatesBoot(st)` holds (both `mtimeMs` and `ctimeMs` strictly precede a coherent `/proc/stat` `btime` cross-checked against `/proc/uptime` and initial time namespace `time:[4026531834]`, mirroring `h2a` `locks.ts:269-290`). Otherwise fail closed (`skipped_locked`).
  - **Serialized reclaimer protocol** (mirroring `h2a` `locks.ts:382-398`):
    1. Acquire guard lock `<taskId>.lock.reclaim` using the same exclusive `link`/`O_EXCL` protocol and the same death-proof rule (bounded recursion depth `<= 4`, so a crashed reclaimer can itself be recovered). Guard-lock records always carry `phase: 'acquired'` and `childPgid: null`, and are never rewritten (`m-32(d)`). If guard acquisition loses → return `skipped_locked`.
    2. Inside the guard, capture and re-read `lockPath`, comparing the full identity `(nonce, dev, ino, size, mtimeMs, ctimeMs, raw bytes)` against the inspected snapshot AND re-checking `uid === geteuid()` (plus `nlink === 1` for opaque files) AND the death proof.
    3. On **any mismatch**, release the guard and return `skipped_locked` — **never move or unlink a lock record that was not identically inspected**.
    4. Write a private quarantine copy `<taskId>.lock.quarantine.<nonce>` (`0600`), `fsync(fd)`, `close(fd)`, `fsync(locksDir)`.
    5. Re-verify `unchanged(lockPath, snapshot)`; if unchanged, `unlinkSync(lockPath)` and `fsync(locksDir)` (then unlink the quarantine copy after successful removal or retain on error for forensics).
    6. Release `<taskId>.lock.reclaim` and attempt exclusive acquisition of `lockPath` once more; if another contender won the slot in between, return `skipped_locked`.
- **Release**: holder reads `lockPath` and `lstatSync(lockPath)`, verifies `record.nonce === ownedNonce` and `(st.dev, st.ino)` match its last published generation, then unlinks `lockPath` and `fsync(locksDir)`. *(Because reclaim requires a strict namespace-aware death proof, a live holder is never reclaimed.)*

### 2.4 Kill-switch (global, per-task, and consumer alias)

Generalising `H2A_LOOP_AUTOTICK_OFF` (`supervisor.ts:13`) and `H2A_MIRROR_PUSH_OFF` (`push-daemon.ts:150-166`):

- **Checked variables (OR logic — evaluated in priority order; first match recorded)**:
  1. **Global (`scope: 'global'`)**: `SENTROPIC_LOCAL_SCHEDULER_OFF`
  2. **Per-task canonical (`scope: 'task'`)**: `SENTROPIC_TASK_<UPPER_SNAKE_TASK_ID>_OFF` (e.g. `SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF`)
  3. **Per-task consumer alias (`scope: 'alias'`)**: optional `spec.killSwitchEnv` (e.g. `H2A_ARCHIVE_OFF`).
- **Evaluation rule** (identical to `push-daemon.ts:159-166`): active when defined and `value.trim().toLowerCase()` is not `""`, `"0"`, or `"false"`.
- **Operator activation without editing units**:
  - Immediate next-tick freeze (volatile across reboot): `systemctl --user set-environment SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF=1`.
  - Persistent freeze across reboots: append `SENTROPIC_TASK_H2A_SESSION_ARCHIVE_OFF=1` to the pinned env file (`manifest.envFilePath`, default `${XDG_CONFIG_HOME ?? ~/.config}/sentropic/local-scheduler/env`, mode `0600`), loaded by `EnvironmentFile=-<escaped-abs-path>` in `.service` (§3.1).
- **Pure env-file parser (`parseSchedulerEnvFile(text: string)`)**: parses systemd `EnvironmentFile=` syntax (`#`/`;` comments, blank lines, `KEY=VALUE`, optional single/double quote stripping, no shell expansion, ignores malformed lines safely). Consumers read `manifest.envFilePath` (falling back to `resolveSchedulerEnvFilePath()` only when no valid manifest exists) via `readSchedulerEnvFile(...)` without ever shelling out to `systemctl`.
- **Effect**: evaluated *after* acquiring the single-writer lock and *before* the allow-list check (§2.2). Runner does not spawn the child command, writes `last-run.json` with `outcome: 'skipped_disabled'` and `killSwitch: { scope, name }` (preserving `lastSuccessAt`, `lastSuccessRunId`, `consecutiveFailures`), emits one JSON log line, releases the lock, and exits **`0`**.

### 2.5 Last-run witness JSON schema (`LocalTaskWitnessV1`) and evolution

- **Path**: `${stateDir}/tasks/<taskId>/last-run.json` (mode `0600`).
- **Atomic write protocol**: serialize JSON → write `${taskDir}/.last-run.<pid>.<nonce>.tmp` (`0600`) → `fsync(fd)` → `close(fd)` → `rename(tmp, lastRunPath)` → `fsync(taskDir)`.
- **Schema (`v: 1`)**:

```ts
export const LOCAL_TASK_WITNESS_V1 = 1 as const;

export type LocalTaskTriggerV1 = 'systemd-timer' | 'manual';

export type LocalTaskOutcomeV1 =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'interrupted'
  | 'skipped_disabled'
  | 'refused_policy';
// Note: 'skipped_locked' and pre-lock 'refused_policy' (refusal: 'sandbox') are NEVER written to
// last-run.json; they are appended to skips.jsonl only (§2.2, §2.3).

export type LocalTaskRefusalReasonV1 = 'sandbox' | 'allowlist' | 'file-mode' | 'state-dir';

export interface LocalTaskKillSwitchMatchV1 {
  readonly scope: 'global' | 'task' | 'alias';
  readonly name: string;
}

export interface LocalTaskWitnessV1 {
  readonly v: typeof LOCAL_TASK_WITNESS_V1;
  readonly taskId: string;
  readonly owner: string;
  readonly runId: string;                     // UUIDv4
  /** Informational only (best-effort from TRIGGER_UNIT per systemd.exec(5)). */
  readonly trigger: LocalTaskTriggerV1;
  readonly host: string;                      // os.hostname()
  readonly pid: number;                       // runner PID
  readonly startedAt: string;                 // strict UTC ISO-8601 ending in 'Z'
  readonly finishedAt: string;                // strict UTC ISO-8601 ending in 'Z'
  readonly durationMs: number;                // >= 0 integer from monotonic performance.now()
  readonly outcome: LocalTaskOutcomeV1;
  readonly exitCode: number | null;           // child exit code, null if killed/not spawned
  readonly signal: string | null;             // e.g. 'SIGTERM', 'SIGKILL', or null
  /** Required when outcome === 'skipped_disabled'; omitted otherwise. */
  readonly killSwitch?: LocalTaskKillSwitchMatchV1;
  /** Required when outcome === 'refused_policy' (only 'allowlist' | 'file-mode' are ever written); omitted otherwise. */
  readonly refusal?: 'allowlist' | 'file-mode';
  /** 0 on succeeded; +1 on failed/timed_out/refused_policy; preserved on skipped_disabled and interrupted. */
  readonly consecutiveFailures: number;
  /** Preserved across failures, interruptions, and pauses for dead-man evaluation. */
  readonly lastSuccessAt: string | null;
  readonly lastSuccessRunId: string | null;
  /** Optional sanitized single-line summary, <= 512 UTF-8 bytes, no secrets, no control chars. */
  readonly summary?: string;
  readonly logPath?: string;
}
```

- **Schema evolution rule**:
  - `v: 1` has a frozen closed key set: unknown keys, missing required conditional fields (`killSwitch` on `skipped_disabled`, `refusal` on `refused_policy`), invalid `refusal` values outside `'allowlist' | 'file-mode'` (e.g. `'sandbox'` or `'state-dir'`, which are never written to `last-run.json`, `m-32(g)`), invalid UTC timestamps, or negative durations are rejected as `'corrupt'`.
  - Any future additive field **MUST** bump the schema to `v: 2`; `v: 2` readers accept both `v: 1` and `v: 2` witnesses (upgrade order: ship v2 readers before v2 writers so existing readers never flag `'corrupt'` during rollout).
- **Trigger derivation (informational)**:
  - `process.env.TRIGGER_UNIT` is non-empty and ends with `.timer` (set automatically by `systemd.exec(5)` on timer activation) → `'systemd-timer'`.
  - Otherwise (including manual `systemctl --user start`, direct CLI invocation, or `INVOCATION_ID` unset) → `'manual'`.
  - Per `systemd.exec(5)`, `$TRIGGER_UNIT` is best-effort (coalesced triggers are reported once); `trigger` is strictly **informational** and never alters lock, witness validity, or health evaluation semantics.
- **Duration measurement**: computed strictly from a monotonic clock (`Math.max(0, Math.round(performance.now() - startMono))`) so suspend/resume or NTP jumps never corrupt `durationMs`.

### 2.6 Dead-man, pause, and failure evaluation (pure read-time function)

Generalising `loopAttendance` (`h2a` `supervisor.ts:151-183`) and `isOpsHeartbeatOverdue` (`cluster-mesh` `incident-schedule.ts:36-44`), `@sentropic/local-scheduler` exports a **100% pure, zero-I/O** function called by consumers at read time:

```ts
export type LocalTaskHealthStatus =
  | 'healthy'
  | 'not_installed'
  | 'unobservable'
  | 'disabled'
  | 'paused'
  | 'pending_first_run'
  | 'interrupted'
  | 'failing'
  | 'schedule_missed'
  | 'clock_skew'
  | 'witness_corrupt';

export interface StateDirObservabilityResult {
  readonly observable: boolean;
  readonly reason?: 'absent-outside-host-namespace' | 'inaccessible' | 'not-a-directory';
}

export interface LocalTaskLockSummaryV1 {
  readonly pid: number;
  readonly phase: 'acquired' | 'spawning' | 'running';
  readonly acquiredAt: string;
}

export interface EvaluateTaskHealthInput {
  /** Whether stateDir is accessible/observable by the reader (from probeStateDirObservability). Default: true. */
  readonly stateDirObservable?: boolean;
  readonly manifest: LocalTaskManifestV1 | null | 'corrupt';
  readonly witness: LocalTaskWitnessV1 | null | 'corrupt';
  /** Parsed from manifest.envFilePath (or resolveSchedulerEnvFilePath() if no manifest) via parseSchedulerEnvFile(). */
  readonly persistedKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  /**
   * Optional kill-switch detected in the READER process environment (display hint ONLY).
   * MUST NEVER downgrade failing, schedule_missed, clock_skew, or witness_corrupt.
   */
  readonly readerEnvKillSwitch?: LocalTaskKillSwitchMatchV1 | null;
  /** Optional current lock summary from readTaskLockSummary() (display hint ONLY; never alters status/severity). */
  readonly lock?: LocalTaskLockSummaryV1 | null | 'unreadable';
  /** Optional latest skips.jsonl entry from readLastSkipEntry() (display hint ONLY; never alters status/severity). */
  readonly lastSkip?: LocalTaskSkipEntryV1 | null;
  /** Protected var names ('PATH' | 'SENTROPIC_LOCAL_SCHEDULER_STATE_DIR') set in the parsed env file (display hint ONLY). */
  readonly envFileProtectedOverrides?: readonly string[];
  readonly nowIso: string;                    // injected clock, strict UTC ISO-8601 Z
  readonly clockSkewToleranceMs?: number;     // default: 300_000 (5 min, matching ops-job-failure-types.ts:82)
}

export interface LocalTaskHealthVerdict {
  readonly status: LocalTaskHealthStatus;
  readonly severity: 'ok' | 'warning' | 'critical';
  readonly overdueByMs?: number;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly opsReason?: 'job-failed' | 'deadline-exceeded' | 'schedule-missed' | 'stale';
  readonly message: string;
  /** Non-authoritative display hints (e.g. readerEnvKillSwitch, stuck lock, env-file override, install hint). */
  readonly hints: readonly string[];
}
```

**Normative `probeStateDirObservability(stateDir)` rule**:
1. Attempt `lstatSync(stateDir)` + `accessSync(stateDir, R_OK)`:
   - Exists, is a real directory (`st.isDirectory()`, not a symlink), and is readable → `{ observable: true }`.
   - Exists but is not a directory, or is a symlink (`m-32(b)`) → `{ observable: false, reason: 'not-a-directory' }`.
   - Fails with `ENOENT`: invoke `assertHostPidNamespace()`:
     - Passes (real host before first `enable`) → `{ observable: true }` (reader then reports `not_installed`).
     - Fails (sandbox/container where `~/.local/state` is not bound) → `{ observable: false, reason: 'absent-outside-host-namespace' }` (so a sandboxed reader never reports a false `not_installed`/`ok` while the host task is failing).
   - Fails with `ENOTDIR` (a parent path component is not a directory) → `{ observable: false, reason: 'not-a-directory' }`.
   - Fails with `EACCES`, `EPERM`, or any other error → `{ observable: false, reason: 'inaccessible' }`.

**Deterministic evaluation order (fail-closed)**:
1. **Observability**: if `stateDirObservable === false` → `status: 'unobservable'`, `severity: 'warning'`, message explaining state directory is inaccessible from this environment (e.g. unmounted inside sandbox).
2. **Installation & manifest integrity**:
   - If `manifest === null` → `status: 'not_installed'`, `severity: 'ok'`, hint `"task is not installed"`.
   - If `manifest === 'corrupt'` → `status: 'witness_corrupt'`, `severity: 'critical'`, `opsReason: 'stale'`.
3. **Administrative disable**: if `!manifest.enabled` → `status: 'disabled'`, `severity: 'ok'`.
4. **Witness integrity**: if `witness === 'corrupt'` → `status: 'witness_corrupt'`, `severity: 'critical'`, `opsReason: 'stale'`.
5. **Deadline & freshness reference**:
   - `deadlineMs = Math.round(manifest.expectedIntervalMs * (manifest.spec.schedule.graceMultiplier ?? 1.5))`.
   - `skewMs = clockSkewToleranceMs ?? 300_000`.
   - `freshnessRefIso`: `maxIso(witness?.lastSuccessAt ?? null, manifest.enabledAt)` (so re-enabling after a long disable grants a fresh grace window from `enabledAt` rather than immediately firing `schedule_missed`).
6. **Null witness** (`witness === null`):
   - If `now - Date.parse(manifest.enabledAt) <= deadlineMs` → `status: 'pending_first_run'`, `severity: 'ok'`.
   - Else → `status: 'schedule_missed'`, `severity: 'critical'`, `opsReason: 'schedule-missed'`, `overdueByMs`.
7. **Clock-skew guard** (`supervisor.ts:177-180`):
   - If `Date.parse(witness.finishedAt) - now > skewMs` OR (`witness.lastSuccessAt !== null` and `Date.parse(witness.lastSuccessAt) - now > skewMs`) → `status: 'clock_skew'`, `severity: 'warning'`, `opsReason: 'stale'`.
8. **Operator pause (`witness.outcome === 'skipped_disabled'`)**:
   - **Dead-timer check**: if `now - Date.parse(witness.finishedAt) > deadlineMs` → **fall through to step 10** (`schedule_missed`/`critical`, so a stale pause witness from a dead timer can never mask a broken unit forever).
   - Otherwise (timer is still actively ticking and writing fresh `skipped_disabled` witnesses):
     - `status: 'paused'`.
     - `severity`: `'ok'` while `now - Date.parse(freshnessRefIso) <= deadlineMs`, `'warning'` after that (with `overdueByMs`).
     - `message`: `"paused since <witness.finishedAt> by <witness.killSwitch.name>; last success <witness.lastSuccessAt ?? 'never'>"`.
9. **Failure and interruption outcomes**:
   - `witness.outcome === 'refused_policy'` → `status: 'failing'`, `severity: 'critical'`, `opsReason: 'job-failed'`.
   - `witness.outcome === 'timed_out'` → `status: 'failing'`, `severity: 'critical'`, `opsReason: 'deadline-exceeded'`.
   - `witness.outcome === 'failed'` → `status: 'failing'`, `severity: (witness.consecutiveFailures >= 2 || now - Date.parse(freshnessRefIso) > deadlineMs) ? 'critical' : 'warning'`, `opsReason: 'job-failed'` (so a single failure followed by a dead timer escalates to `'critical'` once `deadlineMs` elapses).
   - `witness.outcome === 'interrupted'`: if `now - Date.parse(freshnessRefIso) > deadlineMs` → fall through to step 10 (`schedule_missed`/`critical`, so repeated logout interruptions cannot mask an overdue schedule); otherwise → `status: 'interrupted'`, `severity: 'warning'`, `opsReason: undefined`.
10. **Dead-man freshness check**:
    - If `now - Date.parse(freshnessRefIso) > deadlineMs` → `status: 'schedule_missed'`, `severity: 'critical'`, `opsReason: 'schedule-missed'`, `overdueByMs`.
11. **Healthy**: `status: 'healthy'`, `severity: 'ok'`.

**Hint rule (applied after steps 1–11, never altering `status` or `severity`)**:
- If `readerEnvKillSwitch` is non-null: append `"reader process env sets <name>; this does not pause the systemd user timer"` to `hints`. It **never** downgrades `failing`, `schedule_missed`, `clock_skew`, or `witness_corrupt`.
- If `persistedKillSwitch` is non-null and `status !== 'paused'` and `status !== 'disabled'`:
  - If `status === 'schedule_missed'` (`m-32(f)`): append `"env file sets <name>, but no tick is recorded since <witness?.finishedAt ?? 'enable'>; the timer may be stopped"` to `hints`.
  - Otherwise: append `"persisted env file sets <name>; next scheduled tick will pause"` to `hints`.
- If `lastSkip?.outcome === 'skipped_locked'` and (`witness === null || witness === 'corrupt'` || `Date.parse(lastSkip.at) > Date.parse(witness.finishedAt)`) (`m-28(b)`):
  - If `lock` is a `LocalTaskLockSummaryV1` object: append `"recent ticks found the lock held by pid <lock.pid> (phase <lock.phase>) since <lock.acquiredAt>; if no run is active, a reboot clears it"` to `hints`.
  - Else if `lock === 'unreadable'`: append `"recent ticks found an unreadable lock file; if no run is active, a reboot clears it"` to `hints`.
- For each variable `<VAR>` in `envFileProtectedOverrides` (`PATH`, `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`, `m-30`):
  - Append `"env file sets <VAR>; runner enforces constant child PATH and manifest.stateDir parity — remove <VAR> from the env file"` to `hints`.

### 2.7 Exit-code semantics

| Exit code | Meaning | Witness (`last-run.json`) | Systemd unit state |
|---:|---|---|---|
| `0` | Task succeeded, OR cleanly paused (`skipped_disabled`), OR cleanly yielded to live lock (`skipped_locked`) | `succeeded` / `skipped_disabled` *(lock holder only; `skipped_locked` goes to `skips.jsonl`)* | `inactive (dead)` (clean) |
| `1` | Consumer child command exited non-zero | `failed` | `failed` |
| `2` | Invalid task spec, missing task (`TASK_NOT_FOUND`), manifest validation/corrupt error, interval cross-check > 10%, unmanaged unit refusal, or invalid CLI args (`packages/harness/README.md:49-50`) | *(not written; `outcome: 'not_run'`)* | `failed` |
| `69` | `systemd --user` manager unavailable / unsupported OS (`EX_UNAVAILABLE`) | *(adapter lifecycle refusal)* | N/A |
| `70` | Runner internal I/O failure (`RUNNER_INTERNAL_ERROR`) or `systemctl` command failure (`SYSTEMCTL_FAILED`, `EX_SOFTWARE`) | Pre-witness lock I/O failure: not written (`not_run`, lock released if held). Post-child witness write failure: `witness: null` (child outcome preserved in `RunScheduledTaskResultV1`) | `failed` |
| `77` | Policy/security refusal: host PID namespace failed (`sandbox`, pre-lock), command/shebang outside allow-list (`allowlist`, post-lock), unsafe mode/symlink (`file-mode`), or mismatched/invalid `stateDir` (`state-dir`, pre-lock) (`EX_NOPERM`) | Post-lock (`allowlist`, child `file-mode`): `refused_policy` (lock holder only). Pre-lock (`sandbox`): `skips.jsonl` only, **never** writes `last-run.json` or locks. Pre-lock (`state-dir`, manifest `file-mode`): not written (`not_run`). | `failed` *(diagnostic mapped in `status()`)* |
| `124` | Execution timeout exceeded (`SIGTERM` → grace → `SIGKILL`, `timeout(1)`) | `timed_out` | `failed` |
| `130` / `143` | Runner interrupted by `SIGINT` (`130`) or `SIGTERM` (`143`, e.g. logout/stop) | `interrupted` | `inactive (dead)` (clean via `SuccessExitStatus=130 143`) |

### 2.8 Log location, format, and rotation

- **Structured journal stream**: runner writes one compact JSON line per run to `stdout` (`{ v: 1, taskId, runId, trigger, outcome, durationMs, exitCode, signal, consecutiveFailures }`) captured by `systemd-journald` (`journalctl --user -u sentropic-task-<taskId>.service`).
- **Local rotating file**: `${stateDir}/tasks/<taskId>/runs.log` (mode `0600`), written and rotated purely in Node.js (zero Python, zero `logrotate` dependency):
  - Appends the structured JSON header line plus a bounded excerpt of child stdout/stderr (capped at `64 KiB` per run, NUL/control characters stripped, UTF-8 safe truncation mirroring `truncateOpsDetail` in `ops-job-failure-types.ts:108-114`).
  - Rotation threshold: `maxBytes = 5 * 1024 * 1024` (5 MiB), `maxFiles = 5` (`runs.log` → `runs.log.1` … `runs.log.4`; oldest unlinked before shift). All rotated files retain mode `0600`.
- **Contention & sandbox-refusal log**: `${stateDir}/tasks/<taskId>/skips.jsonl` (`0600`, `maxBytes = 256 KiB`, `maxFiles = 2`). Contenders and pre-lock sandbox refusals only `O_APPEND`; rotation is performed **exclusively by the lock holder at runner step 8** (`m-32(e)`).

### 2.9 Resource limits

Applied declaratively in the generated `.service` unit (`[Service]`):
- `Nice=15` (default, bounds `0..19`; never negative) — **active on target host**.
- `IOSchedulingClass=idle` (default; allowed: `'idle' | 'best-effort'`) — **best-effort only**: effective only on block devices configured with an `ioprio`-aware I/O scheduler (`bfq`/`kyber`/`mq-deadline`); has no effect on devices running the `none` scheduler (such as NVMe devices on this workstation, where the user manager delegates `cpu memory pids` only).
- `MemoryMax=512M` (default, matching `contrib/systemd/h2a-mcp-central.service:18`; bounds `64M..4G`) — **active on target host**.
- `CPUQuota=50%` (default; bounds `5%..100%`) — **active on target host**.
- `TasksMax=64` (default; bounds `8..512`) — **active on target host**.
- `UMask=0077` (fixed, non-overridable).

---

## 3. OS adapter (`systemd --user`)

### 3.1 Unit generation and ownership marker

Default unit directory: `${XDG_CONFIG_HOME ?? ~/.config}/systemd/user/` (overridable via `EnablePolicyV1.unitDir`; qualification tests use `$XDG_RUNTIME_DIR/systemd/user/` with `runtime: true`).
- Directory permissions rule: **create with mode `0700` ONLY if absent; NEVER `chmod` an existing unit directory** (e.g. an owner's existing `0755` `~/.config/systemd/user/`). Verify existing directory is owned by `process.getuid()`, is not a symlink, and is not group- or world-writable (`(mode & 0o022) === 0`); otherwise fail closed with `PolicyRefusalError` (exit `77`).
- Unit files (written atomically via temp file + `fsync` + `rename`, mode `0600`):
  - `sentropic-task-<taskId>.service`
  - `sentropic-task-<taskId>.timer`

Every generated unit starts with a machine-verifiable header:
```ini
# Managed-By: @sentropic/local-scheduler v1
# Task-Id: <taskId>
# Owner: <owner>
```
`enable`, `disable`, and `uninstall` **refuse** (`UnmanagedUnitError`, exit `2`) to overwrite or delete any pre-existing unit file lacking matching `# Managed-By: @sentropic/local-scheduler` and `# Task-Id: <taskId>` headers.

#### Reference `.service` template (`sentropic-task-<taskId>.service`)

```ini
# Managed-By: @sentropic/local-scheduler v1
# Task-Id: h2a-session-archive
# Owner: h2a
[Unit]
Description=Sentropic local scheduled task: h2a local CLI session archive (h2a-session-archive)
After=default.target

[Service]
Type=oneshot
KillMode=mixed
SuccessExitStatus=130 143
Nice=15
IOSchedulingClass=idle
MemoryMax=512M
CPUQuota=50%
TasksMax=64
UMask=0077
NoNewPrivileges=yes
RestrictAddressFamilies=AF_UNIX
LockPersonality=yes
RestrictRealtime=yes
TimeoutStartSec=1845
TimeoutStopSec=30
Environment="PATH=/usr/bin:/bin"
Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=/home/user/.local/state/sentropic/local-scheduler"
EnvironmentFile=-/home/user/.config/sentropic/local-scheduler/env
UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT
ExecStart="/usr/bin/node" "/home/user/.npm-global/lib/node_modules/@sentropic/h2a/dist/bin.js" "archive" "_schedule-exec" "h2a-session-archive"
StandardOutput=journal
StandardError=journal
```

Design notes on the generated `.service`:
- **No `[Install]` section**: triggered exclusively by its paired `.timer` (or explicit `systemctl --user start`).
- **Zero memory footprint between runs**: `Type=oneshot` exits completely after each pass.
- **Clean interruption exit codes (`SuccessExitStatus=130 143`)**: per `systemd.service(5)`, `Type=oneshot` does not treat signal exits (`SIGINT`/`SIGTERM`, mapped to exit `130`/`143`) as clean unless listed in `SuccessExitStatus=`. Declaring `130 143` ensures logout or `systemctl --user stop` leaves the unit `inactive (dead)` instead of `failed`.
- **No hardcoded `SENTROPIC_TASK_TRIGGER`**: the runner reads `process.env.TRIGGER_UNIT` (set by `systemd.exec(5)` ONLY for timer-activated services), so manual `systemctl --user start` is tagged `'manual'` rather than `'systemd-timer'`.
- **Pinned `stateDir` and `envFilePath` (`m-30` precedence guard)**: both `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR` and `EnvironmentFile=-<escaped-abs-path>` are resolved once at `enable()` and stored in `manifest.json`. Because `systemd.exec(5)` lets `EnvironmentFile=` override `Environment=`, the runner independently verifies `manifest.stateDir === resolvedStateDir` at step 1 (failing closed with `POLICY_REFUSED_STATE_DIR`, exit `77` if overridden in `envFilePath`) and `status()` / §4.4 emit a hint whenever the env file defines `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR` or `PATH`.
- **Loader/runtime-injection hardening (`UnsetEnvironment=`)**: `UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT` is applied by systemd as the **final** environment step *after* `EnvironmentFile=` (`systemd.exec(5)`), protecting both the runner's own Node process and the child process even if an env file tries to inject code.
- **Why filesystem/user-namespace directives (`PrivateTmp`, `ProtectHome`, `ProtectSystem`, `PrivateUsers`) are omitted**: per `systemd.exec(5)`, enabling these directives in a per-user manager implicitly activates `PrivateUsers=`, which remaps `/proc/1` ownership away from `uid 0` (breaking host PID check #2 in §3.4) and blocks access to the owner's real `~/.claude` / `~/.vibe` session paths.
- **Seccomp hardening without user namespaces**: `NoNewPrivileges=yes`, `RestrictAddressFamilies=AF_UNIX`, `LockPersonality=yes`, and `RestrictRealtime=yes` use kernel seccomp filters (no user namespace required). `RestrictAddressFamilies=AF_UNIX` permits `systemd-journald` and local unix-socket probes while kernel-blocking all `AF_INET`/`AF_INET6` sockets (including `127.0.0.1:3002` LLM gateway) even for the full `h2a` child binary.
- **Graceful stop on logout/shutdown**: `KillMode=mixed` delivers `SIGTERM` to the runner main process first; `TimeoutStopSec = ceil(killGraceMs / 1000) + 15` gives the runner time to terminate `-childPgid`, persist `outcome: 'interrupted'`, and release the lock before systemd sends `SIGKILL` to any remaining cgroup processes.
- **Constant child `PATH` (`m-30`) & canonical `ExecStart`**: `Environment="PATH=/usr/bin:/bin"` sets the default unit `PATH` and canonical `(node, script)` `ExecStart=` paths eliminate `/usr/bin/env` lookups (§6.5); because `EnvironmentFile=` can override unit `Environment=`, the runner unconditionally constructs the child's `PATH` as the constant `'/usr/bin:/bin'` (never inherited from the runner process).
- **Unified injection-safe escaping (`m-25`)**:
  - Every interpolated path (`EnvironmentFile=`, `Environment=`, and path tokens in `ExecStart=`) follows one strict path-sanitization rule: reject ASCII control characters, `"` and `\`; escape `%` → `%%`.
  - **Every `ExecStart=` token — path or non-path — escapes `$` → `$$`** after the path checks (`systemd.service(5)` expands `${FOO}` in `ExecStart=` from `Environment=` and `EnvironmentFile=`), whereas `Environment=` and `EnvironmentFile=` keep `$` literal (`systemd.exec(5)`).
  - Any `ExecStart=` argument solely equal to `;` is **rejected** (`systemd.service(5)`).
  - Non-path `ExecStart=` argv tokens reject control characters and trailing `\`, and escape `\` → `\\`, `"` → `\"`, `%` → `%%`, and `$` → `$$` (`systemd.service(5)` / `systemd.syntax(7)`).
  - `Environment=` and `ExecStart=` values are wrapped in `"..."`; `EnvironmentFile=-<escaped-abs-path>` additionally rejects glob metacharacters (`*`, `?`, `[`) and is emitted **unquoted** (per `systemd.exec(5)` and verified on systemd 259 `systemd-analyze verify`, `EnvironmentFile=` treats `"` literally and rejects `EnvironmentFile=-"/..."` as not absolute, while unquoted handles spaces and `%%` cleanly).
  - `Description=` rejects `%`, `\`, and control chars; no unit value may end in `\`.

#### Reference `.timer` template (`sentropic-task-<taskId>.timer`)

```ini
# Managed-By: @sentropic/local-scheduler v1
# Task-Id: h2a-session-archive
# Owner: h2a
[Unit]
Description=Timer for Sentropic local scheduled task: h2a-session-archive

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=600
AccuracySec=60
Unit=sentropic-task-h2a-session-archive.service

[Install]
WantedBy=timers.target
```

### 3.2 Lifecycle commands (`SystemdUserAdapter`)

All `systemctl`, `systemd-analyze`, and `loginctl` invocations use `execFile` with literal argv (`shell: false`), `--` before every variable argument, and a bounded `10_000` ms command timeout. Non-zero exit from `systemctl` throws `SystemctlFailedError` (`code: 'SYSTEMCTL_FAILED'`, exit `70`).

| Operation | Steps & failure semantics |
|---|---|
| **`enable(spec, policy)`** | 1) Assert host PID namespace (§3.4; bypassed only via package-internal `@internal` function seam for CI/host qualification, never via `createSystemdUserAdapter` public options, manifest, or env vars, `m-26`) and `systemd --user` availability (§3.3). 2) Validate `spec`, `policy.runner`, `command.env` + `envAllowlist` (secret denylist + `BLOCKED_LOADER_ENV_VARS`), allow-list + shebang check (§6.5), path escaping rules (§6.6), and compute `expectedIntervalMs` via presets or `systemd-analyze calendar --iterations=8 -- <onCalendar>` (reject with `InvalidTaskSpecError` if consumer cross-check deviates > 10%). 3) Resolve `stateDir` and `envFilePath` once; ensure `stateDir` (`0700`); ensure `unitDir` (`0700` ONLY if absent; never `chmod` existing; verify owner & `(mode & 0o022) === 0`); verify `# Managed-By` header on any pre-existing unit files (`UnmanagedUnitError`, exit `2`). 4) Read any previous `manifest.json` (preserving `installedAt` and detecting whether `OnCalendar` changed); render `.service` & `.timer` (computing SHA-256 digests). 5) Atomically write `.service` and `.timer` (`0600`), **keeping the previous `manifest.json` untouched until systemd accepts the units**. 6) Run `systemctl --user daemon-reload`, then `systemctl --user enable --now [--runtime] -- sentropic-task-<taskId>.timer` (using `--runtime` when `policy.runtime === true`). If `OnCalendar` changed on an already-active timer, run `systemctl --user restart -- sentropic-task-<taskId>.timer`. **Rollback on `SYSTEMCTL_FAILED` (`m-29`)**: keep `manifest.json` unchanged; **with a previous manifest**, re-render its units via `renderSystemdUnits(previous)`, verify both digests against `previous.units`, atomically write those units back and run `daemon-reload` (best-effort), setting `rolledBack` on `SystemctlFailedError`; **without a previous manifest**, run `systemctl --user disable -- sentropic-task-<taskId>.timer` (best-effort, clearing any `timers.target.wants` symlink) before unlinking `.timer`/`.service`, then `daemon-reload` (best-effort), setting `rolledBack` on `SystemctlFailedError`. 7) **Only after `enable --now` succeeds**, atomically write `manifest.json` (`0600`; `enabled: true`, `enabledAt = nowIso`, `stateDir`, `envFilePath`, `expectedIntervalMs`, `units`). 8) Probe `loginctl show-user --property=Linger --value -- <user>` (read-only); return `EnableResultV1` with `lingerEnabled` and advisory note if `false`. |
| **`disable(taskId, opts?)`** | 1) Assert `systemd --user` availability. 2) Read `manifest.json`: if absent, throw **`TaskNotFoundError`** (`code: 'TASK_NOT_FOUND'`, exit `2`); if corrupt, throw `ManifestCorruptError` (exit `2`). 3) Verify `# Managed-By` header on unit files (if present). 4) Run `systemctl --user disable --now [--runtime] -- sentropic-task-<taskId>.timer`. 5) Atomically update `manifest.json` (`enabled: false`), preserving units, `last-run.json`, `skips.jsonl`, and `runs.log`. |
| **`status(taskId, opts?)`** | **Never throws for a missing task** (returns `manifest: null`, `health.status: 'not_installed'`). 1) Probe `stateDir` observability (`probeStateDirObservability`), read `manifest.json`, `last-run.json`, `lock` (`readTaskLockSummary`, `m-28(b)`), `lastSkip` (`readLastSkipEntry`, `m-28(b)`), and the env file at `manifest.envFilePath` (falling back to `resolveSchedulerEnvFilePath()` only if no valid manifest exists), recording any `PATH` or `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR` override in `envFileProtectedOverrides` (`m-30`). 2) If `systemd --user` is available, query `systemctl --user show --property=UnitFileState,ActiveState,NextElapseUSecRealtime,LastTriggerUSec,LastTriggerUSecMonotonic -- sentropic-task-<taskId>.timer` and `systemctl --user show --property=ActiveState,Result,ExecMainStatus,ExecMainExitTimestamp -- sentropic-task-<taskId>.service`, plus `loginctl` linger state. Map `ExecMainStatus === 203` to `"runner binary moved or not executable (203/EXEC); re-run enable"`. Map **`ExecMainStatus === 77` (`m-28(a)`)**: if the latest witness is `refused_policy` and `finishedAt >= ExecMainExitTimestamp - 5 s`, set `"command refused by the allow-list (<witness.refusal>); re-run enable"`; otherwise set `"refused before the lock: host PID guard (unit sandboxing) or state directory/manifest ownership or mode; see journalctl --user -u <unit>"`. 3) Run `evaluateTaskHealth()`. Return `LocalTaskStatusV1`. |
| **`uninstall(taskId, opts?)`** | **Idempotent** (succeeds with `removedUnits: []` when task/units are already absent; still refuses pre-existing unmanaged units with `UnmanagedUnitError`). 1) Assert `systemd --user` availability. 2) Verify `# Managed-By` header on unit files (if present). 3) `systemctl --user disable --now [--runtime] -- sentropic-task-<taskId>.timer` and `stop -- sentropic-task-<taskId>.service` (ignore `not-loaded`). 4) Run `systemctl --user clean --what=state -- sentropic-task-<taskId>.timer` (removes `Persistent=` stamp file per `systemd.timer(5)`; ignore `not-loaded`). 5) Unlink `.timer` and `.service` (if present). 6) `systemctl --user daemon-reload` and `systemctl --user reset-failed -- sentropic-task-<taskId>.service sentropic-task-<taskId>.timer` (best-effort). 7) Remove `manifest.json` (if present); keep `last-run.json`, `skips.jsonl`, and `runs.log` unless `opts?.purgeState === true`. |

### 3.3 Linger requirement and absence of `systemd --user`

- **Linger**: without `loginctl enable-linger "$USER"`, the user manager runs only while the owner has an active login session (`contrib/systemd/README.md:40-42`). With `Persistent=true`, missed runs catch up automatically at the next login. `@sentropic/local-scheduler` **never** invokes `sudo` or attempts privilege escalation; `enable` and `status` report `lingerEnabled: boolean | null` with the exact owner command `loginctl enable-linger "$USER"` when unattended logged-out execution is desired (see `DECISIONS-FR-r3.md` / §8).
- **Behavior when `systemd --user` is absent**:
  - `probeSystemdUserAvailability()` checks `process.platform === 'linux'` and runs `execFile('systemctl', ['--user', 'show', '--property=Version', '--value'], { timeout: 5_000 })`. It **never** calls `show-environment` and never reads or logs the manager environment.
  - If unavailable, `enable`, `disable`, and `uninstall` **refuse explicitly** by throwing `SchedulerUnavailableError` (`code: 'SYSTEMD_USER_UNAVAILABLE'`, `exitCode: 69`, `reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout'`) with an actionable message.
  - **No silent fallback**: MUST NEVER fall back to `crontab`, `at`, a background Node `setInterval` daemon, or a no-op stub.
  - Pure read-side helpers (`resolveStateDir`, `resolveSchedulerEnvFilePath`, `probeStateDirObservability`, `readTaskManifest`, `readTaskWitness`, `readTaskLockSummary`, `readLastSkipEntry`, `parseSchedulerEnvFile`, `readSchedulerEnvFile`, `evaluateTaskHealth`) do NOT require `systemd --user` and work everywhere (including inside `bwrap` agent sandboxes).

### 3.4 Host PID namespace guarantee and isolation

Carried directly from `DESIGN-r4.md:199-203` (verified against `bwrap --unshare-pid` on the target host):

`assertHostPidNamespace()` passes **only** when ALL three cumulative conditions hold on Linux (any unreadable file or mismatch = isolated = fail-closed `PolicyRefusalError`, exit `77`):
1. `readlinkSync('/proc/self/ns/pid') === 'pid:[4026531836]'` (kernel `PROC_PID_INIT_INO = 0xEFFFFFFC`).
2. `statSync('/proc/1').uid === 0` (`root`; under `bwrap` or `PrivateUsers=`, `/proc/1` is owned by an unprivileged UID).
3. `/proc/1/comm` trimmed is `'systemd'` or `'init'` (never `'bwrap'`, `'tini'`, `'dumb-init'`, `'sh'`, `'bash'`, `'node'`) **AND** `/proc/1/cgroup` contains `0::/init.scope` (never `user.slice`, `docker`, `kubepods`, or container slices).

`NSpid` in `/proc/self/status` is **explicitly NOT used** as proof (`DESIGN-r4.md:203`).

**Process and network isolation**:
- Never runs inside an agent `bwrap` sandbox (systemd `--user` spawns directly in the host PID namespace under `user@<uid>.service`, and the runner verifies the proof **before any lock operation** on every tick).
- Strictly isolated from the LLM gateway (`h2a` `gateway-host`, `127.0.0.1:3002`) and the central MCP bus (`h2a-mcp-central.service`): zero shared process, zero shared memory, zero sockets in `@sentropic/local-scheduler` (static guard), and kernel-enforced `RestrictAddressFamilies=AF_UNIX` blocking all TCP/UDP connections from the spawned child process.

---

## 4. Consumer API for `h2a` (frozen for parallel H1 development)

### 4.1 Ownership boundary and lock scope

| Concern | Owner |
|---|---|
| Task spec validation, `systemd --user` unit generation/lifecycle, host PID guard, global/per-task/alias kill-switch & env-file parser, fail-closed single-writer **per-task** lock, child timeout/process-group signaling, log rotation, atomic `last-run.json` witness, pure dead-man/pause health evaluation, fake adapter for consumer tests | **`@sentropic/local-scheduler`** (in `sentropic`) |
| CLI session discovery (Claude, Vibe, etc.), copy vs quarantine barriers, live-session probes, `.tar.gz` + SHA-256 verification, versioned archive index, **data-level single-writer lock on the archive repository and index**, `h2a archive scan\|run\|verify\|list\|restore`, automatic restore in `h2a resume` / `h2a run --resume`, Claude 90-day purge deadline calculation (main transcript `mtime` per `REVIEW-opus-r4.md:108-116`), disk free-space guard `min(10 Go, 5%) + session size`, user-facing CLI & banners | **`@sentropic/h2a-runtime`** (in `h2a`) |

- **Lock scope guarantee**: the scheduler lock serialises runs of **one `taskId`**; data-level single-writer protection on the shared archive repository and index stays in `h2a` (so adding a future second task such as `h2a-session-archive-vibe` cannot corrupt the shared archive index).
- **Archive repository lock requirement in `h2a`**: inspection of `h2a` `origin/main` confirms `packages/h2a-runtime/src/file-lock.ts:13-16` is **intentionally best-effort** (*"when it cannot be taken within the wait budget the caller proceeds anyway (last-writer-wins)… not mutual exclusion you may build a safety property on"*). For the archive repository and index, `h2a` MUST use a **fail-closed** lock (modelled on `packages/h2a/src/runtime/local-files/locks.ts:14-27` and `succession-lock.ts:789-830,862-916`), never `file-lock.ts`'s best-effort takeover.

### 4.2 Complete normative TypeScript API & error codes

The `h2a` conductor can code and test Lot H1 in parallel against these exact frozen signatures (using `createFakeSchedulerAdapter({ stateDir })` before `@sentropic/local-scheduler@0.1.0` is published):

#### Error code → exit code mapping

| `LocalSchedulerErrorCode` | Class | Exit code |
|---|---|---:|
| `INVALID_TASK_SPEC`, `INTERVAL_MISMATCH` | `InvalidTaskSpecError` | `2` |
| `UNMANAGED_UNIT` | `UnmanagedUnitError` | `2` |
| `MANIFEST_CORRUPT` | `ManifestCorruptError` | `2` |
| `TASK_NOT_FOUND` | `TaskNotFoundError` | `2` |
| `SYSTEMD_USER_UNAVAILABLE` | `SchedulerUnavailableError` | `69` |
| `SYSTEMCTL_FAILED` | `SystemctlFailedError` | `70` |
| `RUNNER_INTERNAL_ERROR` | *(runner `RunScheduledTaskResultV1.error` only; no error class)* | `70` |
| `POLICY_REFUSED_SANDBOX`, `POLICY_REFUSED_ALLOWLIST`, `POLICY_REFUSED_FILE_MODE`, `POLICY_REFUSED_STATE_DIR` | `PolicyRefusalError` | `77` |

```ts
// --- @sentropic/local-scheduler (root entrypoint) ---

export type LocalSchedulerErrorCode =
  | 'SYSTEMD_USER_UNAVAILABLE'
  | 'INVALID_TASK_SPEC'
  | 'INTERVAL_MISMATCH'
  | 'UNMANAGED_UNIT'
  | 'POLICY_REFUSED_SANDBOX'
  | 'POLICY_REFUSED_ALLOWLIST'
  | 'POLICY_REFUSED_FILE_MODE'
  | 'POLICY_REFUSED_STATE_DIR'
  | 'MANIFEST_CORRUPT'
  | 'TASK_NOT_FOUND'
  | 'SYSTEMCTL_FAILED'
  | 'RUNNER_INTERNAL_ERROR';

export class LocalSchedulerError extends Error {
  readonly code: LocalSchedulerErrorCode;
  readonly exitCode: 2 | 69 | 70 | 77;
  constructor(code: LocalSchedulerErrorCode, exitCode: 2 | 69 | 70 | 77, message: string, options?: ErrorOptions);
}

export class SchedulerUnavailableError extends LocalSchedulerError {
  override readonly code: 'SYSTEMD_USER_UNAVAILABLE';
  readonly reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout';
  override readonly exitCode: 69;
}

export class InvalidTaskSpecError extends LocalSchedulerError {
  override readonly code: 'INVALID_TASK_SPEC' | 'INTERVAL_MISMATCH';
  readonly field?: string;
  override readonly exitCode: 2;
}

export class UnmanagedUnitError extends LocalSchedulerError {
  override readonly code: 'UNMANAGED_UNIT';
  readonly unitPath: string;
  override readonly exitCode: 2;
}

export class PolicyRefusalError extends LocalSchedulerError {
  override readonly code:
    | 'POLICY_REFUSED_SANDBOX'
    | 'POLICY_REFUSED_ALLOWLIST'
    | 'POLICY_REFUSED_FILE_MODE'
    | 'POLICY_REFUSED_STATE_DIR';
  readonly refusal: LocalTaskRefusalReasonV1;
  override readonly exitCode: 77;
}

export class ManifestCorruptError extends LocalSchedulerError {
  override readonly code: 'MANIFEST_CORRUPT';
  readonly manifestPath: string;
  override readonly exitCode: 2;
}

export class TaskNotFoundError extends LocalSchedulerError {
  override readonly code: 'TASK_NOT_FOUND';
  readonly taskId: string;
  override readonly exitCode: 2;
}

export class SystemctlFailedError extends LocalSchedulerError {
  override readonly code: 'SYSTEMCTL_FAILED';
  readonly command: readonly string[];
  readonly stderr: string;
  readonly rolledBack: boolean;
  override readonly exitCode: 70;
}
```

```ts
export interface EnablePolicyV1 {
  /** Trampoline entry written into systemd ExecStart (bin + args + [taskId]). */
  readonly runner: LocalTaskRunnerEntryV1;
  /** Canonical absolute paths of allowed executables (e.g. ['/usr/bin/node']). */
  readonly allowedBins: readonly string[];
  /**
   * Canonical absolute paths of allowed entry scripts when bin is a Node.js interpreter.
   * A binary `bin` is a Node interpreter when `realpathSync(bin) === realpathSync(process.execPath)`
   * OR `path.basename(realpathSync(bin)) === 'node'`. Mandatory whenever runner.bin or
   * spec.command.bin is a Node interpreter (§6.5).
   */
  readonly allowedScripts?: readonly string[];
  /** Default: ${XDG_CONFIG_HOME ?? ~/.config}/systemd/user. Tests use $XDG_RUNTIME_DIR/systemd/user. */
  readonly unitDir?: string;
  /** Default: resolveStateDir(). */
  readonly stateDir?: string;
  /** Default: resolveSchedulerEnvFilePath(). Resolved once at enable and pinned in manifest + unit. */
  readonly envFilePath?: string;
  /** When true, uses `systemctl --user --runtime enable/disable` (ephemeral qualification mode). */
  readonly runtime?: boolean;
}

export interface EnableResultV1 {
  readonly manifest: LocalTaskManifestV1;
  readonly servicePath: string;
  readonly timerPath: string;
  readonly lingerEnabled: boolean | null;
  readonly lingerNotice?: string;
}

export interface DisableResultV1 {
  readonly taskId: string;
  readonly manifest: LocalTaskManifestV1;
}

export interface UninstallOptionsV1 {
  readonly purgeState?: boolean;
  readonly unitDir?: string;
  readonly stateDir?: string;
  readonly runtime?: boolean;
}

export interface UninstallResultV1 {
  readonly taskId: string;
  readonly removedUnits: readonly string[];
  readonly purgedState: boolean;
}

export interface SystemdRuntimeStateV1 {
  readonly timerUnitFileState: string;
  readonly timerActive: string;
  readonly nextElapse: string | null;             // from NextElapseUSecRealtime
  readonly lastTrigger: string | null;            // from LastTriggerUSec
  readonly lastTriggerMonotonicUs: number | null; // from LastTriggerUSecMonotonic
  readonly serviceActive: string;
  readonly serviceResult: string | null;          // from Result
  readonly execMainStatus: number | null;         // from ExecMainStatus
  readonly execMainExitTimestamp: string | null;  // from ExecMainExitTimestamp
  /** Set when execMainStatus === 203 (EXIT_EXEC) or 77 (allow-list refusal vs pre-lock guard/mode refusal). */
  readonly execDiagnostic?: string;
}

export interface LocalTaskStatusV1 {
  readonly manifest: LocalTaskManifestV1 | null | 'corrupt';
  readonly witness: LocalTaskWitnessV1 | null | 'corrupt';
  readonly lock?: LocalTaskLockSummaryV1 | null | 'unreadable';
  readonly lastSkip?: LocalTaskSkipEntryV1 | null;
  readonly health: LocalTaskHealthVerdict;
  readonly systemd: SystemdRuntimeStateV1 | 'unavailable';
  readonly lingerEnabled: boolean | null;
}

export interface OsSchedulerAdapter {
  /** Writes manifest.json with enabled: true ONLY after systemctl enable --now succeeds; keeps previous manifest on SYSTEMCTL_FAILED. */
  enable(spec: LocalTaskSpecV1, policy: EnablePolicyV1): Promise<EnableResultV1>;
  /** Throws TaskNotFoundError (exit 2) when manifest is missing. */
  disable(taskId: string, opts?: { readonly unitDir?: string; readonly stateDir?: string; readonly runtime?: boolean }): Promise<DisableResultV1>;
  /** Never throws for a missing task (returns manifest: null, health.status: 'not_installed'). */
  status(taskId: string, opts?: { readonly stateDir?: string; readonly nowIso?: string }): Promise<LocalTaskStatusV1>;
  /** Idempotent: succeeds with removedUnits: [] if already absent; still throws UnmanagedUnitError on unmanaged files. */
  uninstall(taskId: string, opts?: UninstallOptionsV1): Promise<UninstallResultV1>;
}

export interface FakeSchedulerAdapter extends OsSchedulerAdapter {
  /** Test helper: writes a witness (or corrupt bytes / unlink on null) into stateDir using production writers. */
  setWitness(taskId: string, witness: LocalTaskWitnessV1 | null | 'corrupt'): void;
  /** Test helper: writes persisted env-file contents to envFilePath using production writers. */
  setPersistedEnvFile(text: string): void;
  /** Test helper: simulate systemd availability or linger state. */
  setSystemdState(state: SystemdRuntimeStateV1 | 'unavailable', lingerEnabled?: boolean | null): void;
  /** Test helper: inspect rendered unit texts for assertions. */
  getRenderedUnits(taskId: string): { readonly service: string; readonly timer: string } | null;
}
```

```ts
// Pure & read-side functions exported from '@sentropic/local-scheduler':
export function resolveStateDir(env?: NodeJS.ProcessEnv): string;
export function resolveSchedulerEnvFilePath(env?: NodeJS.ProcessEnv): string;
export function probeStateDirObservability(stateDir: string): StateDirObservabilityResult;
export function readTaskManifest(stateDir: string, taskId: string): LocalTaskManifestV1 | null | 'corrupt';
export function readTaskWitness(stateDir: string, taskId: string): LocalTaskWitnessV1 | null | 'corrupt';
export function readTaskLockSummary(stateDir: string, taskId: string): LocalTaskLockSummaryV1 | null | 'unreadable';
export function readLastSkipEntry(stateDir: string, taskId: string): LocalTaskSkipEntryV1 | null;
export function parseSchedulerEnvFile(text: string): Readonly<Record<string, string>>;
export function readSchedulerEnvFile(envFilePath?: string): Readonly<Record<string, string>> | null;
export function evaluateKillSwitch(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, 'taskId' | 'killSwitchEnv'>,
): LocalTaskKillSwitchMatchV1 | null;
export function isTaskKillSwitchActive(
  env: Readonly<Record<string, string | undefined>>,
  spec: Pick<LocalTaskSpecV1, 'taskId' | 'killSwitchEnv'>,
): boolean;
export function evaluateTaskHealth(input: EvaluateTaskHealthInput): LocalTaskHealthVerdict;
export function validateTaskSpec(spec: unknown): LocalTaskSpecV1;
export function assertHostPidNamespace(): void;
export function createFakeSchedulerAdapter(opts?: {
  readonly clock?: () => string;
  readonly stateDir?: string;
  readonly envFilePath?: string;
}): FakeSchedulerAdapter;

// --- @sentropic/local-scheduler/systemd ---
export function createSystemdUserAdapter(opts?: { readonly stateDir?: string; readonly envFilePath?: string }): OsSchedulerAdapter;
export function renderSystemdUnits(manifest: Omit<LocalTaskManifestV1, 'units'>): {
  readonly service: string;
  readonly timer: string;
  readonly serviceSha256: string;
  readonly timerSha256: string;
};
export function probeSystemdUserAvailability(): Promise<
  | { readonly available: true; readonly systemdVersion: string }
  | { readonly available: false; readonly reason: 'not-linux' | 'no-systemctl' | 'no-user-manager' | 'timeout'; readonly detail: string }
>;
export function computeExpectedIntervalMs(onCalendar: string): Promise<number>;

// --- @sentropic/local-scheduler/runner ---
export interface RunScheduledTaskOptionsV1 {
  readonly allowedBins: readonly string[];
  readonly allowedScripts?: readonly string[];
  readonly stateDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface RunScheduledTaskResultV1 {
  readonly outcome: LocalTaskOutcomeV1 | 'skipped_locked' | 'not_run';
  readonly exitCode: 0 | 1 | 2 | 70 | 77 | 124 | 130 | 143;
  /** Populated whenever the lock holder wrote last-run.json; null on skipped_locked, pre-lock sandbox refusal, not_run, or post-child witness write failure. */
  readonly witness: LocalTaskWitnessV1 | null;
  /** Always set when outcome === 'not_run', and set on refused_policy / RUNNER_INTERNAL_ERROR (exit 70). */
  readonly error?: { readonly code: LocalSchedulerErrorCode; readonly message: string };
}

/** Never rejects: all validation, manifest, policy, and I/O failures resolve to a structured RunScheduledTaskResultV1 (pre-witness lock I/O failure → not_run exit 70; post-child write failure → child outcome, exit 70, witness: null, RUNNER_INTERNAL_ERROR). */
export function runScheduledTask(manifest: LocalTaskManifestV1, opts: RunScheduledTaskOptionsV1): Promise<RunScheduledTaskResultV1>;
/** Never rejects: resolves to outcome: 'not_run' (exit 2/70/77) if manifest is missing, corrupt, unreadable, or fails pre-witness lock/stateDir checks. */
export function runScheduledTaskById(taskId: string, opts: RunScheduledTaskOptionsV1): Promise<RunScheduledTaskResultV1>;
```

**Fake adapter contract (`createFakeSchedulerAdapter`)**:
- Creates `stateDir` (`0700`) at construction (`m-32(c)`), so `not_installed` is reachable in consumer tests run inside a container (otherwise `probeStateDirObservability` returns `unobservable` for an absent directory there).
- When constructed with `{ stateDir }` (and optional `envFilePath`, defaulting to `path.join(stateDir, 'env')`), `enable()`, `disable()`, `uninstall()`, `setWitness()`, and `setPersistedEnvFile()` **write real files to disk using the production writers** (`manifest.json`, `last-run.json`, env file).
- Fake `status()` uses the same `probeStateDirObservability`, `readTaskLockSummary`, `readLastSkipEntry`, and env-file override detection as production `SystemdUserAdapter.status()` (`m-32(c)`).
- Consequently, consumer read paths (`readTaskManifest`, `readTaskWitness`, `readTaskLockSummary`, `readLastSkipEntry`, `readSchedulerEnvFile`, `probeStateDirObservability`) in tests observe the exact state mutated by the fake adapter.
- The fake adapter skips **only** `systemd --user` invocations and the host PID namespace guard; all validation, allow-list, shebang, dangerous-env, unit rendering, and health-evaluation logic executes identically to production.

**State-directory and env-file pinning rules**:
- `resolveStateDir(env)` returns `env.SENTROPIC_LOCAL_SCHEDULER_STATE_DIR` if non-empty, else `path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'sentropic', 'local-scheduler')`.
- `resolveSchedulerEnvFilePath(env)` returns `path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'sentropic', 'local-scheduler', 'env')`.
- `enable()` resolves both `stateDir` and `envFilePath` once, stores both in `manifest.json`, and emits `Environment="SENTROPIC_LOCAL_SCHEDULER_STATE_DIR=<escaped-abs-path>"` and `EnvironmentFile=-<escaped-abs-path>` in the `.service` unit. Because `EnvironmentFile=` overrides `Environment=` in `systemd.exec(5)` (`m-30`), the runner refuses (`outcome: 'not_run'`, exit `77`, `POLICY_REFUSED_STATE_DIR`) if `manifest.stateDir !== resolvedStateDir`, constructs child `PATH` as the constant `'/usr/bin:/bin'`, and `status()` / §4.4 emit a hint when the env file defines `PATH` or `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`.
- Readers read the env file from `manifest.envFilePath` whenever a valid manifest is present, falling back to `resolveSchedulerEnvFilePath(env)` only when there is no valid manifest.

### 4.3 Registration, dependency placement, and `h2a` descriptor

- **Dependency placement**: add `"@sentropic/local-scheduler": "^0.1.0"` to **`packages/h2a-runtime/package.json`** (`dependencies`), because `h2a status` (`packages/h2a-runtime/src/status-projection.ts`), `h2a resume` (`packages/h2a-runtime/src/index.ts:5544` on `bed33a0eb990`; was `:5519` on `f025cd2d8ccf`), and CLI command routing live in `@sentropic/h2a-runtime`. Add it to `packages/h2a/package.json` ONLY if `packages/h2a` directly imports it.
- **CLI surface exposed by `h2a`**:
  - `h2a archive schedule enable [--calendar <expr>] [--older-than <N>d]`
  - `h2a archive schedule disable`
  - `h2a archive schedule status [--json]`
  - `h2a archive schedule uninstall [--purge-state]`
  - Hidden runner trampoline: `h2a archive _schedule-exec <taskId>`

#### Canonical `h2a` registration descriptor & policy (Lot 1 — Claude Code)

```ts
import { realpathSync } from 'node:fs';
import { createSystemdUserAdapter } from '@sentropic/local-scheduler/systemd';
import {
  ON_CALENDAR_PRESETS,
  ON_CALENDAR_CUSTOM_REGEX,
  type EnablePolicyV1,
  type LocalTaskSpecV1,
} from '@sentropic/local-scheduler';

const nodeBin = realpathSync(process.execPath);        // e.g. '/usr/bin/node'
const h2aBinScript = realpathSync(process.argv[1]!);   // e.g. '/home/user/.npm-global/lib/node_modules/@sentropic/h2a/dist/bin.js'

const capturedEnv: Record<string, string> = {
  H2A_ROOT: resolveActiveH2aRoot(),                    // e.g. '/home/user/src/a2a-cli' (contrib/systemd/README.md:49-50)
  ...(process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {}),
};

const spec: LocalTaskSpecV1 = {
  v: 1,
  taskId: 'h2a-session-archive',
  owner: 'h2a',
  description: 'h2a local CLI session archive (conservation-only)',
  schedule: {
    onCalendar: calendarFlag ?? 'daily',               // validated via ON_CALENDAR_PRESETS / ON_CALENDAR_CUSTOM_REGEX
    persistent: true,
    randomizedDelaySec: 600,
    accuracySec: 60,
    graceMultiplier: 1.5,                              // 36 h dead-man window for daily
  },
  command: {
    bin: nodeBin,
    args: [
      h2aBinScript,
      'archive', 'run',
      '--cli', 'claude',
      '--older-than', olderThanFlag ?? '14d',
      '--max-duration', '1440s',                       // soft budget = 80% of 1800s timeout (see X-2 below)
      '--scheduled',
    ],
    env: capturedEnv,                                  // stored in manifest.json ONLY, never in .service unit
  },
  timeoutMs: 1_800_000,                                // 30 min hard cap
  killGraceMs: 15_000,
  killSwitchEnv: 'H2A_ARCHIVE_OFF',
  resources: {
    nice: 15,
    ioSchedulingClass: 'idle',
    memoryMax: '512M',
    cpuQuota: '50%',
    tasksMax: 64,
  },
};

const policy: EnablePolicyV1 = {
  runner: { bin: nodeBin, args: [h2aBinScript, 'archive', '_schedule-exec'] },
  allowedBins: [nodeBin],
  allowedScripts: [h2aBinScript],
};

const adapter = createSystemdUserAdapter();
const result = await adapter.enable(spec, policy);
```

When Lot 2 (Mistral Vibe, `7.71 Go` raw backlog) lands, `--max-duration` at 80% of `timeoutMs` guarantees each scheduled pass makes bounded progress and exits `0` (`succeeded`) instead of tripping `timed_out`/`critical`.

### 4.4 Exact `h2a` wiring call sequences

1. **`h2a archive schedule enable|disable|status|uninstall`**:
   - Instantiate `adapter = injectedAdapter ?? createSystemdUserAdapter()` (accepting `FakeSchedulerAdapter` in tests).
   - `enable`: pre-validate `--calendar` against `ON_CALENDAR_PRESETS` / `ON_CALENDAR_CUSTOM_REGEX`, construct `spec` + `policy` above → `await adapter.enable(spec, policy)` → print confirmation + `result.lingerNotice` if `lingerEnabled === false`. On `LocalSchedulerError`, print `err.message` to `stderr` and set `process.exitCode = err.exitCode` (`2` / `69` / `70` / `77`).
   - `disable`: `await adapter.disable('h2a-session-archive')` (handles `TaskNotFoundError` exit `2`).
   - `status [--json]`: `const st = await adapter.status('h2a-session-archive')`; print JSON or human summary (including `st.systemd.execDiagnostic` if present and `st.health.hints`).
   - `uninstall [--purge-state]`: `await adapter.uninstall('h2a-session-archive', { purgeState })`.
2. **`h2a archive _schedule-exec <taskId>`**:
   ```ts
   import { realpathSync } from 'node:fs';
   import { runScheduledTaskById } from '@sentropic/local-scheduler/runner';

   const nodeBin = realpathSync(process.execPath);
   const h2aBinScript = realpathSync(process.argv[1]!);
   // runScheduledTaskById never rejects; pre-lock / manifest / internal errors return outcome: 'not_run' + error.
   const res = await runScheduledTaskById(taskId, {
     allowedBins: [nodeBin],
     allowedScripts: [h2aBinScript],
   });
   if (res.error) process.stderr.write(`[local-scheduler] ${res.error.code}: ${res.error.message}\n`);
   process.exitCode = res.exitCode; // 0 | 1 | 2 | 70 | 77 | 124 | 130 | 143
   ```
3. **`h2a status` (`packages/h2a-runtime/src/status-projection.ts`) & `h2a resume` (`packages/h2a-runtime/src/index.ts:5544`)**:
   ```ts
   import {
     resolveStateDir, resolveSchedulerEnvFilePath, probeStateDirObservability,
     readTaskManifest, readTaskWitness, readTaskLockSummary, readLastSkipEntry,
     readSchedulerEnvFile, evaluateKillSwitch, evaluateTaskHealth,
   } from '@sentropic/local-scheduler';

   const stateDir = resolveStateDir(process.env);
   const { observable } = probeStateDirObservability(stateDir);
   const manifest = observable ? readTaskManifest(stateDir, 'h2a-session-archive') : null;
   const witness = observable ? readTaskWitness(stateDir, 'h2a-session-archive') : null;
   const lock = observable ? readTaskLockSummary(stateDir, 'h2a-session-archive') : null;
   const lastSkip = observable ? readLastSkipEntry(stateDir, 'h2a-session-archive') : null;
   const envFilePath = manifest && manifest !== 'corrupt'
     ? manifest.envFilePath
     : resolveSchedulerEnvFilePath(process.env);
   const persistedEnv = readSchedulerEnvFile(envFilePath);
   const envFileProtectedOverrides = persistedEnv
     ? (['PATH', 'SENTROPIC_LOCAL_SCHEDULER_STATE_DIR'] as const).filter((k) => k in persistedEnv)
     : [];
   const specRef = manifest && manifest !== 'corrupt'
     ? manifest.spec
     : { taskId: 'h2a-session-archive', killSwitchEnv: 'H2A_ARCHIVE_OFF' };

   const health = evaluateTaskHealth({
     stateDirObservable: observable,
     manifest,
     witness,
     persistedKillSwitch: persistedEnv ? evaluateKillSwitch(persistedEnv, specRef) : null,
     readerEnvKillSwitch: evaluateKillSwitch(process.env, specRef),
     lock,
     lastSkip,
     envFileProtectedOverrides,
     nowIso: new Date().toISOString(),
   });
   ```
   - Combine `health` with `h2a`'s own read-time checks: Claude main-transcript `mtime` purge deadline scan (`< 14` days remaining, `REVIEW-opus-r4.md:108-116`) and `~/.local/share/h2a/session-archives/alerts.json`.
   - **Rendering rules**:
     - `healthy` / `pending_first_run`: silent in default `h2a resume`; one compact line in `h2a status` (`archive-schedule: ok (last run 6h ago)`).
     - `not_installed`: one compact hint in `h2a status` (`archive-schedule: not installed (run h2a archive schedule enable)`).
     - `disabled`: terse line in `h2a status` (`archive-schedule: disabled`).
     - `paused`: notice in `h2a status` (`archive-schedule: paused since <ts> by <var>`), upgraded to warning banner on `stderr` when `severity === 'warning'` (overdue pause).
     - `unobservable` / `interrupted`: concise warning in `h2a status` (never silent, never false `schedule_missed`).
     - `failing` / `schedule_missed` / `clock_skew` / `witness_corrupt`: **prominent warning/critical banner** on `stderr` in both `h2a status` and `h2a resume`, printing status, age since `lastSuccessAt`, `consecutiveFailures`, `hints`, and next action (`h2a archive schedule status` / `journalctl --user -u sentropic-task-h2a-session-archive.service`).

#### Cross-lane alignment notes forwarded to the `h2a` conductor (non-gating for this spec)

These four points were surfaced between the r2 spec and `h2a` Lot 1 (`PR #558`) and must be reconciled in `h2a` Lot H1 before wiring cutover:
- **X-1 (Archive repository lock)**: `h2a` Lot 1 currently takes `archive.lock` via best-effort `file-lock.ts`; migrate it to a fail-closed lock (`local-files/locks.ts` / `succession-lock.ts`) before adding a second scheduled archive task. Until then, `@sentropic/local-scheduler`'s namespace-aware per-task lock (§2.3) is the sole fail-closed serialisation of archive passes.
- **X-2 (`--max-duration` CLI flag)**: `h2a` Lot 1 `archive run` does not yet accept `--max-duration` (Commander rejects unknown options by default). Either add `--max-duration` in H1(a) before wiring, or omit it from the Lot 1 descriptor until implemented.
- **X-3 (Single dead-man witness)**: Lot 1 writes its own engine `last-run.json`; designate `LocalTaskWitnessV1` as the single dead-man source for `h2a status`/`h2a resume`, reserving the engine file for archive pass statistics only.
- **X-4 (Single CLI entry point)**: unify `h2a archive pass` vs `h2a archive run --once|--scheduled` to one documented entry point matching the descriptor (`run ... --scheduled`).

---

## 5. Optional `@sentropic/cluster-mesh` capitalisation (GATED)

### 5.1 Alignment with `OpsJobFailureV1` (`origin/main`)

In `packages/cluster-mesh/src/notifications/` and `api/src/services/notifications/`:
- `ops-job-failure-types.ts:17,20,39` closes `OpsJobFailureSourceV1 = 'k8s' | 'app'`, `OpsJobFailureOutcomeV1 = 'failed' | 'succeeded' | 'heartbeat'`, and `OpsJobKindV1 = 'CronJob' | 'Job' | 'app-job'`.
- `ops-job-failure-types.ts:27-35` already defines `'job-failed'`, `'deadline-exceeded'`, `'schedule-missed'`, `'stale'`.
- `ops-job-failure-types.ts:57-58,90-94` and `ops-job-failure-contract.ts:52,108,142-168` enforce `source`, `eventId.startsWith(`${source}:`)`, unique `eventId` fingerprint (409 conflict on same `eventId` with different bytes), closed top-level key set (`:142-143` rejects unknown top-level fields), required lowercase `targetKey`, `jobRef.kind` (`:52` rejects unknown kinds), `runId`, and `https://`-only `links`.
- **Dead-man watch behaviour (`incident-policy.ts:45-46,67-82`, `incident-state.ts:58-65,105-108`, `ops-sweep.ts:283-288`)**:
  - A `succeeded` event with no prior incident state is a **no-op** (*"Never create a watch where none existed"*, `incident-policy.ts:67-82`).
  - Only a **`heartbeat`** event opens a dormant watch (`openDormantWatch`, `incident-policy.ts:45-46`, `incident-state.ts:105-108`).
  - `DEFAULT_OPS_NOTIFICATION_POLICY_V1.heartbeatGraceMs` is a single global `1 h` (`60 * 60 * 1000`, `incident-state.ts:58-65`), evaluated by `ops-sweep.ts:283-288` via `isOpsHeartbeatOverdue()` (`incident-schedule.ts:36-44`). Consequently, emitting a `heartbeat` for a daily task without a per-watch grace override would false-alarm `stale` after 1 hour.

### 5.2 Additive extension specification (Lot S3 — gated, Option A)

When opened, the extension in `@sentropic/cluster-mesh/notifications` (and `ops-sweep.ts`) is strictly **additive and backwards-compatible** (`v: 1` preserved):
- `OpsJobFailureSourceV1 = 'k8s' | 'app' | 'local'`
- `OpsJobKindV1 = 'CronJob' | 'Job' | 'app-job' | 'local-timer'`
- Validator `ops-job-failure-contract.ts:52,147` updated to accept `'local'` and `'local-timer'`.
- **Per-watch heartbeat grace override (`m-32(h)` wire-safe server-side map)**:
  - Because `ops-job-failure-contract.ts:142-143` rejects unknown top-level fields on `OpsJobFailureV1` and `:52` rejects unknown kinds, **prefer a server-side per-source/per-watch grace map** read by `isOpsHeartbeatOverdue()` and `ops-sweep.ts:283-288` (changing nothing on the wire), defaulting to `policy.heartbeatGraceMs` (`1 h`) when absent so all existing `'k8s'`/`'app'` watches are unchanged.
  - For local timers, set the grace to **`>= deadlineMs`** (e.g. `36 h` for a daily timer with `graceMultiplier: 1.5`), preventing 1-hour false `stale` alerts.
  - **Mandatory rollout order (`m-32(h)`)**: deploy the **central receiver first** (accepting `'local'`, `'local-timer'`, and the server-side grace map), **then** enable the `h2a` emitter.
- **Emitter & timing**: `h2a` (not `@sentropic/local-scheduler`, which stays 100% network-free) emits post-run events when central alerting is enabled:
  - Outcome event for `succeeded`, `failed`, `timed_out`, `refused_policy` (never `skipped_disabled` / `skipped_locked`).
  - **Plus**, after each completed pass (on `succeeded`, and optionally on `skipped_disabled` if the owner wants active pauses to keep the watch alive without firing), emit a **`heartbeat`** event (`eventId: local:<hostSlug>:<taskId>:<runId>:heartbeat`, `runId: witness.runId`) so central `incident-policy.ts:45-46` arms/refreshes the dormant watch and `ops-sweep.ts` detects off-host silence past `>= deadlineMs` as `reason: 'stale'`.
- **Decoupled pure projection helper** (lives in `@sentropic/cluster-mesh/notifications`, accepts a **structural input interface** — never imports `@sentropic/local-scheduler`, preserving **D1=B**):
  - `eventId`: `local:<hostSlug>:<taskId>:<runId>:<outcome>` for outcome events and `local:<hostSlug>:<taskId>:<runId>:heartbeat` for heartbeats (unique per emitted event; prevents 409 fingerprint conflicts at `ops-job-failure-types.ts:90-94`).
  - `runId`: mapped directly from `witness.runId` (UUIDv4).
  - `targetKey`: supplied from an explicit declared `h2a` config key (e.g. `opsTargetKey: 'h2a-local-archive'`, validated against `TARGET_KEY_PATTERN` at `ops-job-failure-contract.ts:153`).
  - `jobRef`: `{ namespace: hostSlug, kind: 'local-timer', name: taskId }`.
  - `links`: omitted (local paths are never valid `https://` URLs and must not leak workstation layout).
  - Mapping:
    - `outcome === 'succeeded'` → `outcome: 'succeeded'` (resolves any firing incident; paired with `heartbeat` event to arm/refresh the dormant watch)
    - `outcome === 'timed_out'` → `outcome: 'failed'`, `reason: 'deadline-exceeded'`, `severity: 'critical'`
    - `outcome === 'refused_policy'` → `outcome: 'failed'`, `reason: 'job-failed'`, `severity: 'critical'`
    - `outcome === 'failed'` → `outcome: 'failed'`, `reason: 'job-failed'`, `severity: consecutiveFailures >= 2 ? 'critical' : 'warning'`

### 5.3 Explicit opportunity condition ("si opportun")

Lot S3 remains **GATED** and is **NOT** on the critical path to `2027-01-10`. It opens only if:
1. The owner explicitly asks for **off-host / email / central ops alerts** for workstation scheduled tasks (beyond local `h2a status` / `h2a resume` banners); **OR**
2. At least **two workstations or two local consumers** require centralised failure visibility in `cluster-mesh`.

Multi-workstation archive catalogue / remote encrypted replication remains separately gated on `interServerDirectory` and `memoryReplication` (`packages/cluster-mesh/src/mesh.ts:82-84`) plus a dedicated encryption/data-residency decision.

---

## 6. Security specification

| Control | Requirement | Verification |
|---|---|---|
| **6.1 Zero Python** | Zero `.py` files, zero Python invocations, zero Python deps in package, units, runner, or tests (owner global rule « 0 Python dans les repos et les jobs (k8s/CI) »; precedent `SPEC_EVOL_SANDBOX_NODE.md:71`; applied by this dossier to the workstation scheduled task). `python`/`python3` explicitly denylisted in command and shebang validators. | Static file/content lint + unit test asserting `python3` and `#!/usr/bin/python3` rejected. |
| **6.2 Zero Network** | `@sentropic/local-scheduler` opens zero sockets, binds zero ports, makes zero outbound requests, and forbids both imports (`node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, `undici`) AND network globals (`fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest`) in `src/**`. Spawned children under systemd are further kernel-isolated by `RestrictAddressFamilies=AF_UNIX` (§3.1). | Static AST/import + global-identifier Vitest guard on `packages/local-scheduler/src/**` + systemd negative test asserting child TCP connect to `127.0.0.1:3002` fails. |
| **6.3 File Modes `0700`/`0600`, shared unitDir safety & zero `/tmp`** | Every package-owned directory (`stateDir`, `locks`, `tasks/<id>`) is `0700`; every manifest, lock, quarantine, witness, `skips.jsonl`, `.tmp`, log, env file, and generated `.service`/`.timer` is `0600`. `UMask=0077` is fixed in `.service`. No files ever created in `/tmp`. For shared `~/.config/systemd/user/`, create `0700` ONLY if absent; never `chmod` an existing dir; refuse (`exit 77`) if not owned by current UID, symlinked, or `(mode & 0o022) !== 0`. Before running, runner verifies `stateDir` and `manifest.json` are owned by `process.getuid()`, not symlinks (`lstat`), and `(mode & 0o077) === 0` — else exit `77`. | Unit tests asserting modes, symlink/`0644`/`0777` manifest refusal, and existing `0755` `unitDir` preserved without `chmod` while `0775` `unitDir` refused. |
| **6.4 No Secrets in Units, Manifests, or Witness** | Static `.service` units embed only unit-default `PATH`, `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`, `EnvironmentFile=-<escaped-abs-path>`, and `UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT`. Because `EnvironmentFile=` overrides `Environment=` (`systemd.exec(5)`), the runner enforces `manifest.stateDir === resolvedStateDir` (else exit `77`, `POLICY_REFUSED_STATE_DIR`, `m-30`) and sets child `PATH` to the constant `'/usr/bin:/bin'` (never inherited, `m-30`). `command.env` lives in `manifest.json` (`0600`) only and is validated against the secret denylist (`*_TOKEN`, `*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_CREDENTIAL*`, `ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `AWS_*`, `GITHUB_TOKEN`, `NPM_TOKEN`) and `BLOCKED_LOADER_ENV_VARS`. Child `env` is constructed from minimal base (`HOME`, `USER`, constant `PATH: '/usr/bin:/bin'`, `XDG_*`, `LANG`, `LC_ALL`) + `manifest.spec.command.env` + `envAllowlist` + declared kill-switch var names, filtered through both denylists. Availability probe uses `systemctl --user show --property=Version --value` (never `show-environment`). Witness `summary` is capped at `512` UTF-8 bytes and stripped of control chars. | Unit tests injecting `ANTHROPIC_API_KEY` / `GITHUB_TOKEN` / `NODE_OPTIONS` into parent env, env file & `command.env`, plus `PATH` & `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR` override tests (`m-30`). |
| **6.5 Command Allow-List, Shebang Guard & Loader-Env Guard** | `bin` MUST be an absolute canonical path (`realpathSync`), regular file, executable by owner, owned by current UID or `root`, not group/world-writable (`(mode & 0o022) === 0`), matched against `allowedBins`. Mandatory denylist (`sh`, `bash`, `dash`, `zsh`, `fish`, `ksh`, `csh`, `env`, `python`, `python3`, `perl`, `ruby`, `awk`, `xargs`, `sudo`, `su`, `pkexec`, `doas`, `ssh`, `curl`, `wget`). **Shebang check**: for any non-ELF file (magic `!= 0x7f 45 4c 46`), read first 256 bytes, parse `#!`, unconditionally reject `#!/usr/bin/env` and relative interpreters, and apply the denylist to the interpreter. **Node scripts**: `bin` is a Node interpreter when `realpathSync(bin) === realpathSync(process.execPath)` or `path.basename(realpathSync(bin)) === 'node'`; then `args[0]` MUST be an absolute canonical script matching `allowedScripts` (regular file, owner/root, not group/world-writable; no `-e`/`--eval`/`-p`/`--print`/`-r`/`--require`/`--import` before script). Same rule applies to `policy.runner`. **Loader-env guard**: `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT` are rejected at `enable()` (`InvalidTaskSpecError`), stripped from child env at run time, and cleared via `UnsetEnvironment=` in `.service`. `spawn(..., { shell: false })` only. | Negative tests for relative paths, `/bin/sh`, `python3`, `#!/usr/bin/env node`, `#!/bin/sh` wrapper script, `node -e ...`, `NODE_OPTIONS` in env file / `command.env` / `envAllowlist`, world-writable binaries/scripts, symlink swaps. |
| **6.6 Injection-Safe Unit Generation** | Every interpolated field passes strict allow-lists; `\r`, `\n`, `\0`, and ASCII control chars are unconditionally rejected. `Description=` rejects `%` and `\`; no unit value may end in `\`. **Unified path rule** (`EnvironmentFile=`, `Environment=`, and path tokens in `ExecStart=`): reject control chars, `"` and `\`; escape `%` → `%%`; quote `Environment=` and `ExecStart=` values, while keeping `EnvironmentFile=-<escaped-abs-path>` unquoted and rejecting glob chars (`*`, `?`, `[`) per `systemd.exec(5)` / `systemd-analyze verify`. **Every `ExecStart=` token, path or not, escapes `$` → `$$` after the path checks** (`m-25`), and any `ExecStart=` argument equal to `;` is rejected (`systemd.service(5)`). `Environment=` and `EnvironmentFile=` keep `$` literal (`systemd.exec(5)`). Non-path `ExecStart=` argv tokens also escape `\` → `\\` and `"` → `\"` and are quoted. `OnCalendar=` is validated by `ON_CALENDAR_PRESETS` / `ON_CALENDAR_CUSTOM_REGEX` AND `systemd-analyze calendar --iterations=8 -- <expr>`. Every `execFile` call places `--` before variable arguments. | Adversarial tests: `daily\nExecStart=/bin/sh`, `%h`/`%u`, `%` and spaces in home/state/env-file paths (validated by `systemd-analyze verify`), glob chars in `envFilePath`, `$$` and `${X}` in script paths (`m-25`), lone `;` arg (`m-25`), `${H2A_ROOT}`, trailing `\`, leading `-` in `OnCalendar` and args, NUL bytes. |
| **6.7 Host PID Namespace** | Cumulative 3-part Linux proof (§3.4) enforced on `enable` and at runner step 2 **before any lock operation** (never exposed as a manifest setting). Isolated namespaces (`bwrap`, containers) fail closed with exit `77`, no lock touched, `last-run.json` untouched, and one best-effort `skips.jsonl` entry (`outcome: 'refused_policy', refusal: 'sandbox'`). | Negative test under `bwrap --unshare-pid --proc /proc` (host qualification) + injected `/proc` fixture tests (CI). |

---

## 7. Test plan, delivery lots, and calendar target

### 7.1 Executable test plan (Make-only, Docker-first + explicit host qualification)

Every CI test runs via `Makefile` targets inside Docker (`rules/MASTER.md:11-21`). No test ever mutates `~/.config/systemd/user/` or `~/.claude/`.

1. **Docker-first unit, runner & negative security suite (`make test-local-scheduler`, CI-mandatory in `$(LLM_MESH_NODE_IMAGE)`)**:
   - **Filesystem placement for positive lock-reclaim fixtures**: harness-style Docker targets put `mktemp -d` under container `/tmp` with `HOME=/tmp` (`Makefile:2361`), which sits on container overlayfs (unqualified by the `statfs` gate). Positive lock-reclaim tests therefore place their temporary fixture directories under the bind-mounted **`/workspace/.tmp/local-scheduler-test-<nonce>/`** (ext4 on both workstation and GitHub runners), cleaned up in `finally`. In addition, `statfs`, `bootId`, `/proc/<pid>/stat`, and PID/time namespace readers are injectable internal test seams (mirroring `h2a` `succession-lock.ts:360-361`) so every branch is deterministic.
   - **Contract, allow-list & loader-env guard**: valid specs, invalid `taskId`, invalid `OnCalendar` (leading `-`, `%`, trailing `\`), interval cross-check > 10% deviation, denylisted binaries (`sh`, `bash`, `python3`, `env`), `#!/usr/bin/env node` and `#!/bin/sh` shebang bypass rejection, `node -e` rejection, canonical `(nodeBin, scriptPath)` acceptance, `NODE_OPTIONS`/`NODE_PATH`/`LD_PRELOAD`/`LD_LIBRARY_PATH`/`LD_AUDIT` rejected in `command.env`/`envAllowlist` and stripped from child env.
   - **Injection-safe unit generator**: golden `.service`/`.timer` snapshots (including `SuccessExitStatus=130 143`, `NoNewPrivileges=yes`, `RestrictAddressFamilies=AF_UNIX`, `LockPersonality=yes`, `RestrictRealtime=yes`, `KillMode=mixed`, `TimeoutStopSec`, `UnsetEnvironment=NODE_OPTIONS NODE_PATH LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT`, pinned `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`, pinned `EnvironmentFile=-<escaped-abs-path>`); golden tests with **`%` and a space in the home/state/env-file path**, and **`$$` and `${X}` in the script path** (`m-25`); adversarial `${H2A_ROOT}`, `$HOME`, `$$`, lone `;` arg (`m-25`), newline, `%`-specifier, glob chars in `envFilePath`, trailing `\`, and unmanaged-unit header refusal; `0755` existing `unitDir` preserved without `chmod`, `0775` refused.
   - **Pure `evaluateTaskHealth()`, `probeStateDirObservability()` & `parseSchedulerEnvFile()` truth table**:
     - `probeStateDirObservability` cases (`m-32(b)`): (1) existing readable dir → `observable: true`; (2) `ENOENT` in host PID ns → `observable: true` (`not_installed`); (3) `ENOENT` outside host PID ns → `{ observable: false, reason: 'absent-outside-host-namespace' }` (`unobservable`); (4) regular file or symlink at `stateDir`, or `ENOTDIR` parent → `{ observable: false, reason: 'not-a-directory' }`; (5) `EACCES`/`EPERM` → `{ observable: false, reason: 'inaccessible' }`.
     - `unobservable`, `not_installed`, `disabled`, `pending_first_run`, `healthy`, `interrupted` (within grace → `warning`; repeated past grace → `schedule_missed`/`critical`), `failing` (`timed_out`/`refused_policy` → `critical`; single `failed` within `deadlineMs` → `warning`; 2nd+ `failed` → `critical`; **m-16**: single `failed` with `freshnessRefIso` past `deadlineMs` → `failing`/`critical`), `schedule_missed` (overdue & never-ran-past-grace), `clock_skew` (> 5 min future), `witness_corrupt`.
     - **B-2, m-16, m-28(b), m-30 & m-32(f) hint/pause cases**: (a) active pause (fresh `skipped_disabled` within `deadlineMs`, `lastSuccessAt` past 36 h) → `paused`/`warning`; (b) **m-16 stale pause** (`skipped_disabled` with `witness.finishedAt` past `deadlineMs`, dead timer) → `schedule_missed`/`critical` (with `m-32(f)` hint wording when `persistedKillSwitch` is set); (c) kill-switch set ONLY in reader process env with a failing witness → `failing` (hint added, never downgraded); (d) re-enable after long disable uses `enabledAt` → `pending_first_run`/`healthy`, never false `schedule_missed`; (e) **`m-28(b)` stuck lock**: `lastSkip.outcome === 'skipped_locked'` newer than `witness.finishedAt` + `lock` summary emits the stuck-lock hint without altering `status` or `severity`; (f) **`m-30` env-file override hint**: `envFileProtectedOverrides` emits hint for `PATH` / `SENTROPIC_LOCAL_SCHEDULER_STATE_DIR`.
   - **Fail-closed single-writer lock (B-1 + B-5 + m-31 mandatory cases)**:
     - Exclusive acquire/release; two-phase `phase: 'acquired'` → `'spawning'` → `'running'` + `childPid`/`childPgid` update preserving `nonce`; guard-lock `<taskId>.lock.reclaim` carries `phase: 'acquired'`, `childPgid: null`, never rewritten (`m-32(d)`).
     - **B-5 #1 (foreign `pidNs`)**: contender with a different `pidNs` faces a live holder (via injected namespace reader) → `skipped_locked`, lock bytes unchanged.
     - **B-5 #2 (sandboxed runner with free lock)**: host PID guard fails at step 2 → exit `77`, no lock file created, `last-run.json` byte-identical, one `skips.jsonl` line (`outcome: 'refused_policy', refusal: 'sandbox'`), no `skips.jsonl` rotation (`m-32(e)`).
     - **B-5 #3 (foreign `timeNs`)**: different `timeNs` with a `pidStartTime` mismatch → NO reclaim (`skipped_locked`).
     - **B-5 #4 (`phase: 'spawning'` crash)**: runner killed after `phase: 'spawning'` and before the post-spawn child rewrite → NO reclaim on same boot (`skipped_locked`); reclaimed only after boot change (rule (a)).
     - **m-31 #1 (unreadable/malformed current boot id)**: boot id unreadable or non-UUID → NO reclaim (`skipped_locked`).
     - **m-31 #2 (multi-threaded zombie)**: `/proc/<pid>/stat` state `Z` with `/proc/<pid>/status` `Threads: 2` (or non-`ESRCH`/`EPERM` `kill` error, or unreadable `/proc/<pid>/stat`) → NO reclaim (`skipped_locked`).
     - **Wall clock jumped past `timeoutMs` while PID alive** → NO reclaim (`skipped_locked`).
     - **Two concurrent reclaimers** → serialized by `<taskId>.lock.reclaim`, exactly one winner, quarantine copy `fsync`ed before `unlink`, mismatch branch aborts cleanly.
     - **Runner killed with `SIGKILL` while detached child group is still alive** → NO reclaim (`skipped_locked`).
     - **Contender never rewrites `last-run.json`** (assert byte-identical `last-run.json` + entry appended to `skips.jsonl`).
     - Stale reclaim succeeds on strict-UUID `bootId` mismatch, same `pidNs` + `ESRCH` (or `Threads: 1` zombie `Z` under concordant time-ns) + dead child group, and same `pidNs`/`timeNs` PID-reuse (`pidStartTime` mismatch) on qualified local storage with `uid === geteuid()`; fails closed on unqualified `statfs` magic, foreign UID, `nlink > 1` opaque file, and corrupt files not predating boot.
   - **Runner & child-process integration (`m-27`, `m-30`)**: `runScheduledTask*` never rejects (missing/corrupt manifest → `outcome: 'not_run'`, exit `2`, `error` set); inject `ENOSPC` on each of the four writes (`m-27`: lock directory, lock publication, pre-spawn rewrite → `not_run`, exit `70`, `RUNNER_INTERNAL_ERROR`, lock released if held; witness write → child outcome, exit `70`, `witness: null`, `RUNNER_INTERNAL_ERROR`); `manifest.stateDir !== resolvedStateDir` → `not_run`, exit `77`, `POLICY_REFUSED_STATE_DIR`, no witness (`m-30`); child receives constant `PATH=/usr/bin:/bin` despite runner env override (`m-30`); real child exit `0`, failure `1`, timeout `124` (grandchild in `-pgid` terminated), `SIGTERM` → `interrupted` (`143`), kill-switch freeze (`0` + `killSwitch` in witness, evaluated before allow-list), monotonic `durationMs` under wall-clock jump, secret & loader env stripping, `runs.log` & lock-holder-only `skips.jsonl` rotation (`0600`, UTF-8 safe).
   - **Static architectural & packaging guards (`m-26`, `m-32(i)`)**: zero imports of `@sentropic/cluster-mesh`, `@sentropic/flow`, `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, `undici`; zero global `fetch`/`WebSocket`/`EventSource`/`XMLHttpRequest` references in `src/**`; zero `.py` files; **no file under `src/**` reads any environment variable, file, or flag that skips the host PID guard (`m-26`)**; `npm pack --dry-run` lists no `tests/` or `Dockerfile.systemd-ci` (`m-26`, `m-32(i)`).
   - **Fake adapter (`m-32(c)`)**: verifies `createFakeSchedulerAdapter({ stateDir })` creates `stateDir` (`0700`) at construction (making `not_installed` reachable inside containers), verifies `status()` uses `probeStateDirObservability`, and verifies full `h2a` consumer test workflow (`enable`/`status`/`disable`/`uninstall` + `setWitness`/`setPersistedEnvFile`), proving the §4.4 file-based read path sees the exact files written by the fake adapter.
2. **Docker-first systemd lifecycle in CI (`make test-local-scheduler-systemd-ci`, CI-mandatory)**:
   - Built in-repo from **`packages/local-scheduler/Dockerfile.systemd-ci`** based on the already-used `$(LLM_MESH_NODE_IMAGE)` (`node:24-bookworm-slim`, `Makefile:115`) plus Debian packages `systemd`, `systemd-sysv`, and `dbus-user-session` (**zero third-party image, zero Python**).
   - Run with: `--privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock`, with a lingering unprivileged test user and **with the host PID guard bypassed by the internal test trampoline** (`policy.runner = { bin: node, args: ['<pkg>/tests/fixtures/ci-runner.mjs'] }`, `m-26`, never exposed in manifest or public types and allow-listed only in CI/qualification tests).
   - *Version delta note*: Debian bookworm ships **systemd 252**, whereas the target workstation runs **systemd 259** (covered by optional host qualification `BRxx-EX2`).
   - Executes real `systemd-analyze calendar --iterations=8 -- <expr>`, `systemd-analyze verify --user` (including on the `$$` / `${X}` script-path golden unit, `m-25`), and full `SystemdUserAdapter` lifecycle (`enable --runtime` → `status` → `systemctl --user start` → witness verification → `OnCalendar` update + restart → `disable --runtime` → `uninstall` including `clean --what=state`) in `$XDG_RUNTIME_DIR/systemd/user/`.
   - Verifies `enable` rollback (`m-29`) with an injected `systemctl` failure on both paths (previous manifest restored with matching digests + `daemon-reload` and `rolledBack: true`; first install `disable -- <timer>` removes symlink before unlinking units + `daemon-reload`).
   - Verifies seccomp `RestrictAddressFamilies=AF_UNIX` rejects a child TCP connect attempt to `127.0.0.1:3002`.
   - Verifies `UnsetEnvironment=` blocks `NODE_OPTIONS` placed in `EnvironmentFile=` from reaching either the runner or the child process.
   - Verifies `SuccessExitStatus=130 143` leaves an interrupted `Type=oneshot` unit `inactive (dead)` (not `failed`).
   - Verifies `ExecMainStatus=203` and both `ExecMainStatus=77` diagnostic branches (`m-28(a)`) in `status()`.
3. **Host-only qualification (`make qualify-local-scheduler-host`, explicit `BRxx-EX2` exception to Docker-first)**:
   - Run outside `bwrap` by the owner or an unsandboxed host operator before workstation cutover.
   - Proves:
     - (a) positive `assertHostPidNamespace()` on the real Linux host;
     - (b) negative `bwrap --unshare-pid --proc /proc` runner invocation with a free lock → **exit `77`, no lock file created, `last-run.json` byte-identical, and one `skips.jsonl` line** (`outcome: 'refused_policy', refusal: 'sandbox'`);
     - (c) **B-5 namespace-aware lock proof**: contender inside `bwrap --unshare-pid --proc /proc` (**with the host PID guard bypassed by the internal test trampoline**, `m-26`) facing a live host holder → `skipped_locked`, lock bytes unchanged;
     - (d) real systemd 259 user manager lifecycle using ephemeral `unitDir = $XDG_RUNTIME_DIR/systemd/user/` (`runtime: true`, task ID `sentropic-qual-<nonce>`) with `finally` teardown (`stop`, `disable --runtime`, `clean --what=state`, unlink, `daemon-reload`, `reset-failed`);
     - (e) negative TCP connect to `127.0.0.1:3002` under host systemd 259 `RestrictAddressFamilies=AF_UNIX`;
     - (f) post-test byte-for-byte SHA-256 assertion that `~/.config/systemd/user/` is **unchanged**.
   - Emits a timestamped qualification receipt JSON under `.tmp/local-scheduler/host-qualification-receipt.json`.

### 7.2 Delivery lots, scope exceptions, and agent-hour estimates

#### Declared scope exceptions (`rules/MASTER.md:32-33`)

| Exception ID | Paths / rule touched | Rationale | Impact | Rollback |
|---|---|---|---|---|
| **`BRxx-EX1a`** *(Lot S1)* | `Makefile`, root `package-lock.json` | Add Docker-first `typecheck-local-scheduler`, `test-local-scheduler`, `build-local-scheduler` targets (mirroring `@sentropic/harness`, `Makefile:2353-2406`) and register the new workspace in root `package-lock.json` via `make lock-root` (`Makefile:614`, matching `package-lock.json:19996-20007`) so Lot S1 executes its own Make-only gate without touching forbidden paths. | Editing `Makefile` matches the CI `global` path filter (`.github/workflows/ci.yml:388-390`), running the full CI matrix on the PR; adding `packages/local-scheduler/package.json` and its root lock entry changes the API tool-deps key (`scripts/ci/api-tool-deps-key.mjs:22-24`), triggering one `sentropic-api-tool-deps` image rebuild. Runtime behavior of existing packages and API/UI/E2E lanes is unchanged. | Revert the additive `Makefile` block and re-run `make lock-root` after removing `packages/local-scheduler`. |
| **`BRxx-EX1b`** *(Lot S2)* | `Makefile`, `.github/workflows/ci.yml`, `scripts/ci/publishable-manifests.mjs`, `scripts/ci/consumer-boundaries.json`, `packages/local-scheduler/Dockerfile.systemd-ci` | Add `pack-local-scheduler`, `test-local-scheduler-systemd-ci`, `publish-local-scheduler`, `publish-local-scheduler-token` targets (built from in-repo `Dockerfile.systemd-ci` on `$(LLM_MESH_NODE_IMAGE)`), and register `local-scheduler` in CI publish/pack guards and `bootstrap_publish_target`. | Editing `Makefile` and `ci.yml` matches the CI `global` filter (`.github/workflows/ci.yml:388-390`), running the full CI matrix on the PR; steady-state npm publish job stays gated until the owner attaches the OIDC trusted publisher. | Revert the additive `Makefile` targets, `packages/local-scheduler/Dockerfile.systemd-ci`, the `ci.yml` jobs/filters/`bootstrap_publish_target` choice option (`ci.yml:29-49`) and its bootstrap step, all **three** arrays (`STEADY_STATE_PUBLISHERS`, `BOOTSTRAP_TARGETS`, `PACK_TARGETS`) in `scripts/ci/publishable-manifests.mjs:22-26,29-33,35-39`, and the `scripts/ci/consumer-boundaries.json` entry. |
| **`BRxx-EX2`** *(Lot S2)* | Docker-first exception for `make qualify-local-scheduler-host` (`rules/MASTER.md:18-21`) | Containers cannot prove host init PID namespace (`pid:[4026531836]`), real `bwrap --unshare-pid` refusal/cross-namespace lock safety, or the owner's real systemd 259 user manager (bookworm CI runs systemd 252). | Opt-in host qualification target only; never runs in CI; installs ephemeral runtime units only in `$XDG_RUNTIME_DIR/systemd/user/` and asserts `~/.config/systemd/user/` byte-identical. | Remove `qualify-local-scheduler-host` target from `Makefile`. |

#### Delivery lots

| Lot | Repo | Scope & concrete deliverables | Exit proof / gate | Estimate (agent-hours) | Dependency |
|---|---|---|---|---:|---|
| **Lot S1 — Core package, fail-closed lock, runner, unit tests & Make targets (`BRxx-EX1a`)** | `sentropic` | `packages/local-scheduler` (`"files": ["dist", "README.md", "LICENSE"]`): contract, typed errors (`TaskNotFoundError`, `SystemctlFailedError` with `rolledBack`, `RUNNER_INTERNAL_ERROR`), shebang-safe allow-list + loader-env guard, namespace-aware fail-closed lock (`pidNs`/`timeNs`/`phase`, strict UUID rule (a), `Threads: 1` zombie rule (b), qualified `statfs`, `<taskId>.lock.reclaim` guard-lock recovery, `childPgid`, widened `skips.jsonl`), `parseSchedulerEnvFile`, pinned `envFilePath`, kill-switch, atomic witness (`v: 1`, narrowed `refusal`), `readTaskLockSummary`, `readLastSkipEntry`, pure `evaluateTaskHealth` (incl. `paused` dead-timer check, `failed` overdue escalation, `interrupted`, `not_installed`, `unobservable`, stuck-lock & env-file hints), `probeStateDirObservability`, monotonic `durationMs`, Node log rotator & step-8 `skips.jsonl` rotation, pure injection-safe systemd unit generator (`SuccessExitStatus=130 143`, `UnsetEnvironment=`, `$` → `$$` on all `ExecStart=` tokens, lone `;` rejection), never-rejecting `runScheduledTask`/`runScheduledTaskById` (constant child `PATH`, `stateDir` parity, `ENOSPC` `RUNNER_INTERNAL_ERROR`), `@internal` `runScheduledTaskInternal` seam, disk-backed `createFakeSchedulerAdapter`, full unit/runner/negative/static test suite (lock fixtures under `/workspace/.tmp/`), `Makefile` `typecheck`/`test`/`build` targets (`BRxx-EX1a`), and root `package-lock.json` (`make lock-root`). | `make typecheck-local-scheduler`, `make test-local-scheduler`, `make build-local-scheduler`, and `make scope-check` all green in Docker. | **16–24 h** | None (unblocked immediately; Q2 `linger` does not affect S1). |
| **Lot S2 — `systemd --user` adapter, CI systemd qualification, `BRxx-EX1b/EX2` & bootstrap publish** | `sentropic` | `SystemdUserAdapter` (`enable`/`disable`/`status`/`uninstall`, atomic manifest-after-enable ordering, `SYSTEMCTL_FAILED` rollback on update & first-install, `--runtime` mode, `clean --what=state`, `OnCalendar` restart, interval derivation, `ExecMainStatus=203` & two-branch `77` diagnostics, `Version` probe, `linger` probe), `assertHostPidNamespace`, `tests/fixtures/ci-runner.mjs` trampoline (`m-26`), `packages/local-scheduler/Dockerfile.systemd-ci`, `Makefile` targets (`pack`/`test-systemd-ci`/`publish`/`publish-token`/`qualify-local-scheduler-host`), `.github/workflows/ci.yml` + `publishable-manifests.mjs` (3 arrays) + `consumer-boundaries.json` (`BRxx-EX1b`, `BRxx-EX2`), steady-state OIDC job gated until trusted publisher attached. | `make test-local-scheduler-systemd-ci` & `make pack-local-scheduler` green in CI; owner bootstrap-publishes `@sentropic/local-scheduler@0.1.0` and attaches npm trusted publisher; optional `make qualify-local-scheduler-host` receipt green. | **12–17 h** | Lot S1 (incl. `m-26` seam before S2 starts) + Owner actions #1 & #2 (§7.3) |
| **Lot H1 — `h2a` archive engine + scheduler wiring + `status`/`resume` banners** | `h2a` | **(a) Engine *(h2a-conductor-owned)***: conservation-only Claude archive engine (`PILOT-r1.md` Lot 1: `scan\|run\|verify\|list\|restore`, `--max-duration` soft budget [X-2], fail-closed archive repository lock [X-1], single CLI entry [X-4], auto-restore in `h2a resume`/`h2a run --resume`, main-transcript `mtime` deadline calc, `min(10 Go, 5%)` disk guard). **(b) Wiring**: `@sentropic/local-scheduler` in `packages/h2a-runtime/package.json`, `h2a archive schedule enable\|disable\|status\|uninstall`, `_schedule-exec`, read-time witness/pause/lock/env-file/deadline banners in `h2a status`/`h2a resume` using `LocalTaskWitnessV1` as single dead-man source [X-3]. *(Engine + fake-adapter wiring run in parallel with S1+S2 against frozen §4 API.)* | Claude purge-survival E2E in disposable `CLAUDE_CONFIG_DIR`; 2 idempotent scheduled runs = 0 duplicates; `H2A_ARCHIVE_OFF=1` pauses cleanly; missed-schedule & `<14d` purge banners verified in `h2a status` without running `archive run`; owner activates on workstation with ≥1 verified automatic pass. | **18–26 h** *(engine 14–20 h [h2a-owned] + wiring 4–6 h)* | Frozen §4 API (parallel start); Lot S2 published + Owner action #3 (for workstation cutover) |
| **Lot S3 (GATED) — `@sentropic/cluster-mesh` `OpsJobFailureV1` local source & per-watch grace** | `sentropic` | Additive extension `source: 'local'`, `kind: 'local-timer'` in `ops-job-failure-types.ts` + `ops-job-failure-contract.ts` + server-side per-source/per-watch `heartbeatGraceMs >= deadlineMs` map in `incident-state.ts`/`incident-schedule.ts`/`ops-sweep.ts` + structural projection helper (`eventId`, `runId`, `targetKey`, outcome + `heartbeat` emission) + receiver-first rollout + tests (`m-32(h)`). | Contract, heartbeat-watch grace, and round-trip validation tests pass; `'k8s'`/`'app'` compatibility preserved. | **5–7 h** | Opportunity condition (§5.3) |
| **Lot S4 (FUTURE) — BR-30 `TriggerSource` local schedule adapter** | `sentropic` | Thin adapter implementing BR-30 `TriggerSource` (`kind: 'schedule'`) over `@sentropic/local-scheduler` (no-tenant local mode + `<taskId>:<scheduledSlotIso>` idempotency key). | BR-30 conformance suite. | **4–6 h** | BR-26 + BR-30 |

### 7.3 Calendar target, Owner actions, and fallback decision point

- **Baseline date**: `2026-11-25`
- **Effort vs critical path (`m-32(j)`)**:
  - Total combined effort (S1 + S2 + H1): `46–67 agent-hours`.
  - **Parallelised critical path** (`max(S1 + S2, H1-engine) + H1-wiring`): **`32–47 agent-hours`** (~1.5–2 calendar weeks including multi-peer review rounds and owner bootstrap publish).
- **Target milestones**:
  - **`2026-12-04`** *(tightened under the `32–47 h` critical path)*: Lots S1 + S2 merged; owner bootstrap-publishes `@sentropic/local-scheduler@0.1.0` and attaches npm trusted publisher.
  - **`2026-12-15`**: Lot H1 merged, deployed on workstation, owner runs `h2a archive schedule enable`, and **first automatic scheduled Claude archive pass verified** (**26 days** of observed automatic runs before `2027-01-10`; **40 days** before `2027-01-24`).
  - **`2026-12-18` (Fallback decision point — unaffected by `m-32(j)`)**: if `@sentropic/local-scheduler@0.1.0` is not yet published or wired into `h2a`, the owner runs `h2a archive run --cli claude` manually once per week until wiring lands — guaranteeing zero session loss ahead of `2027-01-24`.
  - **`2027-01-10` (Hard gate — J-14, unaffected by `m-32(j)`)**: in service, verified, zero unarchived Claude sessions approaching purge.
  - **`2027-01-24`**: Estimated first native Claude purge of `2026-10-26` sessions (`cleanupPeriodDays = 90`).

#### Owner-only actions on the critical path (cannot be executed by sandboxed lanes)

| # | Target date | Action | Reason owner-only |
|---:|---|---|---|
| **1** | By `2026-12-04` | Trigger GitHub Actions `workflow_dispatch` with `bootstrap_publish_target=local-scheduler` (uses `NPM_TOKEN`, `.github/workflows/ci.yml:24-25,1123-1124`). | First npm publication of a new `@sentropic/*` package requires manual `NPM_TOKEN` bootstrap before OIDC is available. |
| **2** | Immediately after #1 | Attach the npm OIDC trusted publisher for `@sentropic/local-scheduler` on npmjs.com, then enable steady-state OIDC publication (`publish-local-scheduler`). | npm package settings require owner org credentials. |
| **3** | By `2026-12-15` | Run `h2a archive schedule enable` once in a normal host terminal (outside agent `bwrap` sandboxes). | §3.4 host PID guard and `systemd --user` manager require an unsandboxed host session. |
| **4** | Optional (before #3) | Run `make qualify-local-scheduler-host` in a normal host terminal to generate the host qualification receipt. | `BRxx-EX2` host-only qualification outside `bwrap`/Docker (validates host systemd 259 vs CI bookworm systemd 252). |

---

## 8. Owner decisions pending

Only **one** genuine owner decision remains pending (`loginctl enable-linger` account policy on the workstation, Option A vs Option B, unchanged from r2/r3 and recorded in the external French decision note `DECISIONS-FR-r3.md`), cleanly separated from:
1. Already-decided owner directions (2026-11-25 Q-P1 "Sentropic d'abord", Q2-A / Q3-A / Claude 90-day retention, and the global zero-Python rule),
2. Reversible dossier choices (package name, `2027-01-10` target, daily default cadence, gated `cluster-mesh` opt-in), and
3. Non-decision owner actions from §7.3.
