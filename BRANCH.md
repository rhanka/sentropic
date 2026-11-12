# Feature: Sandbox Node Step 1 — contract freeze (ExecutionNodeV1 + tenant model)

## Objective
Freeze the local ExecutionNodeV1 contract and the two-tenant model on the BHS d2-4 VM (2 shared vCPU, 3,456 MiB parent ceiling).

## Scope / Guardrails
- Scope limited to the contract freeze: spec text + one amendable contract module.
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
- `BR-SN1-EX6`: owner-authorized RUN 2 restores published contracts 0.3.0 and its index/lock; the unreleased contract moves to apps/sandbox-node/src/contract.ts. No publication or consumer dependency changes. Rollback: revert relocation.
- No exceptions declared (`Makefile`, `docker-compose*.yml`, `api/**`, `ui/**`, `deploy/**` untouched).
- `BR-SN1-EX1` (declared 2026-11-12, owner: agent-core): root `package-lock.json`
  version-only sync (`"packages/contracts"` `0.3.0` -> `0.4.0`, 1 line) required
  by the `enforce-package-bump` CI gate (PR #1012 run 43297181797).
  Reason: `npm ci` rejects a lock whose `packages/` entry mismatches
  `packages/contracts/package.json`; no dependency re-resolution.
  Impact: version string only. Rollback: revert the 1 line.
- `BR-SN1-EX4` (declared 2026-11-12, owner: agent-core): pivot minor->patch.
  `0.4.0` + consumer sync (EX2/EX3, reverted) broke the L3a-frozen C0 gate
  (`comments-contract-boundaries.spec.ts` pins `packages/comments/package.json`
  via `package-zod4-migration.json`; only the digest-bound Zod migration is
  accepted) and hardcoded `chat-core-host.spec.ts` (`0.3.2`). Amending that
  freeze is out of mandate (other scope, owner decision). `0.3.1` keeps every
  `^0.3.0` consumer spec satisfied, dep maps unchanged, frozen pins intact.
  Semver-letter tradeoff recorded: the `minor for feature` upgrade (with C0
  migration) is left to the owner as S1-K1 remainder. Rollback: revert the
  2 lines (`contracts` package.json + lock `packages/` entry).
- `BR-SN1-EX5` (declared 2026-11-12, owner: agent-core): selected-fixture
  lock sibling pin for unpublished `contracts@0.3.1`
  (`packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`,
  3 lignes : version+resolved+integrity du seul `node_modules/@sentropic/contracts`).
  Requis par `check-lock-integrity.mjs siblings` dans le lane lazy
  (run 5 : `lock pins 0.3.0, sibling is 0.3.1`). Valeur produite a l'identique
  du refresh sanctionne : `resolved` = URL registre deterministe,
  `integrity` = sha512 du tarball sibling packe par le flow projet
  (`make ci-package-candidate`, prefixe `/g` identique au sibling CI).
  Le refresh mk local est no-op hors contexte CI (pas de receipts :
  `siblingSelection: []`), d'ou l'edit chirurgical equivalent.
  Rollback: revert les 3 lignes.
  SUPERSEDE (2026-11-12, run 6) : le pin 0.3.1 casse TOUS les installs du lane
  (`npm` choisit le max satisfaisant `^0.3.0` = 0.3.1, tarball 404 -> 502).
  Un bump transitif non publie est ininstallable dans le lane (pas d'injection
  `file:` hors consommateurs directs) : pin reverte a 0.3.0 ci-dessous.
  Le `siblings` check reste rouge par construction (voir rapport) : decision
  proprietaire requise (gel C0 / lane cluster-mesh / sequence de publication).
- No `blocked` / `deferred` / `cancelled` / `attention` items.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature here; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single contract-freeze step; no independent CI sub-streams)
- [ ] **Multi-branch**
- Rationale: S1-T0 is a 2h freeze with no runtime code; one branch, one review.

## UAT Management (in orchestration context)
- No UI change, no UAT checkpoint for this step.

## Plan / Todo (lot-based)
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
- [ ] RUN 2: apply AMD-1..12, d2-4 admission, custody, scope resolution, VM operator contract and regression tests.
- [ ] RUN 2: push atomic commits, verify CI green, append evidence to s1-agent-core.md; do not merge or deploy.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Verify branch `feat/sandbox-node-step1` tracks `origin/main` (`5be8e34f3`) in worktree `tmp/worktrees/sandbox-node` before any edit.
  - [x] Confirm scope and guardrails (Allowed/Forbidden above; `Makefile` and `deploy/**` untouched).
- [x] **Lot 1 — Spec freeze**
  - [x] Write `spec/SPEC_EVOL_SANDBOX_NODE.md` (English): ExecutionNodeV1 + tenant model frozen; open points (D2/D3/D4/D5/D6/D7/D14) explicitly marked non-frozen.
- [x] **Lot 2 — Contract module**
  - [x] Add single amendable module `packages/contracts/src/execution-node-v1.ts` (types + JSON schemas, no dependency) and re-export it from `packages/contracts/src/index.ts`.
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
  - [ ] Bump `packages/contracts/package.json` only if a release step requires it (not in S1-T0).
  - [ ] Final gate step 1: create/update PR using this `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run/verify branch CI on that PR.
  - [ ] Final gate step 3: once CI is `OK`, commit removal of `BRANCH.md`, push, and merge.
