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
  - [x] `.h2a-report.md` (local conductor handoff only; never staged)
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
  - [x] `apps/auth-idp/web/package-lock.json` (BR61-EX4, blocking dependency security fixes only)
  - [x] `packages/cluster-mesh/tests/integrations/gateway-surface.spec.ts` (BR61-EX2)
  - [x] `packages/cluster-mesh/tests/integrations/llm-surface.spec.ts` (BR61-EX2)
  - [x] `packages/cluster-mesh/tests/packaging/**` (BR61-EX3, version pins and regenerated fixture lock only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/**`, `PLAN.md`, `plan/**`
  - [x] `packages/llm-gateway/**`, `packages/cluster-mesh/src/**`, `packages/cluster-mesh/package.json`
- [x] **Conditional Paths (allowed only with explicit exception)**:
  - [x] `package-lock.json` (BR61-EX1), cluster integration pins (BR61-EX2), cluster packaging test data (BR61-EX3); approved paths repeated in Allowed Paths.
  - [x] Root dependency lock updates and `apps/auth-idp/web/package-lock.json` (BR61-EX4) only for reproduced CI security blockers.
- [x] **Exception process**: record reason, impact, rollback and authorization before editing.

## Feedback Loop
- [x] BR61-EX1 acknowledge: owner authorizes `make lock-root`; lock-sync gate requires mesh 0.22.3. Impact: workspace mesh version only. Rollback: revert with manifest bump.
- [x] BR61-EX2 acknowledge: owner authorizes cluster installed-version test pins following PR #625 and b1b631a76. Impact: two test literals only. Rollback: revert with manifest bump.
- [x] BR61-EX3 acknowledge: owner authorizes cluster release-train tests and fixture lock following PR #625 and 8dadb1614. Impact: mesh 0.22.3 test data and archive integrity only. Rollback: revert with manifest bump.
- [x] BR61-EX4 acknowledge: owner authorizes fixing branch CI failures. CI run 36938864734 fails API/IdP and UI image audits on vulnerable devalue, plus root API SCA on brace-expansion. Scope: targeted compatible transitive lock updates only in root and IdP web locks; no manifest, source or scanner-policy changes. Impact: patched dependencies in the required image builds. Rollback: revert this security-only commit. Acceptance: image builds and SCA gates pass.
- [x] Owner questions and final evidence belong in local `.h2a-report.md`; stop at the open PR, never merge or publish.
- [x] BR61-Q1 resolved: fixture refresh prerequisite failed removing the generated Vitest cache (EACCES); ownership inspection confirmed the mismatch. Worktree-only `make clean-node-modules` cleared generated dependencies before retry; no source change.
- [x] BR61-Q2 resolved: cluster train bump collided with two deliberately mismatched 0.22.3 negative fixtures; move their wrong version to 0.22.4 to preserve version-rejection coverage. Focused and full reruns follow.

## AI Flaky tests
- [x] No live provider testing; for CI `api/tests/ai/**` nondeterminism, rerun once on the same commit and record exact signature in a PR comment.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one implementation owner and a conductor-provided independent review.
- [x] The conductor launches the reviewer; this branch launches no review session and uses no Astra sessions.

## UAT Management (in orchestration context)
- [x] Package-only change; model catalog and mocked runtime coverage qualify the user-visible behavior; no web/Chrome/VSCode UI changes.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, template and precedents; verify branch, base, clean worktree and free ports; declare scope exceptions.
- [x] Lot 1: scaffold with dry run then apply; verify label, inherited capabilities and faithful Codex route; add council exclusion and regenerate via Make.
- [x] Lot 2: extend routing/scaffolder/quote tests, API catalog list/count and runtime stream fixture; preserve existing aliases.
- [x] Lot 3: verify registry version, bump mesh to 0.22.3 and changelog; refresh root lock; align cluster integration and packaging test versions and regenerate fixture lock.
  - [x] Registry latest is 0.22.2; bumped manifest/changelog to 0.22.3, refreshed root lock via Make and aligned consumer test pins; fixture integrity regeneration follows the candidate pack.
  - [x] Packed mesh candidate SHA-256 `15af5a07015278a76a4e3c911e9a8c550b435f5406bb81d642fa2da71a5f01f2`; `refresh-lazy-package-lock` passed with guarded sibling receipts and regenerated the fixture lock.
- [ ] Lot 4: run `test-llm-mesh`, `typecheck-llm-mesh`, `build-llm-mesh`, council freshness and `scope-check`; scoped API catalog/runtime tests and cluster validations.
  - [x] Mesh: 32 files, 316 tests passed; typecheck, build, lint and council freshness passed. Scoped routing tests: 25 passed.
  - [x] Cluster: lint/typecheck/build passed; full suite passed 394 tests, 34 packaging tests skipped until dedicated packed qualification; corrected negative-version fixtures covered by the full rerun.
- [ ] Lot 5: push branch; create PR to main using this plan as body; post 3-step implementation/validation/review plan; wait for CI and fix failures.
- [ ] Lot 6: write PR number and head SHA to `.h2a-report.md`; wait for the conductor's review comment; resolve blocking findings, rerun affected gates, push and record verdict; write final report and stop.
