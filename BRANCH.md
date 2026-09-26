# Feature: GPT-6 Sol and Luna routing candidate

## Objective
- [x] Prepare @sentropic/llm-mesh 0.22.1 with GPT-6 Sol/Luna and updated routing; no push, PR, merge or publication.

## Scope / Guardrails
- [x] Worktree `tmp/llm-mesh-gpt6`, branch `feat/llm-mesh-gpt6`; mechanical harness branch check passed.
- [x] Make-only Docker checks; `ENV=test-llm-mesh-gpt6` last; ports API 9472, UI 5672, Maildev UI 1572.
- [x] Atomic commits below 150 changed lines, explicit staging, no attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**`
  - `scripts/llm-model-equivalences/**`
  - `BRANCH.md`
  - `package-lock.json`
  - `packages/llm-gateway/tests/target.test.ts`
  - `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts`
  - `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/src/**`
  - `packages/cluster-mesh/package.json`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
- [x] **Conditional Paths**: `docs/runbooks/model-update-launch-packet.md` only for an incorrect procedure.
- [x] Exception BRG6-EX1: conductor approved the three consumer test files above on 2026-09-26; all other consumer paths remain outside scope.

## Feedback Loop
- [x] G6-01 acknowledge: conductor real calls on 2026-09-26 verified GPT-6 Sol/Luna with HTTP 200 on the direct OpenAI Responses API and working through Codex; existing Astra was also verified through Codex with ChatGPT-account login.
- [x] G6-02 acknowledge: conductor real calls on 2026-09-26 returned HTTP 404 for GPT-6 Terra on the direct OpenAI API and HTTP 400 through Codex with ChatGPT-account login; omit it and retain GPT-5.6 Terra targets.
- [x] G6-03 attention: inherit matching 5.6 profile capabilities as unverified, including context window/max output where inherited, with code comments; no invented limits.
- [x] G6-04 attention: council generator supports exclusions only; classify new models as excluded like matching 5.6 models, without asserting benchmark equivalence.
- [x] G6-05 attention: retain GPT-5.6 catalog entries and faithful direct routes for reversibility; switch standard alias targets only.
- [x] G6-06 attention: owner limits consumer changes; gateway/cluster compatibility checks use workspace; product/API and external host defaults remain conductor work.
- [x] G6-07 acknowledge: owner-authorized root lock refresh via `make lock-root` changes only mesh version 0.22.0 to 0.22.1; gateway `^0.22.0` and cluster `>=0.22.0 <0.23.0` accept it.
- [x] G6-08 acknowledge: BRG6-EX1 authorizes updating gateway Sol/Luna expectations to GPT-6; source/version unchanged. Acceptance: full gateway suite passes; rollback: restore two expected ids.
- [x] G6-09 attention: initial cluster prerequisite install failed EACCES removing root-owned mesh Vitest cache; `make clean-node-modules` cleared only this worktree's generated dependencies before retry.
- [x] G6-10 acknowledge: BRG6-EX1 authorizes updating both cluster integration expectations to workspace mesh 0.22.1. Acceptance: cluster suite green; rollback: restore two expected versions.
- [x] BRG6-EX1 acknowledge: conductor-approved scope extension; reason: consumer tests pin workspace mesh values; impact: tests only, no consumer source/package.json changes, version bumps or republishing; rollback: revert the three test-file changes.
- [x] G6-11 attention: pack guard rejected the occupied candidate directory; conservatively preserve it as `tmp/llm-mesh-gpt6-candidate-before-fix1` and repack at the requested path for byte comparison.

## AI Flaky tests
- [x] No live tests or flaky acceptance planned; conductor receipts establish model availability only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch implementation; independent review belongs to conductor handoff.

## UAT Management (in orchestration context)
- [x] Library-only change: no web, Chrome or VSCode UAT; verify callable route identities with deterministic tests.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, template, runbook, scaffold tests/script; confirm npm latest 0.22.0 and branch.
- [x] Lot 1: scaffold Sol/Luna; review catalog/providers; bump package.json and CHANGELOG; remove scaffold markers.
- [x] Lot 2: switch standard routing targets; classify council source and regenerate output; Cloud Code capability aliases need no change.
- [x] Lot 3: update routing-targets, route-selection, facade, budget-quote and add-model-script tests; assert new Codex routes and no GPT-6 Terra target.
- [x] Lot 4: typecheck, lint, full mesh tests (278), build, pack and council freshness checks.
- [x] Lot 5: gateway and cluster workspace regression tests; scope checks; candidate SHA-256 and commit history; environment cleanup.
- [x] Fix 1: apply approved consumer expectations and verified availability notes; rerun consumer/mesh tests, pack and scope check.

## Checks and Candidate Evidence
- [x] PASS `make llm-mesh-add-model MODEL=gpt-6-sol BASE=gpt-5.6-sol DRY_RUN=1 ENV=test-llm-mesh-gpt6` and apply without `DRY_RUN=1`.
- [x] PASS `make llm-mesh-add-model MODEL=gpt-6-luna BASE=gpt-5.6-luna DRY_RUN=1 ENV=test-llm-mesh-gpt6` and apply without `DRY_RUN=1`.
- [x] PASS `make refresh-llm-model-equivalences check-llm-model-equivalences ENV=test-llm-mesh-gpt6`.
- [x] PASS `make test-llm-mesh SCOPE=tests/routing-targets.test.ts ENV=test-llm-mesh-gpt6` (23 tests).
- [x] PASS `make lock-root ENV=test-llm-mesh-gpt6` (only linked mesh version changed).
- [x] PASS `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh build-llm-mesh pack-llm-mesh PACK_DESTINATION=tmp/llm-mesh-gpt6-candidate ENV=test-llm-mesh-gpt6` (32 files, 278 tests).
- [x] PASS `make scope-check ENV=test-llm-mesh-gpt6` and `harness check scope`; an earlier advisory C2 failure required moving the authorized lockfile from Conditional to Allowed paths.
- [x] Fix 1 candidate `tmp/llm-mesh-gpt6-candidate/sentropic-llm-mesh-0.22.1.tgz`; SHA-256 `d73c860abeb9bbba7141a2f78ce57b3a6f7031a3c9bd23f8dedd0726c9578e6d` (previous: `ebfcaec796d186c26cc2145ee2ae173ec04b188156f8ff53f531a8fae02d37b6`).
- [x] GPT-5.6 Sol/Luna profiles specify no context/output limits; GPT-6 profiles preserve that absence.
- [x] PASS `make test-llm-gateway test-cluster-mesh ENV=test-llm-mesh-gpt6` after Fix 1: gateway 273 passed; cluster 394 passed, 34 skipped by suite configuration. Resolves G6-08/G6-10.
- [x] PASS `make check-llm-model-equivalences ENV=test-llm-mesh-gpt6`.
- [x] PASS `make down API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6` and `make ps API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6` (no services).
- [x] PASS `make clean-node-modules ENV=test-llm-mesh-gpt6` after initial `make test-cluster-mesh ENV=test-llm-mesh-gpt6` prerequisite EACCES failure.
- [x] Historical `make test-cluster-mesh ENV=test-llm-mesh-gpt6` failure (two version expectations, G6-10) resolved by the approved Fix 1 rerun above.
- [x] PASS mechanical harness branch check and Fix 1 `make scope-check ENV=test-llm-mesh-gpt6`; consumer edits limited to BRG6-EX1 tests.
- [x] Registry check: npm latest llm-mesh is 0.22.0; existing candidate bump to 0.22.1 remains sufficient for the catalog comment update.
- [x] PASS Fix 1 `make test-llm-mesh ENV=test-llm-mesh-gpt6` (32 files, 278 tests).
- [x] PASS Fix 1 `make pack-llm-mesh PACK_DESTINATION=tmp/llm-mesh-gpt6-candidate ENV=test-llm-mesh-gpt6` after preserving the previous artifact (G6-11).
- [x] PASS Fix 1 cleanup: `make down API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6`; `make ps API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6` reports no services.
