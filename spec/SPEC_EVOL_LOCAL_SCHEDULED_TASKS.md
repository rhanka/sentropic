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
