# Feature: W1.c compose the shared PostgreSQL activation store

## Objective
- [x] Compose the upstream activation adapter with the trusted app pool, opaque scope, at-most-60-second ticket/flow policy and W1.a migration receipt.

## Scope / Guardrails
- [x] Owner dispatch: W1.c of `.tmp/app-switch-week/plan-v2.md`; draft delivery, green CI, no merge or live activation.
- [x] Worktree `tmp/worktrees/app-w1c`, branch `feat/app-cm-w1c`; merge W1.d `8729aff22` and W2.b `d0ce8aeb0` as assigned; no rebase.
- [x] Owner refresh: consume the frozen workspace tuple's `@sentropic/artifacts` 0.2.4 through `file:../packages/artifacts`; UP-T owns implementation, SQL and conformance vectors. Drop W1.c's separate registry 0.2.3 pin.
- [x] No host PostgreSQL activation algorithm, duplicate SQL, app authority proof, route mounting or live activation; W3.a retains current-authority proof.
- [x] Make-only development; lock every build/test/start with `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock`, release between steps and run matching down.
- [x] Dedicated `ENV=test-app-w1c` last in every make command; API/UI/Maildev UI ports 8799/5185/1092; check ownership before starting services.
- [x] Tests first; atomic commits below 150 lines via `make commit MSG="..."`; selective staging and scope-check before each commit; no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/activation-storage.ts`
  - `api/tests/api/artifacts-host-activation-store.test.ts`
  - `api/package.json`
  - `api/package-lock.json`
  - `package-lock.json`
  - `api/src/services/artifacts/host-storage.ts`
  - `api/tests/api/artifacts-host-migrations.test.ts`
  - `.github/workflows/app-cm-w1c.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/src/db/run-migrations.ts`
  - `api/drizzle/**`
  - `package.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Exception process: record BR-W1C-EXn, rationale, impact and rollback before any scope expansion.

## Feedback Loop
- [x] BR-W1C-EX2 — owner requires exact-head CI on PR #794. Add a branch-specific workflow using existing make targets, exact pushed-SHA checkout, activation/migration/recovery/APP-P1 suites, typecheck/lint and unconditional teardown. No publishing or deployment; rollback removes this workflow.
- [x] R1 base refresh: merge `origin/feat/app-cm-integration` at `ea8e8443134c641b99628ce2c99787a785d8c827`, preserving W1.c's BRANCH.md and restoring the tuple's API manifest and both locks unchanged. APP-P1 receipt stays `020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27`. Inherited merge paths are advisory in `/tmp/w1c-merge-scope.log`; merge delta exceeds 150 lines solely through unchanged base imports. Both parents and the candidate share event-log blob `edb32e21829db7d28a3576dffbe22495cb162dc8`; no Track events lost or authored.
- [x] BR-W1C-EX1 — initial owner-authorized 0.2.3 registry pin is superseded by R1's shared workspace 0.2.4 tuple. Keep the activation asset registration, required relations and migration regression counts. No executor algorithm or SQL changes; rollback is reverting W1.c registration before activation.
- [x] Base-only merges imported W1.d/W2.b unchanged; scope-check reported inherited paths outside W1.c. Authored commits are checked separately after both merges.
- [x] UP-T-2 — imported 0.2.4 `runPostgresActivationConformance` and `POSTGRES_ACTIVATION_VECTOR_IDS`: all 16/16 vectors pass on the W1.a-installed pool in a disposable `test_w1c_` database. Every required hook is wired; missing DATABASE_URL fails at import. Receipt: `/tmp/w1c-r1-green.log`.
- [x] PIN-1 — #796 merged the qualified workspace tuple into integration. W1.c removed its separate 0.2.3 API registry dependency and consumes the shared 0.2.4 workspace package. The frozen APP-P1 digest remains `020aacfec500d754b76c90d3ad4a05097e0f996b8b9282145ca458917ea6fb27`; receiving registry/runtime qualification pending below.
- [x] R1 receiving qualification: 86/86 tests in six suites pass in `/tmp/w1c-r1-green.log`: activation 19 (including all 16 imported vectors), migrations 16, recovery 20, registry 21, physical installation 2 and transport 8. APP-P1 and physical API/mesh package equality pass with 0.2.4. Earlier PIN-1 failure receipts are superseded; no live activation.
- [x] UP-T-1 — adapter/flow/SQL/hash availability resolved by published 0.2.3 and the owner-requested API pin; imported activation vectors remain UP-T-2.
- [x] Current package evidence: `docs/baselines/app-cm-w0/published-tuple.json` and `payload-equivalence-2026-10-27.json` bind artifacts 0.2.4 (124 payload paths) to integrity `sha512-AMXfnuKVx5gdeFppZ4iSgb0KxmfH+qSOotm/cXGBKGEdhyv9R/D05jMhefP5pIW9HwD/jbEWqcU9Gv3KTxJSQQ==` and exact workspace payload equivalence, including the activation adapter, SQL and vectors. Earlier 0.2.1/0.2.3 observations are superseded.
- [x] UP-T-1 closure: package adapter uses `createPostgresActivationStore`, SQL asset `@sentropic/artifacts/sql/0001_activation.sql`, SHA-256 `13767c826a62aa5f880809ca2ebc60bdc638b2e59f983e195d4351356b282d8b`; host only composes those contracts.
- [x] R1 P2: replace raw write/take/remove ports with frozen ticket/flow peek ports plus configured issue, consume, cleanup and invalidate. New facade test fails on the former spread (`/tmp/w1c-r1-tests.log`) and passes after restriction. Document separate ticket/flow transactions: flow-write failure rejects issuance; the unused ticket cannot activate without a flow and expires within 60 seconds.
- [x] R1 exact-head CI: `.github/workflows/app-cm-w1c.yml` triggers on pushes to `feat/app-cm-w1c`, checks out and asserts `github.sha`, then runs the same six receiving suites, API typecheck/lint and unconditional teardown through existing make targets. No publication/deployment and no PR retargeting; wait for the exact-head GitHub receipt before delivery.

## AI Flaky tests
- [x] No AI tests or accepted flakes in this lot; no timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one author for W1.c; package ownership remains upstream.

## UAT Management (in orchestration context)
- [x] Backend storage composition only; no web, Chrome or VSCode surface change. No root-dev UAT or live activation.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read Docker lock first, full owner plan, MASTER/workflow/testing, template and W1.a; create worktree on the assigned base; `harness check branch` passes.
- [x] Lot 1 — Host tests first in `api/tests/api/artifacts-host-activation-store.test.ts`: namespace/TTL/receipt, authority delegation, expiry, restore and uncertain commit. Initial red on missing `activation-storage` import, `/tmp/w1c-red-2.log`. R1 adds all 16 imported vectors and a red-to-green facade regression.
- [x] Lot 2 — `activation-storage.ts` composes workspace artifacts 0.2.4, explicit trusted namespace and integer ticket/flow TTLs in 1..60 seconds (flow <= ticket). `issue` derives both deadlines from PostgreSQL issuance time; frozen reads, consume and maintenance preserve authority/commit-error semantics without raw writes. W1.a registers the unchanged SQL and checks required activation relations.
- [x] Lot 3 — R1: all six receiving suites pass (86/86, including 16/16 imported vectors); API typecheck passes and lint has 0 errors/220 warnings (`/tmp/w1c-r1-quality.log`). Inspect runtime logs and down the isolated stack. No UI/E2E/AI tests apply to this unmounted composition.
- [x] W3.a handoff: await `createArtifactHostActivationStorage({ pool, namespace, ticketTtlSeconds, flowTtlSeconds })` after the sole migration executor; namespace comes from the verified opaque workspace mapping. Use `issue(binding)` for database-time deadlines; `consume(input, authorize)` must lock/recheck current session, ACL, release/channel/origin and stable-pointer policy on the supplied client through COMMIT. Sign/set cookies only after acknowledged success; `ActivationCommitUnknownError` requires a fresh flow. Supply `cleanup`/`invalidate` to W1.d; fence serving and retire signing authority before reopening after restore. PIN-1 and imported-vector gates are resolved; W3/W5 retain live activation qualification.
- [x] Lot 4 — R1 findings reconciled; scope-check passes for each selective authored commit (82 and 48 lines). PR #794 remains on `feat/app-cm-integration`. Exact-head W1.c CI passes on `fd8db52705771b0ed58372ce80e105f763daa997`: https://github.com/rhanka/sentropic/actions/runs/40610926409 (86/86 tests, all 16 vectors, typecheck/lint and teardown). This receipt-only commit must also receive a fresh exact-head CI result before delivery; report the final SHA and CI URL, with no merge or live activation.

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
