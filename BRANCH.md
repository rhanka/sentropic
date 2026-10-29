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
  - [ ] `scripts/ci/ci-expected-results.mjs`; `scripts/ci/ci-expected-results.test.mjs` under BR80-EX6.
  - [ ] `tools/memory-mcp-l5/tests/ci-contract.test.mjs` under BR80-EX7.

- [ ] **Exception process**: apply only the declared purpose; record reason, impact, and rollback before changing a conditional path; any additional path needs its own bounded exception.

## Feedback Loop
- [x] BR80-EX6 — Owner-requested repair of run 40792716438/job 123195302088: the policy rejects candidate consumers' producer dependency, not a slot limit. Permit only the four declared consumers after `package-candidates`, require that producer after `changes`, and reject all other validator serialization. Impact: DAG contract and negative fixtures only; keep demand, widths, mutex and measured-proof gates unchanged. Rollback: revert this contract together with BR80-EX1's candidate DAG.
- [x] Capacity repro: 73 PR/72 push slots, `independentValidators: false`, unchanged API/E2E widths 15/5. The first repaired run reaches the previously blocked fixtures and exposes their old scalar cluster-job lookup; require every actual matrix member instead.
- [x] BR80-EX7 — Owner-requested repair of run 40792716438/job 123195302026: L5's workflow fixture names the removed serialized pack step. Follow producer, download, verification and unconditional sibling export before qualification. Impact: fixture only; preserve all L5/runtime/SDK assertions. Rollback: restore the fixture together with the serialized DAG.
- [x] Local capacity policy passes with unchanged 73/72 demand and unaccepted measured wall-clock proof; 35 metrics and 25 expected-results fixtures pass. L5 tooling passes all 104 tests after reproducing the original 103/104 failure.
- [x] Reproduce both failures and qualify fixes under the shared Docker flock, `ENV=test-ci-br80` last, then teardown: capacity policy and all 60 fixtures pass; the complete `memory-l5-gate LOT=1` passes, including packed/source graphs, typechecks, 104 tooling tests and all lot-scoped package suites. Exact-head completed successful CI remains required.
- [x] Predecessors read: BR-78 #811 and BR-79 #826. UI 255s/180s, IdP 233s/150s, runner admission and uncompleted rollback/warm/cold campaigns remain open; BR-80 does not close them by DAG shape.
- [ ] BR80-Q1: request bounded fixture-only BR80-EX3 for `scripts/ci/publishable-ci-wiring.test.mjs`, whose exact serialized command/order assertions block the planned independent lanes; awaiting owner response before editing it.
- [x] BR80-Q2: owner explicitly requested the capacity-policy repair in this session; BR80-EX6 bounds the implementation and fixtures while retaining complete-result and security barriers.
- [ ] BR80-Q3: request BR80-EX5 for `packages/cluster-mesh/tests/packaging/stateful-consumer.sh`: replace its five duplicate packs with verified archives; retain every existing assertion and suite; awaiting owner response.
- [ ] BR80-Q3 extension: the preserved `packages/llm-gateway/tests/auth-subpaths.test.ts` also compiles and repacks mesh/gateway candidates; its archive setup needs the same bounded receipt-reuse exception. Assertions and suite membership must remain unchanged.
- [x] Gateway snapshot repro at c48a42fae: 77 files/1367 tests pass, but auth-subpaths cannot resolve its expected package-local node_modules/vitest. Restore that tooling link only inside the disposable gateway workspace; rerun the unchanged suite.
- [x] Add a real guarded-pack regression: an unrelated selected package is outside the shared closure and must retain its own full pack. The initial fixture fails with `missing selected candidate: outside`; restrict receipt reuse to closure members and preserve full guard/bump checks for other packages.
- [x] Lazy repro at e73835d39 rejects unchanged oauth-verify bytes and mcp-auth 0.2.2 against the committed frozen 0.2.1 tuple. Preserve the lock assertions: classify sibling injection independently from the once-built preparation closure, using the existing same-PR BLOCK classifier; export and require every selected sibling only.
- [x] Common WARN inventory also reads the verified release-candidate manifest without another snapshot pack; an actual-archive regression retains standalone snapshots for packages outside the shared closure.
- [ ] Comments lane at e73835d39: 109/110 tests pass; comments-export exceeds its unchanged 5000ms limit. Keep the failure blocking; investigate with the exact isolated command, without timeout or durability changes.
- [x] b52e3bbb4: isolated comments-export and all 110 comments tests pass without source/assertion/timeout/durability changes; the earlier timeout remains recorded and final CI is still required. The producer reuse receipt is byte-identical and completes in 13s without another pack.
- [x] Lazy at b52e3bbb4: 109/110 assertions pass after selection repair; the remaining offline preparation fixture inherits the new real-bundle variable into its stub npm. Clear that variable after real preparation and before Vitest, retaining bundle validation and every fixture assertion.
- [x] Baseline PR 40748328717 attempt 1, head 949d47c8ced0426a010da639ac910229d5699874, success: cluster 991s/123051431364; manifests 65s/123051430739; mesh 71s/123051431590; gateway 199s/123051431190. Raw paginated receipts: `.tmp/ci-br80/receipts/40748328717/`.
- [x] Inspect inherited IdP receipt 123085229315: checkout/setup 31/11s, API transfer/load 3/22s, toolbox 16/34s, browser 14/16s, startup 45s, smoke 5s, teardown 31s; no optimization or <=150s acceptance claimed.
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
  - [x] Add real archive fixtures for reuse, substitution, missing siblings, hash/manifest tampering, registry failure and cycles, plus the declared BR80-EX2 fixture entry points.
  - [x] Candidate-aware guarded pack and sibling export verify the complete receipt set and reuse exact bytes; they preserve the existing packed-manifest and registry bump checks.
  - [x] Clean-consumer qualification checks its primary archive against the complete candidate index and requires every selected sibling hash; consumers receive only read-only archives/scripts, with no source dependency tree.
  - [x] Direct installed-comments/major-upgrade targets also validate their supplied primary tarball against the candidate index before PostgreSQL startup when a bundle is selected.
  - [ ] Add `package-candidate.mjs` and `package-candidate.test.mjs` (new): build the topological sibling closure and pack once per source/tool tuple; hash each tarball and require all selected sibling receipts.
  - [ ] Update the named manifest/pack/install scripts and tests: wrong SHA/hash, absent archive/sibling, registry failure, and a modified packed manifest must fail; clean consumers receive tarballs, never source `node_modules`.
  - [ ] Lot gate: new `make test-ci-package-candidate ENV=test-ci-package-candidates` plus `make test-publishable-manifests test-qualify-published-install ENV=test-ci-package-candidates`.
- [ ] **Lot 2 — Independent qualification lanes**
  - [x] Add a candidate preparation action and immutable prepared archive; each source/storage lane restores it into its own disposable container, with source/tool identity and hash verification before extraction. CI fan-out remains to wire.
  - [x] Add a contents-read-only producer job with full-SHA actions, failing artifact upload, and a separate read-only Make verification entry point; the final verdict wiring follows with lane fan-out.
  - [x] Packed lazy qualification skips sibling builds with an explicit candidate bundle and verifies/reuses cluster/artifacts/platform/train archives; bare, selected, session, latest, global, old and partial tuples retain their existing installs/assertions.
  - [x] Add nine isolated qualification dispatch cases using the original source/storage/crash/installed/upgrade/lazy/stateful commands; add clean-consumer negatives for unlisted primary bytes and wrong source SHA.
  - [x] Declare nine fail-fast-disabled cluster matrix members, each with its own runner workspace/environment and read-only source permission, downloading/verifying the same producer bundle before dispatch.
  - [x] Route source, audits, storage and stateful checks through the lane dispatcher; remove their repeated build/preparation steps from the serialized workflow body.
  - [x] Remove the remaining serialized installed/upgrade/lazy/install steps now owned by independent lanes; teardown each lane's database/network and Compose environment with unconditional cleanup.
  - [x] LLM mesh/gateway consume the prepared closure and retain lint, compiler, tests, model-equivalence and packed-manifest checks; remove their repeated sibling compilation/packing.
  - [x] The common inventory verifies shared BLOCK candidate receipts rather than repacking their closure. The producer is a direct final-gate/capacity-receipt dependency; actual cluster matrix members remain in the complete-result manifest.
  - [x] Exact candidate/manifest/install script paths select their package-family integration without selecting application images; the DAG fixture checks this implementation-only case.
  - [x] Add qualification-DAG fixtures covering every actual matrix member, missing/cancelled/skipped/neutral failures, lane ownership, crash order, retained lazy tuples, least privilege and full action pins.
  - [x] Require named Node/npm identities and passing BLOCK receipts; a repeated producer restores and verifies its sealed preparation rather than constructing a new snapshot without compiled outputs. Preparation substitution negatives cover the extraction boundary.
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
  - [x] Record the identified predecessor package baseline and inherited IdP stage spans in study section 13 and plan/66; post-change timings and exact-head acceptance remain open.
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
