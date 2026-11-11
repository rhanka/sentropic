# Feature: Builder SLO L3 warm pod pool

## Objective
Keep at least 1 warm pod per (scope, hot cacheKey) so a live start attaches instead of creating a pod, and reuse the scrubbed pod synchronously at stop as warm-deps for the next publish.

## Scope / Guardrails
- Scope limited to the builder warm pool (§7.3): identity split, Kubernetes list/patchLabels, pool manager, claim/scrub, warm-deps release, pool endpoints, capacity 4.
- One migration max in `api/drizzle/*.sql` (none planned; KV namespaces only).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/slo-l3`.
- Automated test campaigns run on dedicated environments (`ENV=test-slo-l3`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `api/src/routes/artifacts-builder.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `deploy/k8s/overlays/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] L3-EX1 pending: k8s lane raises LimitRange cpu to 4 and ResourceQuota to requests 1vCPU/3Gi, limits.memory 8Gi, ephemeral 14Gi before pool activation (builder code lands first, pool minimum stays 0 until quota applied)

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: L3 is one capability (warm pool) stacked on L1; single branch rebased onto L1 then main.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/slo-l3`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/sentropic`, `ENV=dev`).
  - Switch back to `tmp/worktrees/slo-l3` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, spec §7.3, convergence Q2/Q4, L1 head dbd238084.
  - [x] Create worktree `tmp/worktrees/slo-l3` on `feat/builder-slo-l3-warm-pool` stacked on L1.
  - [x] ENV `test-slo-l3`, ports API 8963, UI 5363, Maildev 1263.
- [x] **Lot 1 — Capacity 4 pods with burst limits**
  - [x] MAX_BUILDER_PODS 2 to 4, LIVE_NODE_CAPACITY 2 to 4, PRODUCT_HEAVY maxPods 4, PRODUCT_ADMISSION 4.
  - [x] Pod resources requests 250m/768Mi, limits 4/2048Mi.
  - [x] Lot gate: pods.test.ts quota block updated.
- [x] **Lot 2 — Identity split (D10)**
  - [x] Pool helpers poolPodName/isPoolPodName/bindingRowKey, builderPod + liveViteConfig accept pool names.
  - [x] Row keys to bindingRowKey form, draft source binding fallback, active() carries podName, heavyStatus uses stored runtime.
  - [ ] Lot gate: `make test-api SCOPE=tests/unit/artifacts-live/pods.test.ts ENV=test-slo-l3` via docker-slot.sh.
- [x] **Lot 3 — Kubernetes list/patchLabels**
  - [x] KubernetesCore list/patchLabels, in-cluster impl, fixture impl.
  - [ ] Lot gate: scoped pods test green.
- [ ] **Lot 4 — Pool manager**
  - [x] New pool.ts: fill CAS, claimForLive/claimForBuild CAS.
  - [x] Release warm-deps, drain, occupancy, adopt, renew (LivePorts.pool wiring next).
  - [ ] LivePorts.pool wiring, service composition.
  - [ ] Lot gate: new pool.test.ts green.
- [x] **Lot 5 — Frame fence poolEpoch + claim/scrub ops**
  - [x] FRAME_OPS claim/scrub/extractArchive/applyOverlay/sealDependencies, poolEpoch ordering, agent claim/scrub + unbound allowlist.
  - [x] Worker claim/scrub plumbing (supervisor transport, ports, fixtures).
  - [ ] Lot gate: bootstrap-frame.test.ts green.
- [ ] **Lot 6 — Warm-deps release + warm-hit paths**
  - [ ] transitions.ts release branch, prepare-live/build-only claim, controller heavyStatus, refusal pool_exhausted.
  - [ ] Lot gate: controller + races tests green.
- [ ] **Lot 7 — Pool endpoints**
  - [ ] GET /v1/pool, POST /v1/pool/drain, service mount.
  - [ ] Lot gate: prewarm-api family green.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API scoped suites
  - [ ] PR opened from BRANCH.md text, CI green, no merge.
  - [ ] `make down-volumes ENV=test-slo-l3`, French report to `.tmp/rv/slo-l3.md`.
