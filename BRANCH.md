# Feature: W1.a durable host schema and package-asset installation

## Objective
- [x] Install durable artifact host KV and unchanged upstream SQL assets through the API migration authority.

## Scope / Guardrails
- [x] Owner dispatch: W1.a of `.tmp/app-switch-week/plan-v2.md`; draft PR only, no merge or deployment.
- [x] Worktree `tmp/worktrees/app-w1a`, branch `feat/app-cm-w1a`; upstream `2568c25cd6f03d706356fd0be5bd9e0c601a0bcf`, frozen in #702 reservations.md.
- [x] Create missing `feat/app-cm-integration` at the same SHA; integration waits for W0-close.e.
- [x] Only control `0020_app_artifact_host.sql`; preserve #677 control 0012–0019. Ref/worktree rescan found no 0020 SQL collision on 26 October.
- [x] Make-only, shared Docker flock for build/test/start and matching down after each step; `ENV=test-app-w1a` last.
- [x] API/UI/Maildev UI ports 8791/5177/1084; verify ownership before listeners. Never test on dev.
- [x] Workspace sources unchanged; owner-authorized artifacts API pin is BR-W1A-EX1; W2.b retains final lock reconciliation. No package SQL copies, edits or host activation algorithm.
- [x] Atomic commits below 150 lines; selective staging, scope-check, make commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/host-storage.ts`
  - `api/src/db/run-migrations.ts`
  - `api/drizzle/control/0020_app_artifact_host.sql`
  - `api/drizzle/control/meta/_journal.json`
  - `api/tests/api/artifacts-host-migrations.test.ts`
  - `api/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/package-lock.json`
  - `package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] **Exception process**: declare BR-W1A-EXn with reason, impact and rollback before scope expansion.

## Feedback Loop
- [x] Forward/reverse frontier reconciliation: #677 at ac020db2 reserves timestamps 1792100000000–1792200000000. Per-receipt hash validation in the existing control runner installs missing registered slots in order even when another branch already advanced the frontier; a maximum timestamp cannot safely encode this branch order. Added the already-advanced-base regression alongside the later-reserved-slot regression.
- [x] Opus r1 P2 journal: register 0020 in Drizzle metadata and put package receipts in public.__drizzle_control_migrations (asset_id/hash/negative created_at), removing the third journal. 0020 timestamp is immediately after this base's last control entry, before #677's reserved slots; package positions never advance that frontier. W2.b reindexes merged generator metadata; W5/B02 compare the two reserved journals including asset rows.
- [x] BR-W1A-EX1, owner 26 October: add artifacts 0.2.1 to api/package.json and the matching root lock entry (published metadata/integrity) so strict workspace npm ci can resolve the runtime dependency. Impact: supersedes W2.b's manifest/lock reservation only for this required pin; W2.b still reconciles the final tree. Rollback: revert pin and matching lock entries before integration.
- [x] BR-W1A-EX2, owner 26 October: retain base 2568c25 and integration branch created there per plan-v2 instead of accepted #702 plus fbfe68f0. Reason: preserve the assigned branch train; impact: W0-close.e and final base/payload reconciliation remain merge gates; rollback: rebase onto the accepted integration base.
- [x] BR-W1A-EX3, owner 26 October: use assigned tmp/worktrees/app-w1a and test-app-w1a 8791/5177/1084 instead of W0's app-cm-w1 / test-app-cm-w1 9711/5911/1811. Reason: isolated W1.a dispatch; impact: W1.b/c must not reuse its live slot; rollback: tear down test-app-w1a and return to the reservation.
- [x] CI delivery: draft PR targets main solely to trigger ci.yml; actual integration remains through feat/app-cm-integration after W0-close.e. No direct main merge is authorized.
- [x] Opus r1 P1-1: permit ordered trailing assets on installed bases; retain hash refusal and interior receipt-gap detection. Regression covers two ordered additions and DDL-free installer rerun; all 16 installer cases passed in Lot 3.
- [x] R3 isolation findings accepted as bounded hardening: test required-relation absence and failed unlock/rollback handling; no claim of full live schema-integrity attestation.
- [x] Add required-relation presence checks; destroy uncertain connections, propagate unlock failure and preserve original migration/rollback failure context.
- [x] Historical ISO-1: lost/partial receipt regressions exposed false re-attestation. Opus r1 supersedes frozen-batch refusal with ordered-prefix validation, permitting additive upgrades.
- [x] Historical ISO-1 red proof: both partial-restore cases wrongly resolved, with 8/10 tests passing; leased-client typing retained in the revised installer.
- [x] Historical MIG-1/MIG-2: reserved-slot eligibility and concurrent first installation reproduced; Opus r1 supersedes the third journal with the reserved control journal and an earlier host timestamp. One connection retains the API migration lock.
- [x] Red PostgreSQL proof: 6/8 pass; concurrent first installation fails with pg_namespace_nspname_index, and the reserved-slot witness is skipped. Both findings reproduced before correction.
- [x] Full API migration entry now retains its session lock/client across public/control/package installation; package installation can reuse that client without a second pool lease.
- [ ] UP-T: #702 host-fit records no activation adapter/SQL in frozen artifacts 0.2.0. Package integrator must deliver reviewed bytes/export/hash; W1.c consumes them. Activation readiness is not claimed.
- [ ] W0-close.c/e remain external gates; this draft must not integrate before W0-close.e.

## AI Flaky tests
- [x] No AI tests or accepted flakes; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author, isolated W1.a topic on the app integration train.

## UAT Management (in orchestration context)
- [x] Backend migration only; no UI, Chrome or VSCode changes. No root-dev UAT needed.

## Plan / Todo (lot-based)
- [x] Lot 0: read lock, full plan, MASTER/workflow/testing, template and W0 a/d evidence; mechanical branch check passes.
- [x] Lot 1: `api/tests/api/artifacts-host-migrations.test.ts` covers empty DB, rerun, additive assets, asset/journal mismatch refusal, both control arrival orders, fresh-process restart, scoped concurrent KV insert and failure cleanup; 16/16 passed.
- [x] Lot 2: control SQL/metadata for host KV and one package journal; hash-checked L3/L6 installation on one leased transaction; bounded migration runner hook after public/control streams.
  - [x] Add control 0020/metadata, scope-bound PostgreSQL KV and pinned package asset installer; upstream bytes remain unchanged.
- [x] Lot 3: scoped PostgreSQL tests, API typecheck/lint and migration regressions; every hunk inspected and test stack stopped.
  - [x] 26 October 21:02 UTC: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -k typecheck-api lint-api up-api-test test-api-endpoints SCOPE="tests/api/artifacts-host-migrations.test.ts tests/api/cluster-mesh-migration.test.ts tests/api/llm-admission-schema.test.ts tests/api/session-adoption.test.ts tests/api/tenancy/arch11-outbox-rekey.test.ts" API_TEST_WORKERS=1 API_TEST_ARGS=--no-file-parallelism API_PORT=8791 UI_PORT=5177 MAILDEV_UI_PORT=1084 ENV=test-app-w1a` exited 0.
  - [x] Typecheck passed; lint passed (0 errors, 219 warnings); strict workspace npm ci and API development-image build passed. Tests: artifacts-host-migrations 15, cluster-mesh-migration 16, llm-admission-schema 20, session-adoption 36, arch11-outbox-rekey 1: 5 files / 88 passed, no skips, 30.24s.
  - [x] Full log `.tmp/receipts/pr773/lot3-retry.log`, SHA-256 `5406a23e090b87e14ba6275e9d923f374db8afbebe949e4bab7439a22c388590`. Initial sandbox/buildx-cache failure before tests: `.tmp/receipts/pr773/lot3.log`, SHA-256 `51e482a143fc248e902eb972f6ac3b8d3268f283827ded942ca63c3b9dfa3f3b`; retry used host cache access with the same isolated targets.
  - [x] Runtime inspection and down exited 0: API resolves artifacts 0.2.1 directly; workspace cluster-mesh 0.22.0 still resolves workspace artifacts 0.2.0, which W2.b must reconcile in final payload qualification. Health logs show HTTP 200 without runtime errors. Log `.tmp/receipts/pr773/runtime-cleanup.log`, SHA-256 `c7b364f7ec3f61e6f146d364aad96a49e97f3a2a4baab2a7665abce3d4369f29`.
  - [x] Final Lot 3 on runtime head `bdeba5a3fd3e4d7a14b8cdd5614072c1ff4ea151`, 26 October 21:15 UTC: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -k -o prepare-node-workspace up-api-test typecheck-api lint-api test-api-endpoints SCOPE="tests/api/artifacts-host-migrations.test.ts tests/api/cluster-mesh-migration.test.ts tests/api/llm-admission-schema.test.ts tests/api/session-adoption.test.ts tests/api/tenancy/arch11-outbox-rekey.test.ts" API_TEST_WORKERS=1 API_TEST_ARGS=--no-file-parallelism API_PORT=8791 UI_PORT=5177 MAILDEV_UI_PORT=1084 ENV=test-app-w1a` exited 0; unchanged prepared dependencies reused, API rebuilt before checks.
  - [x] Final results: typecheck passed; lint passed (0 errors, 219 warnings); 5 files / 89 tests passed, no skips, 17.17s (16 host, 16 cluster-mesh, 20 admission, 36 adoption, 1 outbox). Log `.tmp/receipts/pr773/lot3-frontiers.log`, SHA-256 `ac86c9e7ce57c11166c7bc724f4a34fc52331d248275e731f66e18d0a625c930`. This supersedes the initial 88-test receipt.
  - [x] Final cleanup/scope, 26 October 21:18 UTC: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -k -o build-harness logs-api down ps scope-check TAIL=45 API_PORT=8791 UI_PORT=5177 MAILDEV_UI_PORT=1084 ENV=test-app-w1a` exited 0; healthy API logs, empty Compose ps and PASS C2. Unchanged built harness reused. Log `.tmp/receipts/pr773/final-cleanup-scope.log`, SHA-256 `a8760422dc033684f6cd8f83faf7391ec651593caa9e855eb3ca3de1c0d092a0`.
- [ ] Lot 4: independent review/reconciliation; exact BRANCH.md PR body, push and draft delivery with green exact-head CI.
  - [x] Draft PR #773 targets main; GitHub reports a merge conflict, so automatic PR CI cannot start. Explicit CI `workflow_dispatch` with `bootstrap_publish_target=none` started run https://github.com/rhanka/sentropic/actions/runs/40398841393 on `05f3082a11a4b3a14905dd57e5cf1bbc8e988dec`; changes passed, then this superseded run was cancelled for the control-runner correction. Dispatch again on the final pushed receipt commit; publication stays skipped and green CI remains a gate. Actual integration stays through feat/app-cm-integration after W0-close.e.
- [x] Handoff W1.b: createArtifactHostKv accepts trusted opaque storage_scope_id, with no FK to artifacts.storage_scopes; W1.b alone owns verified tenant/workspace-to-scope mapping and calls this factory. Public stream precedes control 0020, then package assets; reruns verify pinned hashes/required relations and execute only trailing pending assets.
- [x] Handoff W1.c/W2.b/W5: UP-T and successor SQL append ordered assets with reviewed identities/hashes through this executor; receipts live in public.__drizzle_control_migrations. API pins published artifacts 0.2.1 (registry rechecked after final runtime change); all three published SQL hashes match. W2.b reconciles merged locks and generator idx values while preserving receipt timestamps/hashes; B02/W5 include host DDL and package receipts in backup/frontier comparisons. W0/UP-T gates remain open.

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
