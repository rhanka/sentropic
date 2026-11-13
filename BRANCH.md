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
  - `scripts/security/sca-gate.test.mjs` (BR-SN1-EX11: expected covered lock inventory only)
  - `packages/contracts/**` (ExecutionNodeV1 types only: `src/execution-node-v1.ts` + its re-export in `src/index.ts`)
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
  - `BRANCH.md`
  - `package-lock.json` (restore published contracts version only)
  - `.github/workflows/ci.yml` (BR-SN1-EX7: sandbox qualification step only)
  - `e2e/fixtures/provider-server.mjs` (BR-SN1-EX8: Responses session-title fixture only)
  - `e2e/fixtures/provider-server.test.mjs` (BR-SN1-EX8 regression)
  - `ui/src/routes/folder/new/+page.svelte` (BR-SN1-EX9: CI-blocking draft-creation race only)
  - `e2e/tests/00-ai-generation.spec.ts` (BR-SN1-EX9: suspended-draft generation regression only)
  - `ui/src/lib/components/chat/AppChatPanel.svelte` (BR-SN1-EX10: stale session hydration during attachment upload only)
  - `e2e/tests/04-chat-image-paste.spec.ts` (BR-SN1-EX10: delayed history hydration regression only)
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
- [x] RUN 5 final artifact: 2206040078562ddf4c32d0d9d34825fc1dee3abba7cc76ef45ce8b6bee3eed6e (Node SEA + shared rootfs + public config/unit/README/B-test). Archive and all file checksums verified, extracted SEA self-test passes. 75 standalone regressions and 14 SCA inventory regressions pass; scoped lint has zero errors.
- [x] BR-SN1-EX11: CI 43379243080 security-sca-gate failed because its expected lock inventory omitted the new SEA build-tools lock. Add that exact covered directory to its expectation; scanner coverage already includes it automatically. Impact: inventory assertion only, no policy exclusion/suppression; rollback: remove the directory from the expectation if the SEA tool lock is removed.
- [x] RUN 5 final packaging: observed erofs-utils 1.5 rejects -q; corrected to its documented --quiet flag. Archive also carries OPERATOR.md and the restart B-test so the k8s digest handoff is self-contained.
- [x] RUN 5 final rebase: origin/main advanced to 21f641113 during implementation; replayed branch and retained its own BRANCH.md instead of main's unrelated T3 plan. Build/test copies now exclude generated release archives after measured 709 MiB context amplification; EROFS progress is quiet.
- [x] RUN 5 spec reconciled with AMD-17..27: admission, exact memory/scope policy, key custody, shared rootfs channel, pull metrics and operator/control heartbeat separation; all real-host acceptance remains explicit.
- [x] RUN 5 operator handoff: exact compact-JWS claims/encoding/TTL/audience/replay/rotation, N1 public key and worked Node/OpenSSL signing command documented; node provenance custody and public-key registration stated explicitly.
- [x] RUN 5 exact-unit README regression failed first; operator guide now embeds the complete shipped unit verbatim, B-test command, and k8s-owned cutover/rollback.
- [x] RUN 5 operator README reconciles AMD-17, slice/scope values, installed identities/paths, SEA/rootfs custody, S3 control-plane secrets, pull metrics and the exact control heartbeat protocol.
- [x] RUN 5 B-test added: isolated-only agent restart with live loop/ext4, EROFS and overlay mounts, witness retained, host/new-agent namespace visibility and cleanup asserted. Original namespace FD guarantees cleanup even on regression. Execution remains k8s S1-K1; no local mount/restart performed.
- [x] RUN 5 SEA qualification: moved real EDQUOT qualification into the shipped executable; both supervisor and unprivileged quota writer run without host Node. Explicit isolated-host guard remains mandatory; no host quota/mount operation performed locally.
- [x] RUN 5 AMD-27 rootfs channel: failing shared-rootfs registry regression; startup registers only the verified release rootfs for both tenants. PUT bases refuses rootfs replacement; tenant source/dependency bases remain control-plane deliveries.
- [x] RUN 5 delivery config: archive includes SEA, rootfs, canonical unit/startup, agent.env paths and the exact k8s N1 operator SPKI public key. Execution-ticket public key must be supplied by sentropic; node-provenance PKCS#8 stays install-generated by k8s, never embedded in the archive.
- [x] RUN 5 AMD-25 SEA: interpreter-free startup assertion failed first. Pinned glibc Node is bundled/injected into one executable with an executable self-test; sentropic produces shared EROFS rootfs from the pinned runtime. k8s installs digests only, not Node or tenant content.
- [x] RUN 5 node metrics: missing-export regression failed first; GET node includes six measured counters per tenant (purpose=all aggregate), tenant slices, CPU/PSI kernel counters, queue wait and verified base-cache hits. Probe archival belongs to cluster Fluent Bit, with no VM S3 writer.
- [x] RUN 5 SEA build inputs: isolated build-only esbuild/postject exact manifest and lock; no agent runtime dependencies and no host npm installation.
- [x] RUN 5 routes/config: drain admission regression failed first; canonical node heartbeat/drain/undrain/status and tenant PUT bases are wired. The VM reads only ticket public keys; its k8s-installed Ed25519 provenance key signs archive attestations and publishes the SPKI key for control-plane registration.
- [x] RUN 5 AMD-22: missing-controller regression failed first. Heartbeats bind sentAt/node identity/epoch to the control-plane role; operator reads/drain never refresh custody. Drain/undrain state changes follow operator ticket verification.
- [x] RUN 5 AMD-17/20/27: missing-state test failed first; 3819 MiB floor retains 2944 MiB parent with margin 171 and zram physical cap 128. Agent advances/fsyncs its own epoch; tenant high=2304/tasks=2048 and scope high=704/1408 match the co-signed dossier.
- [x] RUN 5 operator JWS: failing missing-verifier regression, then EdDSA verification with pinned node/epoch/audience/op, <=60-second TTL, bounded jti replay cache and two-key rotation overlap. k8s retains the private operator key.
- [x] RUN 5 B3/operator facts: no-push regression failed first; removed job-alerts client/config/timer completely. mTLS roles now derive from the exact k8s-installed certificate CNs, rather than an absent OU.
- [x] RUN 5 AMD-27/M2/M6: transient-scope resource assertions and missing canonical unit failed first. Root execution-node.service has no file namespace, requires tenant mounts/zram, preserves runsc state; scope OOMPolicy/TasksMax and warm MemoryLow/CPUWeight protect sessions. Host syscall/capability qualification remains S1-K1.
- [x] RUN 5 AMD-21/S3: reproduced residual-cache admission rejection and wrong-bucket import before correction. Reservations alone gate admission; telemetry retains full memory.current. Imports require sentropic-execution-bhs/tenants/<tenant>/<configured-env>/ before filesystem/network access.
- [x] BR-SN1-EX10: CI shard 6 uploaded the pasted document successfully (201), but a concurrent deferred session selection cleared the attachment band. Fenced obsolete history hydration and stale session-list responses while creating an attachment target. Delayed-history regression fails on old CI image, passes rebuilt UI (1 expected, 0 unexpected/retries). Impact: session bootstrap concurrency only; rollback: revert the two declared chat UI/E2E files. Reuse the isolated EX9 test environment and ports.
- [x] BR-SN1-EX9: CI 43355644224 shard 5 returned HTTP 201 for draft creation but AI generation failed because ensureDraftFolder returned null during an in-flight draft request. Shared pending promise and deterministic browser regression: old CI image fails waiting for generation; rebuilt UI passes (1 expected, 0 unexpected/retries). Impact: folder creation concurrency only; rollback: revert the two declared UI/E2E files. Local isolated ports API=9512, UI=5712, MAILDEV_UI=1512; ENV=e2e-sandbox-r4.
- [x] RUN 4 M5 GC regression is committed in standalone qualification: restoring the reviewed retention policy retained all 8 archive buffers after GC (8 != 0); corrected policy reclaims all 64 MiB while daemon stays strongly reachable.
- [x] RUN 4 final artifact after early-exit fix: 6438720be250517de1613b570c8df42c5e6f318fb03bfdf74b5a839af87e6969; 60 regression tests pass. Replaces the intermediate RUN 4 archive.
- [x] RUN 4 early exit: failing callback-before-launch-return regression left a finished process marked running; defer exit handling until the launch promise is registered, then confirm stop and retain output (60 tests).
- [x] RUN 4 local verification: 59 regressions, TypeScript and shell/script syntax pass; compiled archive 01ffb345448177c33b6ecd7fe76a463026496c7817c8793ffbf71b29e1450bdb built without publication/deployment. Rebasing touched no public package source/version.
- [ ] RUN 4 real host gate (k8s/S1-K1): provide isolated runsc/EROFS host access for lifecycle and real EDQUOT tests. Local disk qualification refuses execution without explicit isolated-host configuration; no kernel isolation success claimed.
- [x] RUN 4 launch timeout: failing suspended-launch timeout regression demonstrated false quiescence; stop/export/delete/failure transitions now serialize per sandbox and await pending runtime launch.
- [x] RUN 4 M7: quota-command ordering failed first; every writable upper/work/output now inherits exact block/inode hard limits on a private ext4 project-quota volume before launch. Missing/invalid limits fail closed; real EDQUOT qualification remains part of the isolated-host gate.
- [x] RUN 4 M6: five forbidden URLs reached fetch before correction; imports now validate exact BHS endpoint, tenant prefix and canonical paths before storage/network access, including cached bases.
- [x] RUN 4 M5/M8: destroyed-export replay failed first; export promises now discard archive values after completion. Generic scope fixture uses synthetic packages/provenance instead of copying the tenant registry.
- [x] RUN 4 M3/M4: residual-memory and 40-second signed queue-wait tests failed first; atomic pre-grant memory validation and immutable authenticated queue entries now pass (55 tests).
- [x] RUN 4 B1/B2: failing natural-exit and suspended-launch DELETE regressions now pass; confirm quiescence before retaining successful output and keep reservations through launch completion (54 tests pass).
- [x] RUN 3 CI 43344836068: bundle fixture hard-coded uid/gid 1000 and failed EPERM on the runner's different uid; use the executing test user's identity and assert it in OCI config, preserving real ownership enforcement.
- [x] RUN 3 revocation transport: signed regression reproduced rejection of the contractual minCustodyEpoch field; route now advances session ownership to the persisted epoch, rejects stale commands and accepts freshly signed renewal.
- [x] RUN 3 lint: containerized API ESLint rules detected and removed one unused service import; existing warning-only console/constant-loop rules remain non-blocking.
- [x] RUN 3 local validation: 52 regressions pass in pinned Node container; compiled archive de41d3f42f1502fc91fae79c14b1871bb60f88e9cd73a8e3efb05e5fe7d317f5 built without publication/deployment.
- [ ] RUN 3 remaining host gate (owner: k8s, S1-K1): qualify create/start/write/stop/export/DELETE with pinned runsc, EROFS, overlayfs and systemd in isolation; this workstation has no runsc and does not expose EROFS. No VM isolation success is claimed.
- [ ] RUN 3 review consensus unavailable: harness/review requires h2a_run and complementary hosts; no h2a/mesh tool is exposed in this session. Original Astra findings reconciled locally; no new peer verdict claimed.
- [x] RUN 3 ticket queue fencing: failing regression reproduced execution after a queued ticket expired; admission revalidates freshness and releases an unused reservation on rejection.
- [x] RUN 3 documentation: frozen spec and README reflect AMD-13/14/15, TCP 8443, host-resolved devScope, implemented lifecycle and the unperformed real-host qualification.
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
