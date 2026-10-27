# Feature: Refresh W0-close.d published workspace tuple

## Objective
- [x] Freeze artifacts 0.2.3 / cluster-mesh 0.22.4 and qualify APP-P1 at the reconciled workspace head.

## Scope / Guardrails
- [x] Author codex gpt-6.1-sol high; owner deliverable 2; plan-v2 W0-close.d refresh.
- [x] Base feat/app-cm-w2b d0ce8aeb0; merge ancestry only; worktree tmp/worktrees/app-w0d-refresh.
- [x] Draft targets feat/app-cm-integration; no merge or production activation.
- [x] Review authored refresh from source merge 2c3bf7750; integration diff includes inherited W2.b/#702/UP-T ancestry.
- [x] Tests first; make-only; Docker flock; ENV=test-app-w0d last; no Python.
- [x] Existing Compose qualification service has no listeners; reserved API/UI/Maildev ports 9730/5930/1830 if needed.
- [x] Selective staging; scope-check before make commit; authored commits under 150 lines; no trailers.
- [x] Stop if cluster-mesh needs an upstream release to consume artifacts 0.2.3.
- [x] Preserve historical receipts; dedicated environment teardown after each runtime step.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/baselines/app-cm-w0/**`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
  - `api/tests/api/app-mcp-installed.test.ts`
  - `package-lock.json`
  - `api/package-lock.json`
  - `.h2a/owner-questions-w0.md`
  - `docs/runbooks/app-cm-baseline-restore/receipts/TEMPLATE.md`
  - `Makefile`
  - `packages/artifacts/**`
  - `api/src/scripts/oauth-provision-exchange-client.ts`
  - `api/tests/api/auth/oauth-token-exchange.test.ts`
  - `deploy/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `tools/memory-mcp-l5/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] BR00D-EXn records reason, impact and rollback before expansion.

## Feedback Loop
- [x] BR00D-EX2: merge main 72bb2da3d to consume already-published UP-T; listed inherited paths are merge-only, no author edits. Impact is existing upstream ancestry; rollback reverts the merge.
- [x] BR00D-EX1: merge #702 evidence and its owner question/restore template; retained evidence only; rollback reverts merge. No author edits outside scope.
- [ ] Independent reviews and remote CI remain separate from code authorship.
- [x] Payload receipt preserves union-order-only declaration differences in mesh/root-facade and gateway/request-receipts; all JS/exports/SQL and full artifacts/llm-mesh payloads match bytes.
- [x] Strict install and runtime tree pass; full development npm ls retains Vitest UI/esbuild/skills Node-types diagnostics, recorded in the complete tree.
- [x] Qualification: 22/22 registry/installed tests; APP-P1 manifest 80ca4b067a010690dc71036a3237a70b91d99d7c025ded7173566d0ae55b1600; no upstream bump.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one author; external independent review.

## UAT Management (in orchestration context)
- [x] Package/registry qualification only; browser and production acceptance remain downstream.

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, rules, plan-v2, template and receiving contracts; harness branch check passed.
- [x] Lot 1: merge #702; published strict consumer first; cluster-mesh resolves artifacts 0.2.3 with Comments/gateway.
- [x] Lot 2: normalized published payload hashes, clean source equivalence, complete workspace resolution; merge published UP-T ancestry without package author edits.
- [x] Lot 3: recompute APP-P1 with mcp:tools:invoke; observe old-pin refusal, then update registry and api/tests/api/{app-mcp-registry,app-mcp-installed}.test.ts.
- [x] Lot 4: refresh reservations.md, host-fit.md, catalog-context.md and published-tuple.json; dated evidence and exact base/lock hashes.
- [x] Lot 5: installed/profile tests, scope/branch gates, locked make down, empty stack, draft PR and head.

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
