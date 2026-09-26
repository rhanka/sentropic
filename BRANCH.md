# Feature: GPT-6 Sol and Luna routing candidate

## Objective
- [ ] Prepare @sentropic/llm-mesh 0.22.1 with GPT-6 Sol/Luna and updated routing; no push, PR, merge or publication.

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
- [x] **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/llm-gateway/**`
  - `packages/cluster-mesh/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
- [x] **Conditional Paths**: `docs/runbooks/model-update-launch-packet.md` only for an incorrect procedure.
- [x] Exceptions: none; explicit owner scope supersedes wider runbook consumer/publication requirements.

## Feedback Loop
- [x] G6-01 attention: conductor real `codex exec -m <id>` calls on 2026-09-26 verified Sol, Luna and Astra with ChatGPT-account login; direct OpenAI API availability remains unverified.
- [x] G6-02 attention: GPT-6 Terra returned HTTP 400 unsupported on that account; omit it entirely and retain GPT-5.6 Terra targets.
- [x] G6-03 attention: inherit matching 5.6 profile capabilities as unverified, with code comments; no invented context/output limits.
- [x] G6-04 attention: council generator supports exclusions only; classify new models as excluded like matching 5.6 models, without asserting benchmark equivalence.
- [x] G6-05 attention: retain GPT-5.6 catalog entries and faithful direct routes for reversibility; switch standard alias targets only.
- [x] G6-06 attention: owner limits consumer changes; gateway/cluster compatibility checks use workspace; product/API and external host defaults remain conductor work.
- [x] G6-07 acknowledge: owner-authorized root lock refresh via `make lock-root` changes only mesh version 0.22.0 to 0.22.1; gateway `^0.22.0` and cluster `>=0.22.0 <0.23.0` accept it.
- [ ] G6-08 blocked: gateway tests/target.test.ts:227,236 pin old Sol/Luna alias targets; 272 tests pass, one fails at line 239. Owner exception requested for these two test expectations only; gateway source/version unchanged. Acceptance: full gateway suite passes; rollback: restore two expected ids.
- [x] G6-09 attention: initial cluster prerequisite install failed EACCES removing root-owned mesh Vitest cache; `make clean-node-modules` cleared only this worktree's generated dependencies before retry.
- [ ] G6-10 blocked: cluster tests/integrations/{gateway-surface,llm-surface}.spec.ts:64,62 pin installedVersion 0.22.0; workspace correctly reports 0.22.1. Request test-only exception for both expected values; owner: conductor. Acceptance: cluster suite green against mesh 0.22.1; rollback: restore two expected versions.

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
- [ ] Lot 5: gateway and cluster workspace regression tests; scope checks; candidate SHA-256 and commit history; environment cleanup.

## Checks and Candidate Evidence
- [x] PASS `make llm-mesh-add-model MODEL=gpt-6-sol BASE=gpt-5.6-sol DRY_RUN=1 ENV=test-llm-mesh-gpt6` and apply without `DRY_RUN=1`.
- [x] PASS `make llm-mesh-add-model MODEL=gpt-6-luna BASE=gpt-5.6-luna DRY_RUN=1 ENV=test-llm-mesh-gpt6` and apply without `DRY_RUN=1`.
- [x] PASS `make refresh-llm-model-equivalences check-llm-model-equivalences ENV=test-llm-mesh-gpt6`.
- [x] PASS `make test-llm-mesh SCOPE=tests/routing-targets.test.ts ENV=test-llm-mesh-gpt6` (23 tests).
- [x] PASS `make lock-root ENV=test-llm-mesh-gpt6` (only linked mesh version changed).
- [x] PASS `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh build-llm-mesh pack-llm-mesh PACK_DESTINATION=tmp/llm-mesh-gpt6-candidate ENV=test-llm-mesh-gpt6` (32 files, 278 tests).
- [x] PASS `make scope-check ENV=test-llm-mesh-gpt6` and `harness check scope`; an earlier advisory C2 failure required moving the authorized lockfile from Conditional to Allowed paths.
- [x] Candidate `tmp/llm-mesh-gpt6-candidate/sentropic-llm-mesh-0.22.1.tgz`; SHA-256 `ebfcaec796d186c26cc2145ee2ae173ec04b188156f8ff53f531a8fae02d37b6`.
- [x] GPT-5.6 Sol/Luna profiles specify no context/output limits; GPT-6 profiles preserve that absence.
- [ ] FAIL `make test-llm-gateway test-cluster-mesh ENV=test-llm-mesh-gpt6`: gateway expectation mismatch (G6-08); cluster target not reached, launched separately.
- [x] PASS `make check-llm-model-equivalences ENV=test-llm-mesh-gpt6`.
- [x] PASS `make down API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6` and `make ps API_PORT=9472 UI_PORT=5672 MAILDEV_UI_PORT=1572 ENV=test-llm-mesh-gpt6` (no services).
- [x] PASS `make clean-node-modules ENV=test-llm-mesh-gpt6` after initial `make test-cluster-mesh ENV=test-llm-mesh-gpt6` prerequisite EACCES failure.
- [ ] FAIL `make test-cluster-mesh ENV=test-llm-mesh-gpt6` after cleanup: 392 passed, 2 failed (G6-10), 34 skipped by suite configuration.
- [x] PASS mechanical harness scope check with all 14 changed paths explicitly supplied; no forbidden source or test file modified.
