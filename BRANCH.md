# Feature: Deployable LLM process specification (Lot D)

## Objective
- [ ] Specify an autonomous Node/TypeScript LLM gateway process, deployment, budget admission, identity binding, and seat-secret consumption; deliver design only.

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
- [x] D-FL1 | Branch: Lot D | Owner: conductor | Severity: process | Status: attention | Repro: harness recorder/review writes extra artifacts | Expected: two-file scope | Actual: record design here and defer independent review to conductor | Evidence: owner brief | Rationale: preserve explicit planning scope; no consensus claimed.
- [x] D-FL2 | Branch: Lot D | Owner: conductor | Severity: evidence | Status: attention | Repro: search supplied roots for validation id/original phrase | Expected: original conductor artifact | Actual: no match | Evidence: spec section 0 | Rationale: retain brief attribution and independently verified code findings.
- [x] D-FL3 | Branch: Lot D | Owner: gateway maintainer | Severity: design | Status: attention | Repro: compare package and h2a entry points | Expected: autonomous host | Actual: select thin private Node app, port 3001, same router factory | Evidence: spec D1-D3 | Rationale: reversible composition without a new published CLI contract.
- [x] D-FL4 | Branch: Lot D | Owner: ledger/identity maintainer + conductor | Severity: build gate | Status: blocked (future build only) | Repro: compare BR-47 to current schema | Expected: durable admission and generic bindings | Actual: proposed G1 requires migration ratification | Evidence: spec D4-D5 | Rationale: design delivered; no schema mutation authorized here.
- [x] D-FL5 | Branch: Lot D | Owner: deployment maintainer | Severity: design | Status: attention | Repro: inspect base manifests | Expected: independently deployable gateway | Actual: select dedicated Node image, internal Service, one replica/Recreate | Evidence: spec D6 | Rationale: conservative reversible rollout, with quota and egress validation before activation.
- [x] D-FL6 | Branch: Lot D | Owner: custody maintainer | Severity: design | Status: attention | Repro: reconcile custody section 4 with BR-73 | Expected: current own-seat credentials without competing refreshers | Actual: access-only Secret projection and fenced Postgres hydration; external sole refresher | Evidence: spec D7 | Rationale: reversible binding prevents rotating-token races; runtime refresh disabled only for custody-managed seats.
- [x] D-FL7 | Branch: Lot D | Owner: conductor/deployment operator | Severity: build gate | Status: blocked (future build only) | Repro: enumerate forbidden paths and live delivery dependencies | Expected: approved build scope | Actual: BRDP-EX1..5 proposed; G2 promotion and G3 egress evidence pending | Evidence: spec sections 8-9 | Rationale: no infrastructure edits or approvals implied by this spec.

## AI Flaky tests
- [x] Not applicable: documentation-only branch; no provider calls or runtime tests.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no cherry-pick or delegated implementation.
- [x] Multi-branch execution is deferred to the conductor for future build lots.

## UAT Management (in orchestration context)
- [x] No web, Chrome, or VSCode behavior changes; user-interface UAT is not applicable here.
- [ ] Specify operational UAT for standalone/composed gateway, tenant isolation, budgets, seat rotation, and rollout in the spec.

## Plan / Todo (lot-based)
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
- [ ] **Lot 2 — Admission, identity, and delivery plan**
  - [x] Specify ledger-backed over-budget emission, identity table ownership/storage/schema, and seat-secret consumption.
  - [ ] Specify CI image build/publish, future `BRxx-EXn` exceptions, lot dependencies, file-level tests and operational UAT.
  - [x] Classify reversible defaults and irreversible future gates; record decisions in Feedback Loop.
  - [ ] Gate: source-contract review and `make scope-check ENV=test-llm-deployable-process` before commit.
- [ ] **Lot 3 — Consolidation and final validation**
  - [ ] Reconcile all requested deliverables against existing contracts and mark unresolved dependencies explicitly.
  - [ ] Review every diff hunk and run `make scope-check ENV=test-llm-deployable-process`; runtime typecheck/lint/test not applicable to prose.
  - [ ] Commit only the two allowed files via `make commit`; preserve `BRANCH.md` for conductor handoff.
  - [ ] Run cleanup `make down API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process` and inspect `make ps API_PORT=9460 UI_PORT=5660 MAILDEV_UI_PORT=1560 ENV=test-llm-deployable-process`.
  - [ ] Report exact checks, feedback, risks, scope, and `git log --oneline origin/main..HEAD`.
