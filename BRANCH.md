# Feature: BR-80 — One package candidate and independent qualifications

## Objective
- [ ] Produce each immutable candidate once and preserve storage, crash, installed-consumer, and peer assertions in isolated parallel lanes.
- [ ] Branch `perf/ci-package-candidates`, step 5 of nine; train order BR-80 → BR-81; dependencies: BR-79 merged for shared-file order; BR-77 closures and BR-78 receipt contract.

## Scope / Guardrails
- [ ] Follow `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`; all timings below are **budget to measure**, not delivered results.
- [x] Work only in `tmp/worktrees/ci-package-candidates`; start from origin/main `ecca3a0d50526a25e0b76e5955f26f2557c8e0b0`; subsequent updates merge main, never rebase.
- [x] Owner override: use `ENV=test-ci-br80` last, shared Docker flock, official Make targets and teardown after each local service lot; no Python or secrets in evidence.
- [ ] Slot 0 owner: branch author; API_PORT=9400, UI_PORT=5600, MAILDEV_UI_PORT=1500; verify availability before starting services and pass all three ports to service commands.
- [ ] No migrations; keep root dev stable; no timeout inflation, removed assertions, or attribution trailers; commits ≤150 changed lines through `make commit` with scope checks.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
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
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`; `.cursor/rules/**`; `api/drizzle/*.sql`.
  - [ ] `plan/NN-BRANCH_*.md` except this branch file; `PLAN.md`; `.track/**`; production deployment configuration.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] `.github/workflows/ci.yml` under BR80-EX1; `Makefile` under BR80-EX2.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] Predecessors read: BR-78 #811 and BR-79 #826. UI 255s/180s, IdP 233s/150s, runner admission and uncompleted rollback/warm/cold campaigns remain open; BR-80 does not close them by DAG shape.
- [ ] BR80-Q1: request bounded fixture-only BR80-EX3 for `scripts/ci/publishable-ci-wiring.test.mjs`, whose exact serialized command/order assertions block the planned independent lanes; awaiting owner response before editing it.
- [ ] BR80-EX1 — Planned workflow exception: refactor `validate-cluster-mesh`, `validate-publishable-manifests`, `validate-llm-mesh`, and `validate-llm-gateway` around shared immutable candidate receipts. Impact: selected CI/CD dispatch and required results. Rollback: revert this branch's workflow changes while preserving complete-result checks.
- [ ] BR80-EX2 — Planned Makefile exception: change `cluster-mesh-workspace`, `pack-cluster-mesh`, `manifest_guard_pack`, and `pack-candidate-siblings`; add candidate/DAG fixture test targets without shared mutable state. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun their qualification.

- [ ] Record failed acceptance with run/attempt/job IDs and a responsible branch owner; do not mark an unmet budget as done.

## AI Flaky tests
- [ ] Deterministic checks are blocking. Any retained live-provider exception needs non-systematic same-commit/same-command success, failure signature, impact analysis, and explicit owner sign-off; never increase timeouts.

## Orchestration Mode (AI-selected)
- [ ] **Multi-branch** — This is one independently reviewed/qualified branch of the serialized nine-branch train.
- [ ] Rationale: preserve branch-level rollback and serialize shared workflow/Makefile edits; internal CI lanes may run concurrently.

## UAT Management (in orchestration context)
- [ ] Run the lot UAT on the exact pushed qualification SHA; record immutable source/target SHAs for any integrated qualification workspace.
- [ ] Use isolated automated environments; web/Chrome/VSCode UAT below is limited to affected behavior; no root-dev automated testing.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, relevant security/domain rules, `README.md`, `TODO.md`, the execution `PLAN.md`, the study, and `plan/BRANCH_TEMPLATE.md`.
  - [ ] Verify branch mechanically with harness; confirm prerequisite receipts and conductor registration/import before implementation; inventory the actual files and existing assertions at the new base.
  - [ ] Capture a real baseline with run/attempt/job IDs, source SHA, workflow SHA, cache state, runner class, spans, selected endpoints, and executed test identities.
  - [ ] Declare exceptions above; names marked new below are deliverables to create, not existing commands or evidence.
- [ ] **Lot 1 — Candidate closure and guard ownership**
  - [x] Implement topological public sibling closure, one build/guarded pack per member, tuple-bound archive hashes, and fail-closed partial-output handling in `package-candidate.mjs`; integration and fixtures follow.
  - [ ] Add `package-candidate.mjs` and `package-candidate.test.mjs` (new): build the topological sibling closure and pack once per source/tool tuple; hash each tarball and require all selected sibling receipts.
  - [ ] Update the named manifest/pack/install scripts and tests: wrong SHA/hash, absent archive/sibling, registry failure, and a modified packed manifest must fail; clean consumers receive tarballs, never source `node_modules`.
  - [ ] Lot gate: new `make test-ci-package-candidate ENV=test-ci-package-candidates` plus `make test-publishable-manifests test-qualify-published-install ENV=test-ci-package-candidates`.
- [ ] **Lot 2 — Independent qualification lanes**
  - [ ] Refactor the four named cluster preparation/Make files; separate static/source, PostgreSQL conformance, comments storage, crash recovery, candidate packing, and installed lanes; each mutating lane owns its workspace/database/ports.
  - [ ] Preserve existing `postgres-crashes.spec.ts`, `installed-major-upgrade.mjs`, `installed-bare.mjs`, and all packaging suite membership; maintain seed → crash/restart → verify inside each crash fixture.
  - [ ] Add `package-qualification-dag.test.mjs` (new): no installed check before packing, no second candidate build, distinct mutable fixture roots, lazy bare/selected-peer/latest-in-range/global-consumer cases retained.
  - [ ] Lot gate: new `make test-ci-package-qualification-dag ENV=test-ci-package-candidates`; `make lint-cluster-mesh typecheck-cluster-mesh test-cluster-mesh ENV=test-ci-package-candidates`; run `cluster-mesh-pg-test`, `cluster-mesh-comments-test`, `cluster-mesh-pg-crash-test`, `cluster-mesh-comments-installed`, and `cluster-mesh-pg-major-upgrade` through `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk` with distinct `ENV=test-*` last and the exact candidate tarball; run `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-ci-package-candidates` and `qualify-published-install` with candidate/sibling receipts.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Review installed package exports, optional-peer behavior, clean install, retained cursors, and PostgreSQL recovery receipts; no product UI change.
  - [ ] Budget to measure on real warm/cold qualification: complete cluster branch ≤210s versus 664s; common manifest guard ≤75s versus 125s. Account for preparation, pack, transfer, and longest installed lane; one candidate per tuple is observable.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the prior isolated preparation and serialized qualification recipes, discard only affected candidate receipts, and rerun all preserved storage/installed assertions.
- [ ] **Lot 4 — Docs consolidation**
  - [ ] Update this plan and the study with measured receipts and remaining gaps; consolidate any temporary EVOL notes before final checks; delete temporary spec scaffolding.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make lint-cluster-mesh typecheck-cluster-mesh ENV=test-ci-package-candidates`; rerun the manifest, install, candidate, and qualification-DAG fixture targets from Lots 1–2.
  - [ ] Build: `make pack-cluster-mesh ENV=test-ci-package-candidates` and the selected sibling candidate targets produce one archive per tuple; all final qualifiers consume those exact receipts without repacking.
  - [ ] API regression: product HTTP tests are not changed; `make test-cluster-mesh ENV=test-ci-package-candidates` and the five named PostgreSQL/comments/crash/installed/major-upgrade lanes remain required with isolated databases and exact candidate bytes.
  - [ ] UI regression: not applicable; no UI code, build recipe, or test membership changes.
  - [ ] E2E regression: product browser lanes are unchanged; rerun `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-ci-package-candidates` and all named installed-consumer suites, preserving seed → crash → verify ordering.
  - [ ] Run local service gates sequentially on slot 0, stopping the prior environment before reusing its ports; concurrent CI lanes need separately registered environments and port tuples.
  - [ ] Apply required package version bumps and lock refresh if package source changes; qualify exact candidate bytes; no source-change bump is waived.
  - [ ] Run `make scope-check ENV=test-ci-package-candidates` before each commit; end isolated service lots with `make down ENV=test-ci-package-candidates` and `make down ENV=e2e-ci-package-candidates`.
  - [ ] Create/update the PR using `BRANCH.md`; obtain review and green CI/UAT on the same head; only then hand off to the authorized merge operator for branch-plan removal and merge.

## Integrated Main Plan (retained context)

- [x] Preserve the Decision Q1 plan from origin/main as historical integration context; its scope and pending tasks do not authorize additional work on BR-80.

> # Feature: Decision Q1 live qualification smoke
> 
> ## Objective
> - [ ] Record bounded live protocol and identity evidence for JEV and OpenAI Decisions; keep production refused pending OD-4 calibration.
> 
> ## Scope / Guardrails
> - [x] Owner GO dated 2026-10-29; spec v4 section 7.4; H1/H2 base `213638676`.
> - [x] Worktree `tmp/worktrees/decision-q1`, branch `feat/decision-q1-live`, mono-branch.
> - [x] Make only; no Python; secrets enter Compose from the existing root `.env` without copying values.
> - [x] Maximum three attempts per candidate, counting failed, refused and ambiguous calls; no retries.
> - [x] Local qualification only, `ENV=test-decision-q1` last; API 8802, UI 5202, Maildev 1102.
> - [x] Serialize Docker with `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; run `make down` afterward.
> 
> ## Branch Scope Boundaries (MANDATORY)
> - **Allowed Paths (implementation scope)**:
>   - `BRANCH.md`
>   - `spec/decision/**`
>   - `packages/llm-mesh/src/decision/descriptor.ts`
>   - `packages/llm-mesh/src/decision/openai-descriptor.ts`
>   - `packages/llm-mesh/src/decision/descriptor-validation.ts`
>   - `packages/llm-mesh/package.json`
>   - `package-lock.json`
>   - `packages/llm-mesh/tests/decision-public-surface.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-v4l3.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification-admission.test.ts`
>   - `packages/llm-mesh/tests/decision-qualification.test.ts`
>   - `packages/llm-mesh/tests/decision-jev-request.test.ts`
>   - `packages/llm-mesh/tests/decision-openai-routing.test.ts`
>   - `packages/cluster-mesh/tests/fixtures/train.ts`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
>   - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
> - **Forbidden Paths (must not change in this branch)**:
>   - `Makefile`
>   - `docker-compose*.yml`
>   - `.cursor/rules/**`
>   - `api/**`
> - **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
>   - `.github/workflows/**`
> 
> ## Feedback Loop
> - [x] No calibration authorized; live observations cannot qualify immutable weights, billing beyond the admitted bound, or production readiness.
> - [x] Q1-CRED-01: JEV preflight refused peripheral whitespace; normalized transiently after Compose injection, source env unchanged; refusal consumes attempt 1.
> - [x] Q1-INV-01: parser previously forbade observed IDs with unqualified production status; permit evidence inventory while retaining admission gates; regression keeps nonempty IDs and proves production refusal.
> - [ ] Q1-REV-01: conductor to select two exact complementary reviewer models before merge; h2a discovery has host presence but no model identities, no configured gateway catalog; no consensus claimed.
> - [x] Q1-CI-01: reproduced job 123314702961's three stale-version failures; rebound independent train and selected fixture to llm-mesh 0.32.2 and guarded archive SHA-512; 1,228 cluster-mesh tests and scope pass, 138 expected skips; see `spec/decision/q1-2026-10-29/ci-repair.md`.
> 
> ## AI Flaky tests
> - [x] No flaky acceptance or additional live calls beyond the cap.
> 
> ## Orchestration Mode (AI-selected)
> - [x] Mono-branch; no integration from other branches.
> 
> ## UAT Management (in orchestration context)
> - [x] API-only qualification fixture; no UI, Chrome or VSCode surface change.
> 
> ## Plan / Todo (lot-based)
> - [x] **Lot 0 — Baseline and constraints**
>   - [x] Read master/workflow rules, spec section 7.4, API host and descriptors; mechanical branch check passed.
>   - [x] Verify ports, credential names, control pricing and isolated stack.
> - [x] **Lot 1 — Bounded live evidence**
>   - [x] Fix a public synthetic binary criterion and retain only that fixture input.
>   - [x] No documented zero-cost Decisions entitlement probe established; first POST counts as attempt 1.
>   - [x] Record served identity, tokens, priced cost, billing bound, latency, verdict shape and refusals per attempt.
>   - [x] Fail closed on descriptor identity mismatch; three calls per candidate including the JEV preflight refusal, five egresses total, 77 micro-USD.
> - [x] **Lot 2 — Evidence and descriptors**
>   - [x] Retain scrubbed receipts in `spec/decision/`; accepted identities/evidenceRefs cite only observed results.
>   - [x] Bump llm-mesh from published 0.32.1 to 0.32.2; align workspace lock and public version assertion.
>   - [x] Preserve unqualified production and OD-4 calibration requirement; 16 host/route tests pass.
> - [ ] **Lot 3 — Final validation and draft PR**
>   - [x] Mesh descriptor, qualification, adapter, pricing, public and request suites: 88 files / 1,566 tests pass.
>   - [x] llm-mesh typecheck/lint and mechanical scope checks pass; commits at most 150 lines.
>   - [x] Secret scan, attempt counts, identity comparison and durable 77 micro-USD ledger verified; zero reserved/pending.
>   - [x] Stop local stack with `make down`; publish report `spec/decision/q1-live-smoke.md`.
>   - [x] Draft PR #834 created against main; exact-head CI remains the final checkpoint.
>   - [ ] Observe CI completed/success on exact head; report head, 77 micro-USD and candidate outcomes.
