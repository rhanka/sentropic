# Feature: Deployable LLM process specification (Lot D)

## Objective
- [x] Specify an autonomous Node/TypeScript LLM gateway process, deployment, budget admission, identity binding, and seat-secret consumption; deliver design only.

## Scope / Guardrails
- [x] Branch `spec/llm-deployable-process`; worktree `tmp/llm-deployable-process`; requested base `origin/main` at `75032fc85`.
- [x] Read mandatory rules and template; `harness check branch` passed before editing.
- [x] No implementation, migration, package bump, publication, push, PR, or merge in this branch.
- [x] Make-only validation/commits; selective staging; English text; approximately 150 changed lines per commit.
- [x] Environment `test-llm-deployable-process`; reserved cleanup arguments `API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560`; no services planned or started.
- [x] `ENV` is last in every make command; root development environment remains untouched.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] All files outside the two allowed paths, including code, `.track/**`, `Makefile`, `docker-compose*`, `.github/workflows/**`, `deploy/**`, `.cursor/rules/**`, and `plan/**`.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None in this branch; future build exceptions are proposals only.
- [x] **Exception process**:
  - [x] Future `BRxx-EXn` proposals must state reason, impact, rollback, and approval gate; none authorizes a change here.

## Feedback Loop
- [x] O-D1 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | Seat delivery (a) maintained with full knowledge: the scheduled GitHub Actions job updates the GitHub Secret and pushes the fresh access token into k8s; this is the first automated CI→cluster Secret write, with no CI precedent.
- [x] O-D2 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | IRREVERSIBLE G1a BR-47 budget migration is ratified now and part of Lot D's build design; real over-budget HTTP 429 is required. G1b identity bindings remain deferred; v0 uses memberships and service_clients. No migration is executed on this planning branch.
- [x] O-D3 | direct owner decision | Owner: product owner via conductor | Date: 2026-09-24 | Status: acknowledge | Preprod first using KUBE_CONFIG_DATA_PREPROD; no production Role design now. Production seat delivery and its new security gate return to the owner only after the IP-change spike passes and the refresh/delivery loop is stable.
- [x] D-FL1 | Branch: Lot D | Owner: conductor | Severity: process | Status: attention | Repro: harness recorder/review writes extra artifacts | Expected: two-file scope | Actual: record design here and defer independent review to conductor | Evidence: owner brief | Rationale: preserve explicit planning scope; no consensus claimed.
- [x] D-FL2 | Branch: Lot D | Owner: conductor | Severity: evidence | Status: attention | Repro: search supplied roots for validation id/original phrase | Expected: original conductor artifact | Actual: no match | Evidence: spec section 0 | Rationale: retain brief attribution and independently verified code findings.
- [x] D-FL3 | Branch: Lot D | Owner: gateway/cluster maintainer | Severity: design | Status: attention | Repro: reconcile F1 with lazy-surface E1/E7 | Expected: one loading and mounting path | Actual: private Node host on port 3001 uses cluster-mesh registry/loaders/namespace module; product and external identities are partitioned per tenant | Evidence: spec D1-D3 | Rationale: preserve domain independence and existing cutover storage without another dispatcher.
- [x] D-FL4 | Branch: Lot D | Owner: ledger/identity maintainer + conductor | Severity: build gate | Status: blocked (future build only) | Repro: compare BR-47 to current schema | Expected: durable admission and generic bindings | Actual: proposed G1 requires migration ratification | Evidence: spec D4-D5 | Rationale: design delivered; no schema mutation authorized here.
- [x] D-FL5 | Branch: Lot D | Owner: deployment maintainer | Severity: design | Status: attention | Repro: inspect base manifests | Expected: independently deployable gateway | Actual: select dedicated Node image, internal Service, one replica/Recreate | Evidence: spec D6 | Rationale: conservative reversible rollout, with quota and egress validation before activation.
- [x] D-FL6 | Branch: Lot D | Owner: custody maintainer | Severity: design | Status: attention | Repro: reconcile custody section 4 with BR-73 | Expected: current own-seat credentials without competing refreshers | Actual: access-only Secret projection and fenced Postgres hydration; external sole refresher | Evidence: spec D7 | Rationale: reversible binding prevents rotating-token races; runtime refresh disabled only for custody-managed seats.
- [x] D-FL7 | Branch: Lot D | Owner: conductor/deployment operator | Severity: build gate | Status: blocked (future build only) | Repro: enumerate forbidden paths and live delivery dependencies | Expected: approved build scope | Actual: BRDP-EX1..5 proposed; G2 promotion and G3 egress evidence pending | Evidence: spec sections 8-9 | Rationale: no infrastructure edits or approvals implied by this spec.
- [x] D-FL8 | Branch: Lot D | Owner: gateway/mesh/ledger maintainers | Severity: design | Status: attention | Repro: inspect route admission and settlement | Expected: enforced caps without duplicate billing | Actual: select pure liability quote, pre-acquisition reservation and one aggregate settlement | Evidence: spec D5 | Rationale: reversible port design preserves existing ledger/wire and prevents unreserved fallback.

## AI Flaky tests
- [x] Not applicable: documentation-only branch; no provider calls or runtime tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no cherry-pick or delegated implementation.
- [x] Multi-branch execution is deferred to the conductor for future build lots.

## UAT Management (in orchestration context)
- [x] No web, Chrome, or VSCode behavior changes; user-interface UAT is not applicable here.
- [x] Specify operational UAT for standalone/composed gateway, tenant isolation, budgets, seat rotation, and rollout in the spec.

## Plan / Todo (lot-based)
- [ ] **Lot D — Revision round 1 (F1-F11)**
  - [x] Read required rules/template and both sibling specs read-only; branch check passed; starting tree clean.
  - [x] Record O-D1/O-D2/O-D3 as direct owner decisions; later decisions supersede earlier review requests.
  - [x] F1: cluster-mesh loading/mounting, per-tenant identity partition, existing composition-root cutover record, h2a host retirement and dependency handoff.
  - [ ] F5/F6/F7/F10: ratified G1a, deferred G1b, one ledger row, bounded retry hint and split admission lots with B0 quote decision.
  - [ ] F3/F4/F8/F11: current custody source/refresher/projection resolver, preprod-only write identity, operator DB-secret channel and backup residual risk.
  - [ ] F2/F9/F10: reuse API image, narrow exceptions/CI, manual G3 network gate and reconcile build/acceptance plan.
  - [ ] Review final diff and requested findings; run scope check before each commit, cleanup/status, and collect final history. Independent review remains conductor-owned.
- [x] **Lot 0 — Evidence and scope**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, project overview and relevant plan context.
  - [x] Create this file before the specification; verify branch mechanically and inspect make targets.
  - [x] Read package exports/router/stubs, h2a entry point, deployment manifests/readme, quota/metering/routing/control-plane specs, and in-progress seat custody.
  - [x] Locate original conductor wording or document an explicit evidence limitation (D-FL2).
  - [x] Gate: `make scope-check ENV=test-llm-deployable-process` passed before the initial plan commit.
- [x] **Lot 1 — Process and deployment design**
  - [x] Write `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md`: evidence, numbered decisions, entry point ownership, image, namespaces, probes, k8s and secrets.
  - [x] Specify which h2a responsibilities move upstream and which stay consumer-owned.
  - [x] Gate: source-contract review and `make scope-check ENV=test-llm-deployable-process` passed on preceding process/admission commits; repeat before each remaining commit.
- [x] **Lot 2 — Admission, identity, and delivery plan**
  - [x] Specify ledger-backed over-budget emission, identity table ownership/storage/schema, and seat-secret consumption.
  - [x] Specify CI image build/publish, future `BRxx-EXn` exceptions, lot dependencies, file-level tests and operational UAT.
  - [x] Classify reversible defaults and irreversible future gates; record decisions in Feedback Loop.
  - [x] Gate: source-contract review and `make scope-check ENV=test-llm-deployable-process` passed on preceding delivery commit; repeat before final commit.
- [x] **Lot 3 — Consolidation and final validation**
  - [x] Reconcile all requested deliverables against existing contracts; spec sections 0-11 name evidence, decisions, file-level build tests, future exceptions and unresolved dependencies.
  - [x] Review every diff hunk; `git diff --check origin/main` and `harness check branch` passed. Runtime typecheck/lint/test are not applicable to prose; future recipes are explicitly marked unexecuted.
  - [x] `make scope-check ENV=test-llm-deployable-process` passed before each preceding commit; final staged scope gate is required again for this completion commit.
  - [x] Commit only the two allowed files via `make commit`; preserve `BRANCH.md` for conductor handoff; no push/PR/merge/publication.
  - [x] Cleanup passed: `make down API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process`; `make ps API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process` returned no services. Compose only warned that `DISABLE_RATE_LIMIT` is unset; no service was started.
  - [x] Prepare handoff with exact checks, D-FL1..8, G1-G4 risks, two-file scope, and final `git log --oneline origin/main..HEAD`.
