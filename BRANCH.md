# Feature: app cluster-mesh integration

## Objective
- [x] Integrate the fourteen W1/W2/W3/W4/W0-close.d source lots on main's accepted W0 baseline; keep serving, publication and activation closed; W4.a acceptance remains explicit below.
- [ ] Deliver a draft PR to main with successful CI on its exact head; do not merge.

## Scope / Guardrails
- [x] Source: `.tmp/app-switch-week/plan-v2.md`; W0-close.e Opus/Sol final receipts and N5; historical W3.d checklist retained below.
- [x] Branch `feat/app-cm-integration`; worktree `tmp/worktrees/app-cm-integration`; replayed onto main `b7e86f5ea`; source-lot identities below are historical, not final-head ancestry.
- [x] Make-only; shared Docker flock `/home/antoinefa/.cache-tmp/sentropic-docker.lock`; no parallel builds.
- [x] Local make commands end with `ENV=test-app-int`; reserved API/UI/Maildev ports 9718/5918/1818; no local service stack started.
- [x] No production activation, Python, AI trailers or destructive cleanup; owner-authorized rebase and force-with-lease apply only to this PR branch.
- [x] Serving, reader activation and host publication remain explicitly disabled before FIRST-IMMO, including main auto-deploys.
- [x] API remains the sole migration executor; content starts only the compiled content entrypoint.
- [x] New correction commits stay within 150 changed lines; selective staging; `make commit` only. Historical size violations are disclosed below, not exempted as merge content.
- [x] External DNS/TLS/IAM/storage provisioning and positive live activation belong to tenant/W3.e/W5 lanes.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.dockerignore`
  - `.github/workflows/**`
  - `Makefile`
  - `api/**`
  - `apps/**`
  - `deploy/**`
  - `docs/**`
  - `package-lock.json`
  - `scripts/**`
  - `spec/**`
  - `track/TRACK.md`
  - `deploy/k8s/base/artifact-content-*.yaml`
  - `deploy/k8s/base/kustomization.yaml`
  - `deploy/k8s/base/30-api.yaml`
  - `deploy/k8s/overlays/preprod/kustomization.yaml`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/prod/artifact-content-*.yaml`
  - `deploy/k8s/overlays/preprod/patch-artifact-content-config.yaml`
  - `deploy/k8s/overlays/prod/patch-artifact-content-config.yaml`
  - `deploy/ci/artifact-content/**`
  - `deploy/ci/idp-identity-sync/workflow.selftest.mjs`
  - `docs/runbooks/app-artifact-content-infrastructure.md`
  - `packages/cluster-mesh/tests/packaging/activation-environment.ts`
  - `packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `packages/**` except the two activation test paths allowed by BR143-EX3
  - `plan/**`
  - `ui/**`
  - `e2e/**`
  - `.cursor/rules/**`
  - `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- [x] **Exception process**: BR143-EX1 covers the completed inherited merge only; BR143-EX2 covers topic workflow retirement and equivalent CI gates.

## Feedback Loop
- [x] CI repair local qualification: build-artifact-budget passes 14 tests, 2496 figure/route equivalence cases and 1758 geometry scenes; typical JS/portable 249234/291943 bytes, no violations. test-lazy-package-activation passes 9/9 tests with no pending tests or type errors; C1/C2 and whitespace checks pass. Exact pushed-head CI remains required.
- [x] BR143-EX3 / CI repair request: job 123738620065 passes dossier budgets (typical JS 249234 bytes); the displayed 3691474-byte failure is the intentional baseline negative fixture. The real failure is nested Vitest startup exceeding 5000ms for a missing ACTIVATION_DISPOSABLE refusal. Extract the identical startup guard and probe it directly with Node; retain all nine conformance tests and timeouts. Impact: two test-only files, no package source/manifest change or release bump; rollback restores the nested runner probe.
- [x] Rebase onto origin/main c1e592636 for this CI repair; only the initial BRANCH.md conflicts, resolved with the integration plan. Post-Rebase Gate: package source and manifests match main, so no publication bump applies.
- [x] PR837-R1-9 render evidence: 54/54 test-artifact-content-manifests checks pass on the correction tree; both prod/preprod API/content renders explicitly keep host/content/reader flags 0, override secret values, and reject tagged images if any flag opens. Recheck final-head CI validate-idp-sync before merge.
- [x] PR837-R1-2/5: `docs/runbooks/app-cm-integration-review.md` records the reproducible range-diff, all main/replay overlaps, post-rebase workspace dependency correction and read-only legacy-key quarantine disposition; no ancestry or legacy-serving fallback is claimed.
- [x] PR837-R1-6 schema rollback: all three flags remain 0; revert qualified images/config while retaining additive schema, journals, receipts and blobs; see baseline restore runbook. Actual baseline migration rehearsal remains open below.
- [x] PR837-R1-1: CI log 123666763408 proves the immutable root-mount inventory omitted W3.a's POST reader-activation route. Add it to IMMUTABLE_ARTIFACT_ROUTES without changing production fences, timeouts or skips; final-head CI remains required.
- [x] PR837-R1-7: inherited replay commits exceed 150 changed lines: 8dab28051 (208), 0ef65483b (199), 34ef1adc5 (196), 2f7e0e65f (181), b97efabb9 (180), 56ce57aac (168), 4217bd8ca (161). These are historical rule violations, not covered by BR143-EX1; no retrospective exemption or history rewrite is claimed.
- [ ] PR837-R1-4 / owner Antoine (product): approved tenant membership is a prerequisite for every chat server tool, including in TENANT_RESOLUTION_MODE=shadow. Missing/requested/revoked membership yields text-only chat; owner acceptance and final-head chat CI remain pre-merge gates.
- [ ] PR837-R1-6 / code author: execute API migrations twice on an isolated restored W0 baseline. The recorded exact dump and restore volume were deleted; locate identical baseline bytes before claiming this gate closed.
- [x] Owner rebase request (29 October 2026) supersedes historical merge-only guardrails: rebase onto main with #831/#834, retain both migration/build intents and main version pins, restore the integrated artifacts workspace dependency, then force-with-lease only this PR branch. Post-Rebase Gate: no package source or manifest differs from main, so no publication bump is required.
- [x] N6 now blocks exact-head CI: unit job 123405258615 has 517/517 passing receiving tests but an uncaught 57P01 on the activation conformance database. Track physical client end events, await them after pool.end and remove forced DROP in activation/migration fixtures, matching the existing publication/credential teardown. Retain all assertions and imported vectors; no error suppression or timeout increase.
- [x] Gate inventory refinement: API unit/endpoint defaults do not include tests/services/catalog. The explicit test-app-cluster-mesh aggregate retains the complete union of topic workflow scopes (including catalogue services/characterization) plus content tests/types/lint on the existing unit toolbox.
- [x] Topic cleanup batch 2: remove W3.b/W3.c/W3.d wrappers; content tests/types/lint, production runtime/hash/receipt guards and closed-overlay gates remain in standard CI.
- [x] Topic cleanup batch 1: remove W1.c, W3.a and W4.b wrappers; their API endpoints/services and API type/lint remain in standard CI.
- [x] Integration render regression: automatic merge duplicated API container env. Combine decision secret references and explicit artifact flags in one list; preserve envFrom and all flags at 0. The existing overlay render gate reproduces the failure and verifies the correction.
- [x] BR143-EX2 / explicit owner request: remove all six app-cm topic workflows after preserving every gate in ci.yml. Add test-artifact-content to the existing API unit executor for content tests/types/lint; existing API endpoints/services, API quality, manifest and image jobs retain all other gates. Impact: main PR CI owns qualification; rollback restores the topic workflows and removes only this additive gate.
- [x] BR143-EX1 / owner request 29 October 2026: merge origin/main c37662a20 without rebase. Imported reviewed main changes are inherited merge content, outside the 150-line authored-change budget. Resolve README/host-fit by retaining W0 local recovery and W4.b supersession; preserve both Docker build intents, both alias sets and both migration identities. Impact: refreshed integration base only, all production gates remain closed. Rollback: revert the merge on this integration branch; never rewrite main.
- [x] BR143-EX1 scope closed after the merge: main-only package, UI, E2E, plan and Compose paths are forbidden again; the allowed scope covers the existing app integration diff and directly blocking integration defects.
- [x] BR03d-EX2 / owner acknowledgment: PR #814 correction request (2026-10-28), Opus r1 P2-2. Defer actual release digest to W5; existing prod `:main` and CD content-hash `newTag` remain acceptable only while all three API/content flags are explicitly `0` (health/denial, no private serving). Impact: closed workloads run registry tags until W5; render gate rejects any flag `1` without SHA-256 digest-pinned API/content images. Rollback: keep all flags `0` and restore the prior qualified image/config; W5 replaces tags with the tested published digest before any opening.
- [x] BR03d-EX1 (mechanical alias of BR-CM-W3-EX1) / acknowledged by owner W3.d packet and W0 reservations: add a render-only Make target/include and CI invocation. Impact: offline qualification only; rollback: remove include/step and content resources, retain closed flags. No deploy target execution or general CI refactor.
- [x] Tenant handoff: DNS/TLS provisioning, dedicated namespace-local credentials, private bucket checkpoint/restore and actual accepted image digest remain external receipts; document exact gates without asserting live readiness.
- [x] BR03d-EX1 includes `.github/workflows/app-cm-w3d.yml`: shared CI excludes this app integration base; mirror W3.c's topic workflow for exact-head offline checks. Conductor removes topic workflows before main integration; rollback removes this topic workflow only.
- [x] BR03d-EX1 receiving-test seam: update only the exact expected CI command list in `deploy/ci/idp-identity-sync/workflow.selftest.mjs`. Evidence: first topic CI passes manifests then rejects the new content step in that list. Preserve the exact-order assertion and all IdP controls; rollback removes the expectation with the CI step.

## AI Flaky tests
- [x] No AI tests or flaky exception selected; deterministic manifest and denial checks only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; main updates use rebase per COMMON-RULES; no cherry-picks; push only this branch with force-with-lease when rebased.

## UAT Management (in orchestration context)
- [x] Offline manifest inspection and local denial checks only; no root dev services or live browser activation.

## Plan / Todo (lot-based)
- [x] Integration lot 0: mechanical C1, merge main without rebase, explain all conflicts in the merge body; identical Track blobs in both parents/result.
- [x] Integration lot 1: remove six topic workflows and preserve every gate, including services/catalog, content types/lint, image runtime/identity and manifest denials.
- [x] Integration lot 2: 54 closed-overlay checks, IdP/restore parent controls, static canonical image and CI hash filters pass under the shared Docker lock.
- [x] Historical train: #773/#780/#794/#784/#785/#791/#806/#810/#813/#812/#814/#795/#807/#796 were integrated before replay; their heads are not ancestors of the rebased branch. Patch-equivalence receipt and final-head review are required.
- [ ] Integration lot 3: draft PR to main, final-head CI success, cleanup receipt and head report; no merge.
- [ ] Deferred W3.e: real HTTPS isolation after FIRST-IMMO; W4.c positive UI path follows it.
- [ ] Deferred W5: protected promotion/trust/signature/approval, integrated journey and exact-object/version/grants/blobs/runtime revoked-reader restore remainder, then observation.
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/testing, template, plan W3.d/dependencies/ownership, W0 reservations, W3.c entrypoint and image tests.
  - [x] Create isolated worktree and pass mechanical `harness check branch` before work.
  - [x] Freeze scope, exception, environment and ports; leave other lanes untouched.
- [x] **Lot 1 — Tests first**
  - [x] Add `deploy/ci/artifact-content/{tests.mk,bundle-checks.mjs,bundle.selftest.mjs,network.selftest.mjs}`.
  - [x] Prove red: rendered overlays fail `Deployment/artifact-content must occur once` (0 vs 1), before any content manifest exists.
  - [x] Test closed gates despite enabled secret values, least privilege, network peer namespace isolation, both TLS wildcard depths and exact app route precedence.
  - [x] Test synthetic digest replacement across API/IdP/content, unchanged backup/restore access and mutation denials; Kustomize renders digest-only identity (drops the source tag).
  - [x] Opus r1 P2-2: independently exercise every enabling flag on API/content against tagged and digest renders; reject malformed digests without weakening the default-closed gate.
- [x] **Lot 2 — Workload and default closure**
  - [x] Add content Deployment/Service/ConfigMap/NetworkPolicies and base registration; pin API gate env values explicitly.
  - [x] Dedicated unprivileged ServiceAccount, read-only root, bounded resources/probes, no migration command or broad app secret.
  - [x] Keep storage egress closed pending tenant-specific network/IAM receipts; health can run without secrets.
- [x] **Lot 3 — Environment routes and certificates**
  - [x] Add prod/preprod content ingress with ingress-shim annotations and domain patches/registrations; CD emits no Certificate requiring deployer writes (Opus r1 P2-1).
  - [x] Both stable and pinned wildcard SANs, dedicated TLS secret, HTTPS-only route; no catch-all/identity headers.
- [ ] **Lot 4 — Handoff and final validation**
  - [x] Document tenant DNS/TLS/storage/restore/digest evidence and FIRST-IMMO activation gate in runbook.
  - [x] Opus r1 P3-1/P3-2/P3-3: document wildcard overlap/automatic issuance, test the real parser's reserved-label denials, and restrict signing-key projection to `0440` with `fsGroup: 1000`.
  - [x] Pass `make test-artifact-content-manifests API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`: 54 checks covering ingress-shim, digest-opening mutations, key permissions, host parser and existing network/restore controls.
  - [x] Pass inherited IdP parent-overlay regression (47 checks) and W3.c static image checks (canonical hash `eeb755`, API/content-only invalidation, filters, compilation/copy).
  - [x] Mechanical scope checks and whitespace/diff inspection pass; exception uses BR03d-EX1 and explicit overlay paths.
  - [x] Independent receiving review received: Opus r1 at `.h2a/reviews/pr814_opus_r1.md`, head `e6b59ccd0`, CHANGES (P2-1/P2-2); author corrections supplied here. Conductor owns receiving acceptance of the corrected head; no new review consensus claimed.
  - [x] Create draft PR #814 against `feat/app-cm-integration` using this file; final pushed-head CI receipt is recorded in its validation comment. First green run: `40644234492` at `fb170161b29870b439d1e5f36822ab351d3d9e42`.
  - [x] Run locked `make down ps API_PORT=8806 UI_PORT=5192 MAILDEV_UI_PORT=1099 ENV=test-app-w3d`: no services remain.
- [x] Integration merge: reconcile origin/main and W0 baseline #702 with the reviewed integration lots; preserve the W3.d historical checklist above.

## Inherited main qualification record

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
