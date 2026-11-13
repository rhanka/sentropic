# Feature: Sandbox Node Step 1 — contract freeze (ExecutionNodeV1 + tenant model)

## Objective
Freeze the local ExecutionNodeV1 contract and the two-tenant model on the BHS d2-4 VM (2 shared vCPU, 3,456 MiB parent ceiling).

## Scope / Guardrails
- Scope: local contract amendments, agent admission/custody helpers, VM artifact/operator definitions and regression qualification.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/sandbox-node` (verified: branch `feat/sandbox-node-step1` at `origin/main` `5be8e34f3` before any edit).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `packages/contracts/**` (ExecutionNodeV1 types only: `src/execution-node-v1.ts` + its re-export in `src/index.ts`)
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
  - `BRANCH.md`
  - `package-lock.json` (restore published contracts version only)
  - `.github/workflows/ci.yml` (BR-SN1-EX7: sandbox qualification step only)
  - `e2e/fixtures/provider-server.mjs` (BR-SN1-EX8: Responses session-title fixture only)
  - `e2e/fixtures/provider-server.test.mjs` (BR-SN1-EX8 regression)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `deploy/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None declared.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [x] RUN 3 output confinement: a failing malicious-base test exposed a symlinked output ancestor; OCI preparation now rejects linked output ancestors before host mkdir.
- [x] RUN 3 operator alignment: bounded zram hierarchy, agent MemoryMin, swap usage, service deadlines, host-supplied scope and actual lifecycle protocol documented; real host qualification remains explicit.
- [x] RUN 3 devScope completeness: all exported daemon session mutations, including claim and renew, now require and compare the supplied scope with the immutable session policy.
- [x] RUN 3 AMD-13/15 observability: node reports physical budget and bounded swap; lower MemTotal reduces admission capacity; quotas publish heavy queue depths and service limits.
- [x] RUN 3 B2/M10 follow-up: refuse output directory itself and hardlinked source paths; WAL writes handle partial writes before fsync/ack.
- [x] RUN 3 integration: signed transport cycle covers write/export/delete and rejects absent/substituted scope; heartbeat loss fences mutations, runtime exits trigger stop, and naturally unloaded scopes can be cleaned safely.
- [x] RUN 3 B2/B3g: source writes now reach the private overlay through a scoped, symlink-safe host writer; runtime source mounts remain read-only. HTTPS import uses a bounded streaming reader.
- [x] RUN 3 B3f: base import now streams HTTPS into tenant-private storage, verifies SHA-256, syncs before immutable publication, and registers only verified identities.
- [x] RUN 3 B3e: production listener now dispatches lifecycle requests with a mandatory verification key and bounded JSON input; binary exports use application/gzip rather than JSON serialization.
- [x] RUN 3 B3d: lifecycle dispatcher regression added; create/start/claim/stop/export/delete/renew/revoke are routed with control-plane role, ticket and mandatory session devScope checks.
- [x] RUN 3 B3c: runtime now prepares OCI bundles, tracks failed starts for cleanup, reads bounded quiescent archives and removes runsc state/scope/mounts/private directories before releasing capacity.
- [x] RUN 3 B3b: OCI bundle regression added; EROFS bases feed private overlay, runtime workspace is read-only, build output is separate, and teardown unmounts before purging upperdir.
- [x] RUN 3 B3a: reproduced discarded mounts; daemon retains validated mounts and passes them with the session command into the runtime.
- [x] RUN 3 M11: failing listener/operator regression fixed; the mTLS agent defaults to TCP 8443.
- [x] RUN 3 M7: reproduced false running after launcher exit 1; start now waits for runsc running state and rejects post-spawn failures.
- [x] RUN 3 M9: reproduced unlimited active-plus-pending and missing timeout; two outstanding per tenant and 60s/120s heavy-profile timers now stop/destroy before releasing the global slot.
- [x] RUN 3 B4: unsigned create reproduced; mutation gates now require tickets bound to the executed body, command, node, tenant, route and ownership; substitution regressions included.
- [x] RUN 3 B5/M6: failing hung-build and retained-stop regressions prove reservation loss; failed runtime is stopped and reservations survive until confirmed destruction.
- [x] RUN 3 B2: traversal, refused-file and symlink regressions reproduced; mandatory host-resolved devScope is persisted with provenance and enforced by normalized glob checks.
- [x] RUN 3 M8/M10: reproduced missing deadline close and torn-tail restart crash; timers close streams and WAL recovery truncates uncommitted tail, syncs file and parent before ack.
- [x] RUN 3 B1: failing memory regression reproduced 3200 MiB; AMD-13 reserves 2944 (704/session, 1536/build), tenant 2304/2048/704 with bounded swap.
- `BR-SN1-EX8`: CI shard 6 passed all 49 browser tests but provider receipt rejected the two legitimate session-title Responses calls from chat-service.generateSessionTitle (system prompt, gpt-5.4-nano, 32 tokens). Fixture currently accepts only user-role reasoning classifiers. Add that exact title protocol with regression tests; preserve unknown-request/host rejection. Impact: test fixture only, no application behavior. Rollback: revert these two fixture files.
- RUN 2 CI `43329741351`: sandbox install failed with EACCES at /npm-cache/_cacache because Docker created a missing host cache as root. Fix: precreate a dedicated user-owned cache before mounting. E2E shard 6 fixture evaluator error is under evidence-first diagnosis.
- `BR-SN1-EX7`: add sandbox container qualification to existing required typecheck-lint-api join. No new job/deployment permission; rollback removes that one step.
- `BR-SN1-EX6`: owner-authorized RUN 2 restores published contracts 0.3.0 and its index/lock; the unreleased contract moves to apps/sandbox-node/src/contract.ts. No publication or consumer dependency changes. Rollback: revert relocation.
- EX1/EX4/EX5 are superseded by EX6: contracts and all consumer manifests/fixtures remain byte-identical to base. Previous failed CI experiments are retained only in the RUN 1 report.
- S1-K1 host acceptance: OCI bundle/reader and lifecycle transport qualification remain required before routing traffic; bootstrap does not advertise them.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature here; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single follow-up lane, no delegated work)
- [ ] **Multi-branch**
- Rationale: apply the owner's follow-up directly on the verified PR branch.

## UAT Management (in orchestration context)
- No UI change, no UAT checkpoint for this step.

## Plan / Todo (lot-based)
- [x] RUN 2 CI fixes: user-owned cache qualifies 31/31; exact Responses session-title regression reproduced red, then fixture amended without relaxing unknown-traffic rejection.
- [x] RUN 2 build: compiled digest-addressed archive produced locally; reuse locked dependency download cache after observed registry ETIMEDOUT, without host node_modules.
- [x] RUN 2: real adapter reads complete memory.current via validated systemd tenant slice; update local exports and standalone qualification instructions.
- [x] RUN 2 AMD-3/6/7: compile-time incomplete provenance rejection, truthful stop union, strict isolate policy and canonical recipe digest/path collision regressions.
- [x] RUN 2: CI executes standalone regression suite; spec adds provenance/S2 recipe and staged d2-4 qualification gates.
- [x] RUN 2 spec: apply normative AMD-1/2/4/5/7/8/9/10/11/12 tenant, scope, admission, transport and lifecycle amendments.
- [x] RUN 2 regression checks: pending stop retains reservation, export refuses until quiescence, concurrent claims serialize and rejected admissions can retry.
- [x] RUN 2: build digest-addressed compiled Node release with immutable archive/file manifests; no package or image publication required.
- [x] RUN 2 AMD-12: operator guide targets poc-k8s cloud-init/systemd, public mTLS, no Python, job-alerts, digest rollback and d2-4 resources.
- [x] RUN 2: runnable mTLS bootstrap service and real job-alerts scheduling; supportedOps honestly limited to node/quotas pending S1 host lifecycle qualification.
- [x] RUN 2 AMD-5/12: mTLS listener, explicit operator/tenant scope boundary and verified HTTPS job-alerts heartbeat; authentication regression tests.
- [x] RUN 2 AMD-12: remove inapplicable DaemonSet; standalone systemd agent unit and digest-only verified release startup for k8s cloud-init ownership.
- [x] RUN 2 AMD-3/6/7/11: provenance payload and S2 recipe/isolation contract; epoch 2 then late epoch 1, restart, stream closure and heartbeat regression tests.
- [x] RUN 2 AMD-4/11: monotone custody WAL fsync before acknowledgement, active stream closure, stale reconnection/invocation refusal and heartbeat fail-closed gate.
- [x] RUN 2 AMD-2: wire scope stop results and quiescence export guard; real export fails closed until its reader is installed.
- [x] RUN 2 AMD-2/9: resolve systemd ControlGroup, validate tenant ancestry before writes, kill only scope and poll populated; mismatch/timeout regression tests.
- [x] RUN 2 AMD-1/8: account complete memory.current and fixed 768/1664 MiB reservations, reject memory pressure before OOM; capacity regression tests.
- [x] RUN 2: wire publish admission into daemon, warm claim transfer, canonical builder storage; standalone container qualification target.
- [x] RUN 2 AMD-8/10: warm live OR standby admission, rejection before allocation and reservation transfer tests.
- [x] RUN 2 AMD-10: bounded single global publish queue with strict tenant alternation and queue-full rejection tests.
- [x] RUN 2 AMD-8: freeze d2-4 capacity, per-tenant limits, quota snapshots and stop/scope response types locally.
- [x] RUN 2: verify feat/sandbox-node-step1 mechanically; restore registry-compatible contracts and consume new types locally.
- [x] RUN 2: apply AMD-1..12, d2-4 admission, custody, scope resolution, VM operator contract and regression tests (30 passing before release-start tests).
- [ ] RUN 2: push atomic commits, verify CI green, append evidence to s1-agent-core.md; do not merge or deploy.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/sandbox-node-step1` tracks `origin/main` (`5be8e34f3`) in worktree `tmp/worktrees/sandbox-node` before any edit.
  - [x] Confirm scope and guardrails (Allowed/Forbidden above; `Makefile` and `deploy/**` untouched).
- [x] **Lot 1 — Spec freeze**
  - [x] Write `spec/SPEC_EVOL_SANDBOX_NODE.md` (English): ExecutionNodeV1 + tenant model frozen; open points (D2/D3/D4/D5/D6/D7/D14) explicitly marked non-frozen.
- [x] **Lot 2 — Contract module**
  - [x] Consume unreleased contract in `apps/sandbox-node/src/contract.ts`; leave published contracts untouched.
  - [x] Lot gate: `tsc --noEmit` on `packages/contracts` passes; `git status` shows no `Makefile`, `docker-compose*.yml`, `api/**`, `ui/**`, `deploy/**` changes.
- [x] **Lot S1-A1a — Sandbox-node daemon (apps/sandbox-node, Node/TS, zero Python)**
  - [x] Daemon against injectable runtime adapter (`src/runtime-adapter.ts`: fake for tests, real `runsc --network=none` systrap compile-safe).
  - [x] Per-tenant read-only base mounts + `/workspace`-only writes (`src/mounts.ts`).
  - [x] Lifecycle automaton + idempotence + ticket verification (`src/daemon.ts`, `src/tickets.ts`).
  - [x] Per-tenant admission/quotas + WFQ 1:1 drain + audit events (`src/admission.ts`, `src/audit.ts`).
  - [x] Unit tests written: tenant isolation, lifecycle incl. stop->export->destroy, tickets, admission fairness, adapters.
  - [x] Typecheck `apps/sandbox-node` via `exec-api` on `ENV=test-sandbox-node` (green).
  - [x] Unit tests green via `test-api-endpoints SCOPE=apps/sandbox-node/tests` on `ENV=test-sandbox-node` (5 files, 16 tests).
- [ ] **Lot N — Final validation**
  - [x] Typecheck & lint for the touched package (`make typecheck-api` exit 0 on 2026-11-12; scoped vitest 16/16; eslint clean on identical `.ts` per S1-A1a).
  - [x] Keep published contracts 0.3.0 and its lock/index unchanged from base; no publication.
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR.
  - [x] Owner constraint: preserve BRANCH.md for follow-up, do not merge or deploy.
