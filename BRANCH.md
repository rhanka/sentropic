# Feature: Add GPT-6.1 Sol to llm-mesh

## Objective
- [ ] Add `gpt-6.1-sol` to @sentropic/llm-mesh 0.22.3 and hand off an open PR with green CI and independent review.

## Scope / Guardrails
- [x] Work only in `tmp/llm-mesh-gpt-6-1-sol`, branch `feat/llm-mesh-gpt-6-1-sol`, base `b79ed90b161787fe9d7d4301ec44748616a73820`; mechanical harness branch check passed.
- [x] Make-only, Docker-first; no native npm/node, Python, real provider tokens, root checkout edits, merge or publication.
- [x] Every Make command ends with `API_PORT=9481 UI_PORT=5681 MAILDEV_UI_PORT=1581 ENV=test-llm-mesh-gpt61-sol`; ports verified free.
- [x] Preserve existing GPT-6 Sol and Claude alias targets; inherited model capabilities remain unverified.
- [x] Patch bump 0.22.2 to 0.22.3 preserves gateway `^0.22.0` and cluster `>=0.22.0 <0.23.0` compatibility.
- [x] English code, documentation, commits and PR; selective staging and separate staging/commit calls; commits below 150 lines.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md`
  - [x] `packages/llm-mesh/src/providers.ts`
  - [x] `packages/llm-mesh/src/catalog.ts`
  - [x] `packages/llm-mesh/src/routing-targets.ts`
  - [x] `packages/llm-mesh/src/generated-model-council.ts`
  - [x] `packages/llm-mesh/tests/routing-targets.test.ts`
  - [x] `packages/llm-mesh/tests/add-model-script.test.ts`
  - [x] `packages/llm-mesh/tests/budget-quote.test.ts`
  - [x] `packages/llm-mesh/package.json`
  - [x] `packages/llm-mesh/CHANGELOG.md`
  - [x] `scripts/llm-model-equivalences/council.source.json`
  - [x] `api/tests/api/models.test.ts`
  - [x] `api/tests/unit/llm-runtime-stream.test.ts`
  - [x] `package-lock.json` (BR61-EX1)
  - [x] `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (BR61-EX2)
  - [x] `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts` (BR61-EX2)
  - [x] `packages/cluster-mesh/tests/packaging/**` (BR61-EX3, version pins and regenerated fixture lock only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/**`, `PLAN.md`, `plan/**`
  - [x] `packages/llm-gateway/**`, `packages/cluster-mesh/src/**`, `packages/cluster-mesh/package.json`
- [x] **Conditional Paths (allowed only with explicit exception)**:
  - [x] `package-lock.json` (BR61-EX1), cluster integration pins (BR61-EX2), cluster packaging test data (BR61-EX3); approved paths repeated in Allowed Paths.
- [x] **Exception process**: record reason, impact, rollback and authorization before editing.

## Feedback Loop
- [x] BR61-EX1 acknowledge: owner authorizes `make lock-root`; lock-sync gate requires mesh 0.22.3. Impact: workspace mesh version only. Rollback: revert with manifest bump.
- [x] BR61-EX2 acknowledge: owner authorizes cluster installed-version test pins following PR #625 and b1b631a76. Impact: two test literals only. Rollback: revert with manifest bump.
- [x] BR61-EX3 acknowledge: owner authorizes cluster release-train tests and fixture lock following PR #625 and 8dadb1614. Impact: mesh 0.22.3 test data and archive integrity only. Rollback: revert with manifest bump.
- [x] Owner questions and final evidence belong in local `.h2a-report.md`; stop at the open PR, never merge or publish.

## AI Flaky tests
- [x] No live provider testing; for CI `api/tests/ai/**` nondeterminism, rerun once on the same commit and record exact signature in a PR comment.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one implementation owner and the explicitly requested separate read-only Codex review.
- [x] Review uses requested model `gpt-5.5`, effort `xhigh`; no Astra sessions.

## UAT Management (in orchestration context)
- [x] Package-only change; model catalog and mocked runtime coverage qualify the user-visible behavior; no web/Chrome/VSCode UI changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, template and precedents; verify branch, base, clean worktree and free ports; declare scope exceptions.
- [x] Lot 1: scaffold with dry run then apply; verify label, inherited capabilities and faithful Codex route; add council exclusion and regenerate via Make.
- [x] Lot 2: extend routing/scaffolder/quote tests, API catalog list/count and runtime stream fixture; preserve existing aliases.
- [ ] Lot 3: verify registry version, bump mesh to 0.22.3 and changelog; refresh root lock; align cluster integration and packaging test versions and regenerate fixture lock.
- [ ] Lot 4: run `test-llm-mesh`, `typecheck-llm-mesh`, `build-llm-mesh`, council freshness and `scope-check`; scoped API catalog/runtime tests and cluster validations.
- [ ] Lot 5: push branch; create PR to main using this plan as body; post 3-step implementation/validation/review plan; wait for CI and fix failures.
- [ ] Lot 6: separate read-only `gpt-5.5` xhigh PR-diff review; resolve blocking findings, rerun affected gates, push and post verdict; write report and stop.
