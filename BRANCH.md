# Fix: Make qualification failure trials reproducible and isolated

## Objective
- [ ] Close qualification safety gaps with real failure trials and behavioral regressions; preserve blocked admission.

## Scope / Guardrails
- [x] Branch `fix/sec5a-qualification-safety`, worktree `tmp/sec5a-qualification-safety`, base `401cffae1`.
- [x] Make-only, Docker-first, zero Python; ENV=test-sec5a-safety last; no application stack or host ports.
- [x] Docker flock: `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; down after campaigns.
- [x] No daily activation, scheduling, auto-merge, vulnerability exceptions, policy admission or package changes.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/**`
  - `docs/security/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.security/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.

## Feedback Loop
- [x] SECQUAL-EX1 inherited include remains opt-in only; removal trigger: qualification completes or is abandoned; expiry 2026-11-12, after which qualification trials must stop until renewed. No runtime admission exception.
- [x] Scanner HIGH/CRITICAL, independent trust custody, canonical targets, SAST/IaC, builder and performance remain separate admissions.

## AI Flaky tests
- [x] None accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch; independent from `fix/sec5a-ci-guards` (#848); later qualification groups depend only on main.

## UAT Management (in orchestration context)
- [x] No application changes; live scanner trials and shell failure controls replace UI UAT.

## Plan / Todo (lot-based)
- [x] Lot 0: rules, owner answers and #840 review read; mechanical branch check PASS C1.
- [x] Lot 1: `toolchain-cache.mjs` classifies absent cache; `toolchain-contract.test.mjs` verifies failure without network or fallback.
- [x] Lot 2: `qualify-targets.sh` reads only named `.env` fields as data; `scan.test.mjs` exercises hostile values and parser rejection.
- [x] Lot 3: `qualify-scans.sh` cleans its container after failures; `scan.test.mjs` simulates Docker mid-trial failure.
- [x] Lot 4: live hostile configuration control with pinned Log4j and fresh frozen DBs; default control 0 findings, hardened control 8 CVEs including Log4Shell; public receipt and docs retained.
- [x] Lot 5 tests: daily suite 127/127 and parser suite 17/17 passed; scope check PASS C2.
- [ ] Lot 5 delivery: exact-head independent review and CI; PR from this file.
- [x] No `packages/*/src/**` changes; package publication version gate not applicable.
- [x] Review hardening: reject registry option injection and enforce SECQUAL-EX1 expiry mechanically with UTC boundary regressions.
- [x] Review hardening: bind config-control receipts to observed container inspection, exact scanner pins and ingestion-selected DB mounts; real control rerun passed; daily suite 128/128.
- [x] Re-review: embedded DB receipts must equal verified disk receipts; scanner version, exact package and zero default findings are required; scoped 20/20 and daily 130/130; real trial rerun passed.
- [x] Keep PR open; never merge or enable auto-merge.
- [x] Muse r1 items 2–3: execute target authentication with hostile dotenv; pin every qualification target's transitive expiry dependency and require UTC date arguments.
- [x] Muse r1 item 4: tests first reproduced three failures, then 25/25 scoped pass; extracted validator rejects 25 forged isolation records and wrong-kind snapshots; real control rerun retains Privileged/CapAdd and preserves scanner pins/flags.
- [x] Muse r1 item 1 rebase: retain main's BR-80/Q1 context below; non-plan diff byte-identical before/after rebase; Post-Rebase Gate has no touched package sources.
- [x] Muse r1 final local gates: daily 135/135, security parser 17/17, composed publishable fixtures 235/235, real config control/receipt and scope PASS C2; exact-head CI remains the delivery gate.

## Integrated Main Plan (retained context)

- [x] Retain BR-80 and Decision Q1 context below; only the active qualification scope above authorizes this branch.

# Feature: BR-80 — One package candidate and independent qualifications

## Objective
- [ ] Produce each immutable candidate once and preserve storage, crash, installed-consumer, and peer assertions in isolated parallel lanes.
- [ ] Branch `perf/ci-package-candidates`, step 5 of nine; train order BR-80 → BR-81; dependencies: BR-79 merged for shared-file order; BR-77 closures and BR-78 receipt contract.

## Scope / Guardrails
- [x] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; section 13 records actual first measurements and failed budgets; final/repeated warm/cold acceptance remains open.
- [x] Work only in `tmp/worktrees/ci-package-candidates`; start from origin/main `ecca3a0d50526a25e0b76e5955f26f2557c8e0b0`; updates use `git rebase origin/main` and the post-rebase version gate per COMMON-RULES.
- [x] Owner override: use `ENV=test-ci-br80` last, shared Docker flock, official Make targets and teardown after each local service lot; no Python or secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9400, UI_PORT=5600, MAILDEV_UI_PORT=1500; verify availability before starting services and pass all three ports to service commands.
- [x] No migrations, timeout inflation, removed assertions or attribution trailers; root dev preserved. Correction commits use `make commit` and scope checks at ≤150 lines; the sole historical docs exception is recorded below.

## Branch Scope Boundaries (MANDATORY)
- [ ] Allowed Paths (implementation scope):
  - [ ] `BRANCH.md`; `plan/66-BRANCH_perf-ci-package-candidates.md`; `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`.
  - [ ] `packages/cluster-mesh/tests/storage/cold-workspace.sh`
  - [ ] `packages/cluster-mesh/tests/storage/postgres.mk`
  - [ ] `packages/cluster-mesh/packaging.mk`
  - [ ] `packages/cluster-mesh/tests/packaging/prepare.sh`
  - [ ] `scripts/ci/publishable-manifests.mjs`
  - [ ] `scripts/ci/publishable-manifests.test.mjs`
  - [ ] `scripts/ci/publishable-pack.test.mjs`
  - [ ] `scripts/ci/qualify-published-install.mjs`
  - [ ] `scripts/ci/qualify-published-install.test.mjs`
  - [ ] `scripts/ci/package-candidate.mjs`
  - [ ] `scripts/ci/package-candidate.test.mjs`
  - [ ] `scripts/ci/package-qualification-dag.test.mjs`
- [ ] Forbidden Paths (must not change in this branch):
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths):
  - [ ] `.github/workflows/ci.yml` under BR80-EX1; `Makefile` under BR80-EX2.
  - [ ] `scripts/ci/ci-expected-results.mjs`; `scripts/ci/ci-expected-results.test.mjs` under BR80-EX6.
  - [ ] `tools/memory-mcp-l5/tests/ci-contract.test.mjs` under BR80-EX7.
  - [ ] `scripts/ci/publishable-ci-wiring.test.mjs` under BR80-EX8.
  - [x] `packages/cluster-mesh/tests/packaging/stateful-consumer.sh`; `packages/llm-gateway/tests/auth-subpaths.test.ts` under BR80-EX5.
  - [ ] `api/tests/fixtures/canvas-live/**`; `docs/canvas-live/**`; `ui/tests/fixtures/canvas-live/**` under BR80-EX9, unchanged imports from main only.
  - [ ] `api/tests/queue/workflow-transition-runtime.test.ts`; `packages/flow/src/dispatch.ts`; `packages/flow/package.json`; `package-lock.json` under BR80-EX10.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
