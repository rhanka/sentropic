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
- [x] Owner-authorized PR #829 merge-train resolution rebases onto main `d08517ed178ce55c7ef631e88b4ee0018dd39647`: retain one package-candidates producer and consumers, six one-day transport artifacts, cleanup after successful ci-gate, complete/success-or-skipped current-attempt checks, and union exemptions/receipt needs. Remove only the duplicate permissions helper/test introduced by automatic composition with #841; exact-head checks and review are recorded in `.tmp/merge-train/829-resolution-final.md`.
- [x] Post-rebase local qualification under the shared Docker flock and `ENV=test-ci-br80`: manifest/wiring 223, candidate 9, qualification-DAG 8, expected-results 28, general DAG 8, capacity metrics 35 and installed-consumer fixtures 19 pass; npm-view Post-Rebase Gate passes for Flow 0.2.1 > 0.2.0. No product assertions, peers, timeouts or publication barriers changed.
- [x] Review r2 receipt refresh: run 40928684313/1 is terminal cancelled. Grouped-design run 40950429629/1 on afdf3a318 completed/success: producer 77s; groups 179/172/199s; cluster path 276s/297s with changes against ≤210s; guard 101s against ≤75s; mesh/gateway 63/102s. Both budgets remain deferred as `BR84-BR80-CLUSTER` and `BR84-BR80-MANIFEST`, CI-train author on BR-84, unchanged thresholds and repeated identified warm/cold receipts required. Admission: changes began 43m07s after creation; no budget or capacity acceptance.
- [x] Review r2 rebase onto origin/main `76c90aef0a`: retain BR-80 active plan; preserve main's chat-runtime removal in workflow, Makefile, lock and manifest catalog; combine the 24-validator contract with candidate dependency assertions and name chat-core in serialization negatives. Post-Rebase Gate: Flow is the only package with source changes versus main; local 0.2.1 exceeds registry 0.2.0. Exact-head terminal CI remains required after this update.
- [x] Review correction receipts: local candidate bundle at 062996cea passes all 11 forced-BLOCK archives; unchanged stateful suite passes 15+1 tests and `INSTALLED_STATEFUL_C1_C7_OK`; gateway typechecks and all 78 files/1,370 tests pass, including all 3 auth-subpaths tests. Full manifest/wiring 223, candidate 9, qualification-DAG 8, install 19, L5 tooling 104 and gateway lint pass. After the final cleanup-order change, composed wiring 153, expected-results 27, general DAG 8, qualification-DAG 8 and capacity shape pass. Logs: `.tmp/ci-br80/review-{producer,stateful,gateway,final-fixtures,postgate}.log`; final exact-head GitHub completion remains open.
- [x] Review item 2 — Run 40928684313/attempt 1/head 0d4bf1ca4: producer 97s (123651400522), longest/source 149s (123663293264), manifests 82s (123663292699); cluster path 246s/265s with changes versus ≤210s and guard 82s versus ≤75s both fail budget. Defer `BR84-BR80-CLUSTER` and `BR84-BR80-MANIFEST` to the CI-train author on BR-84 with unchanged thresholds, repeated identified warm/cold receipts and complete assertions. Study §13.1 records all jobs, queue spans, runner cost and limits; this is no wall-clock or final-CI acceptance.
- [x] Cleanup contract covers all six current-run transport names, every consumer/producer ancestor (including `package-candidates` through capacity receipts), one-day retention, cleanup-only write permission, unsuccessful/incomplete-job preservation and fail-closed API errors; evidence and qualification reports stay outside the deletion allowlist.
- [x] Review item 5 / BR80-EX1, EX6, EX8: compose PR #841's five one-day transport retentions and single cleanup job, extending its current-run allowlist to `package-candidates` (167,402,696 bytes measured). Keep union exemptions and producer in capacity needs. Only cleanup has Actions write; retain unsuccessful/incomplete jobs, cancellation, fork-token restriction or API error. Cleanup follows a successful final gate; one-day expiry is the fallback. Revert workflow/contract/fixture hunks together for rollback.
- [x] Success-only closure: #841's upstream-of-gate cleanup could delete before a failing final verdict. Move cleanup after successful `ci-gate` and all consumer ancestors; omit this downstream action only from the gate's required receipt set to avoid a cycle. Every validation stays required; cleanup failure still fails the whole run, which must complete/succeed before handoff. The second PR must preserve this dependency direction and repeat composed contracts.
- [x] Review item 6 — Record the single historical size exception, authorized by the review-repair request: `533ecef901d60cf4c5d70abd1cf28cda1dbc36b6` (verified from git; the review's full link SHA was mistyped), docs-only BRANCH.md initialization, +152/−59 = 211 changed lines. Preserve linear history; the other 24 reviewed commits are ≤124 lines and contain no AI attribution trailers. New correction commits retain the ≤150-line limit.
- [x] Review item 4: reviewed head adds +9 jobs and +8 concurrent slots versus main (PR/push 73/98 → 82/107 jobs; demand 65/64 → 73/72; guard-scripts-only PR 10 → 22 jobs). Reduce cluster expansion from nine jobs to three groups capped at three, preserving all nine qualifiers, individual namespaces, unconditional teardown and failure aggregation. This removes six added jobs/slots; remaining account admission against the 40-slot cap stays a BR-84 measurement obligation, not a capacity acceptance.
- [x] BR80-EX5 — Owner review-repair request authorizes receipt reuse in stateful-consumer and gateway auth-subpaths setup. Replace duplicate candidate builds/packs only when the shared bundle is selected; verify the complete tuple/closure and copied archive digest at use. Keep standalone qualification and every assertion, peer tuple and test member. Impact: qualification setup only; rollback: revert these setup changes and retain the exact-bytes objective as unmet.
- [x] BR80-EX10 — Run 40807893347/job 123234041344 blocks exact-head CI on concurrent `all_main` completion (expected two enqueues, observed zero). Bound the repair to completion publication ordering and fresh join state in Flow, a patch version/lock update, and controlled interleavings in the existing API regression. Impact: prevent a join from consuming incomplete prerequisite state; preserve enqueue counts, deduplication, timeouts and all gates. Rollback: revert this bounded fix and version/lock changes together; keep the failing regression blocking.
- [x] EX10 repro: both controlled interleavings fail with exactly zero/two enqueues before the fix. Frozen local toolbox `tool-98d616df5008843fdd25333b07a1404f782d94ea3a415049deb8b3e0f028bd60`; isolated 9400/5600/1500 stack removed after logs. Container registry read confirms published Flow 0.2.0 before bumping to 0.2.1.
- [x] EX10 qualification: rebuilt toolbox compiles all workspaces; all 71 tests in `tests/queue` and `tests/services/flow` pass under the shared flock and `ENV=test-ci-br80`, including both controlled races and replay deduplication. Logs captured and Compose stack removed.
- [x] Historical live AI job 123234041607 failed on missing `valueScores` (`score-validation.ts:23`); the reviewed run's selected tests pass with assertions unchanged. Final-head CI remains mandatory; no provider exception or timeout increase is accepted.
- [x] BR80-EX9 — Historical canvas-main integration narrative superseded: the reviewed branch is linear, 25 commits ahead / 0 behind main `b7e86f5ea0`, with no merge commit or canvas diff versus main. No merge rollback is pending. Preserve current linear ancestry and the BR-80 plan; future updates follow COMMON-RULES rebase and package-version checks.
- [x] BR80-EX8 — Exact-head CI completion requires repairing run 40804166805/job 123221753583: nine wiring assertions still require mutable action tags or the removed serialized cluster steps. Impact: fixture only; retain exact action pins, narrow filters, guarded packing, lint/typecheck order, complete peer tuples, sibling guards and publication barriers through the producer/lane dispatcher. Rollback: restore these fixtures with the prior workflow/Makefile. Local scoped reproduction confirms all nine failures; full manifest, install, candidate and DAG suites pass after adaptation.
- [x] BR80-EX6 — Owner-requested repair of run 40792716438/job 123195302088: the policy rejects candidate consumers' producer dependency, not a slot limit. Permit only the four declared consumers after `package-candidates`, require that producer after `changes`, and reject all other validator serialization. Impact: DAG contract and negative fixtures only; keep demand, widths, mutex and measured-proof gates unchanged. Rollback: revert this contract together with BR80-EX1's candidate DAG.
- [x] Capacity repro: 73 PR/72 push slots, `independentValidators: false`, unchanged API/E2E widths 15/5. The first repaired run reaches the previously blocked fixtures and exposes their old scalar cluster-job lookup; require every actual matrix member instead.
- [x] BR80-EX7 — Owner-requested repair of run 40792716438/job 123195302026: L5's workflow fixture names the removed serialized pack step. Follow producer, download, verification and unconditional sibling export before qualification. Impact: fixture only; preserve all L5/runtime/SDK assertions. Rollback: restore the fixture together with the serialized DAG.
- [x] Historical capacity-policy repair passes at 73/72 demand versus main's 65/64 (+8); this did not qualify capacity. Review reduction now gives 67/66 (+2), with net +4 selected jobs including #841 cleanup; the 40-slot account cap and BR-84 admission proof remain open. Historical 35 metrics/25 expected-results and 104 L5 tooling tests passed.
- [x] Reproduce both failures and qualify fixes under the shared Docker flock, `ENV=test-ci-br80` last, then teardown: capacity policy and all 60 fixtures pass; the complete `memory-l5-gate LOT=1` passes, including packed/source graphs, typechecks, 104 tooling tests and all lot-scoped package suites. Exact-head completed successful CI remains required.
- [x] Predecessors read: BR-78 #811 and BR-79 #826. UI 255s/180s, IdP 233s/150s, runner admission and uncompleted rollback/warm/cold campaigns remain open; BR-80 does not close them by DAG shape.
- [x] BR80-Q1: the owner's exact-head successful CI request covers this evidenced blocker; BR80-EX8 bounds the wiring-fixture adaptation without removing gate obligations.
- [x] BR80-Q2: owner explicitly requested the capacity-policy repair in this session; BR80-EX6 bounds the implementation and fixtures while retaining complete-result and security barriers.
- [x] BR80-Q3: BR80-EX5 replaces the five stateful-consumer packs with verified candidate archive copies when the bundle is selected; all assertions and suites remain.
- [x] BR80-Q3 extension: gateway auth-subpaths uses the same verified mesh/gateway receipt bytes without another compile/pack when the bundle is selected; standalone setup and all assertions remain.
- [x] Gateway snapshot repro at c48a42fae: 77 files/1367 tests pass, but auth-subpaths cannot resolve its expected package-local node_modules/vitest. Restore that tooling link only inside the disposable gateway workspace; rerun the unchanged suite.
- [x] Add a real guarded-pack regression: an unrelated selected package is outside the shared closure and must retain its own full pack. The initial fixture fails with `missing selected candidate: outside`; restrict receipt reuse to closure members and preserve full guard/bump checks for other packages.
- [x] Lazy repro at e73835d39 rejects unchanged oauth-verify bytes and mcp-auth 0.2.2 against the committed frozen 0.2.1 tuple. Preserve the lock assertions: classify sibling injection independently from the once-built preparation closure, using the existing same-PR BLOCK classifier; export and require every selected sibling only.
- [x] Common WARN inventory also reads the verified release-candidate manifest without another snapshot pack; an actual-archive regression retains standalone snapshots for packages outside the shared closure.
- [x] Historical comments lane at e73835d39: 109/110 passed and comments-export exceeded its unchanged 5000ms limit; subsequent isolated and reviewed-head success is recorded below, with no timeout or durability change.
- [x] b52e3bbb4: isolated comments-export and all 110 comments tests pass without source/assertion/timeout/durability changes; the earlier timeout remains recorded and final CI is still required. The producer reuse receipt is byte-identical and completes in 13s without another pack.
- [x] Lazy at b52e3bbb4: 109/110 assertions pass after selection repair; the remaining offline preparation fixture inherits the new real-bundle variable into its stub npm. Clear that variable after real preparation and before Vitest, retaining bundle validation and every fixture assertion.
- [x] Baseline PR 40748328717 attempt 1, head 949d47c8ced0426a010da639ac910229d5699874, success: cluster 991s/123051431364; manifests 65s/123051430739; mesh 71s/123051431590; gateway 199s/123051431190. Raw paginated receipts: `.tmp/ci-br80/receipts/40748328717/`.
- [x] Inspect inherited IdP receipt 123085229315: checkout/setup 31/11s, API transfer/load 3/22s, toolbox 16/34s, browser 14/16s, startup 45s, smoke 5s, teardown 31s; no optimization or <=150s acceptance claimed.
- [x] BR80-EX1 — Implemented workflow exception: four named package validators consume shared immutable candidate receipts. Impact: selected dispatch and required results; review corrections bound nine qualifiers to three jobs and compose #841 cleanup. Rollback: revert the workflow/contract changes together while preserving complete-result checks.
- [x] BR80-EX2 — Implemented Makefile exception: candidate-aware workspace, guarded pack and sibling export plus fixture targets. Impact: named CI entry points only. Rollback: restore the previous recipes and rerun qualification.

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
- [x] **Lot 1 — Candidate closure and guard ownership**
  - [x] Implement topological public sibling closure, one build/guarded pack per member, tuple-bound archive hashes, and fail-closed partial-output handling in `package-candidate.mjs`; integration and fixtures follow.
  - [x] Add real archive fixtures for reuse, substitution, missing siblings, hash/manifest tampering, registry failure and cycles, plus the declared BR80-EX2 fixture entry points.
  - [x] Candidate-aware guarded pack and sibling export verify the complete receipt set and reuse exact bytes; they preserve the existing packed-manifest and registry bump checks.
  - [x] Clean-consumer qualification checks its primary archive against the complete candidate index and requires every selected sibling hash; consumers receive only read-only archives/scripts, with no source dependency tree.
  - [x] Direct installed-comments/major-upgrade targets also validate their supplied primary tarball against the candidate index before PostgreSQL startup when a bundle is selected.
  - [x] Candidate closure/script fixtures are implemented: one topological build/pack, complete hashed receipt set, source/tool/closure and manifest rejection.
  - [x] Manifest/pack/install scripts and negatives are implemented; clean consumers receive only archives, never the source dependency tree.
  - [x] Historical lot gates passed; review correction candidate fixtures pass 9/9. Final-head validation below remains open.
- [x] **Lot 2 — Independent qualification lanes**
  - [x] Add a candidate preparation action and immutable prepared archive; source/storage qualifiers restore disposable containers after source/tool/hash verification; producer and fan-out are wired.
  - [x] Add a contents-read-only producer job with full-SHA actions, failing artifact upload, and a separate read-only Make verification entry point; the final verdict wiring follows with lane fan-out.
  - [x] Packed lazy qualification skips sibling builds with an explicit candidate bundle and verifies/reuses cluster/artifacts/platform/train archives; bare, selected, session, latest, global, old and partial tuples retain their existing installs/assertions.
  - [x] Add nine isolated qualification dispatch cases using the original source/storage/crash/installed/upgrade/lazy/stateful commands; add clean-consumer negatives for unlisted primary bytes and wrong source SHA.
  - [x] Preserve nine qualifiers in three fail-fast-disabled jobs capped at three; each qualifier owns its disposable container/database/environment and verifies the same producer bundle, with read-only source permission.
  - [x] Route source, audits, storage and stateful checks through the lane dispatcher; remove their repeated build/preparation steps from the serialized workflow body.
  - [x] Remove the remaining serialized installed/upgrade/lazy/install steps now owned by independent lanes; teardown each lane's database/network and Compose environment with unconditional cleanup.
  - [x] LLM mesh/gateway consume the prepared closure and retain lint, compiler, tests, model-equivalence and packed-manifest checks; remove their repeated sibling compilation/packing.
  - [x] The common inventory verifies shared BLOCK candidate receipts rather than repacking their closure. The producer is a direct final-gate/capacity-receipt dependency; actual cluster matrix members remain in the complete-result manifest.
  - [x] Exact candidate/manifest/install script paths select their package-family integration without selecting application images; the DAG fixture checks this implementation-only case.
  - [x] Add qualification-DAG fixtures covering every actual matrix member, missing/cancelled/skipped/neutral failures, lane ownership, crash order, retained lazy tuples, least privilege and full action pins.
  - [x] Require named Node/npm identities and passing BLOCK receipts; a repeated producer restores and verifies its sealed preparation rather than constructing a new snapshot without compiled outputs. Preparation substitution negatives cover the extraction boundary.
  - [x] Preparation/Make refactor and isolated source/PostgreSQL/comments/crash/installed/lazy/clean-consumer dispatch are implemented.
  - [x] Storage/crash/installed test files and packaging membership remain unchanged; seed → crash/restart → verify ordering is pinned by the DAG fixture.
  - [x] DAG fixtures pass 8/8, including a shell-level grouped-dispatch failure/cleanup regression and every missing/failed/cancelled/skipped/neutral matrix member.
  - [x] All nine qualifiers passed on reviewed head 0d4bf1ca4 (study §13.1), including lint/typecheck, source, five storage/installed targets, stateful, lazy and clean install. Final-head CI is still required after corrections.
- [ ] **Lot 3 — UAT and measured acceptance**
  - [ ] Review installed package exports, optional-peer behavior, clean install, retained cursors, and PostgreSQL recovery receipts; no product UI change.
  - [ ] Budget to measure on real warm/cold qualification: complete cluster branch ≤210s versus 664s; common manifest guard ≤75s versus 125s. Account for preparation, pack, transfer, and longest installed lane; one candidate per tuple is observable.
  - [ ] Preserve missing durations as **to measure**; publish all failures, cancellations, retries, queue time, runner-minutes, and threshold breaches alongside successes.
  - [ ] Rollback drill: restore the prior isolated preparation and serialized qualification recipes, discard only affected candidate receipts, and rerun all preserved storage/installed assertions.
- [x] **Lot 4 — Docs consolidation**
  - [x] Record the identified predecessor package baseline and inherited IdP stage spans in study section 13 and plan/66; post-change timings and exact-head acceptance remain open.
  - [x] Update active/retained plans and study §13 with receipts, budget dispositions, capacity delta, #841 composition, EX5/Q3 closure and the historical commit exception; no temporary spec scaffolding added.
- [ ] **Lot 5 — Final validation**
  - [ ] Repeat the exact changed-file tests and lot commands above on the final SHA; compare expected/executed membership and retain the complete CI/security verdict.
  - [ ] Static: `make lint-cluster-mesh typecheck-cluster-mesh ENV=test-ci-package-candidates`; rerun the manifest, install, candidate, and qualification-DAG fixture targets from Lots 1–2.
  - [ ] Build: `make pack-cluster-mesh ENV=test-ci-package-candidates` and the selected sibling candidate targets produce one archive per tuple; all final qualifiers consume those exact receipts without repacking.
  - [ ] API regression: product HTTP tests are not changed; `make test-cluster-mesh ENV=test-ci-package-candidates` and the five named PostgreSQL/comments/crash/installed/major-upgrade lanes remain required with isolated databases and exact candidate bytes.
  - [ ] UI regression: not applicable; no UI code, build recipe, or test membership changes.
  - [ ] E2E regression: product browser lanes are unchanged; rerun `make -f packages/cluster-mesh/packaging.mk test-lazy-package ENV=test-ci-package-candidates` and all named installed-consumer suites, preserving seed → crash → verify ordering.
