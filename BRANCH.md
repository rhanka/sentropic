# Feature: W3.c canonical artifact content image

## Objective
- [ ] Ship the W3.b content entrypoint in the canonical API/IdP image with content hash, runtime and identity evidence.

## Scope / Guardrails
- [x] Implement `.tmp/app-switch-week/plan-v2.md` W3.c, sections 1–5; inherit W3.b (#810) from base `d4625d764`.
- [x] Work only in `tmp/worktrees/app-w3c`, branch `feat/app-cm-w3c`, base `origin/feat/app-cm-integration`.
- [x] Sole W3.c build writer; merge only, never rebase or force-push; no package/lock/schema changes.
- [x] Use Make targets, ENV last, shared `/home/antoinefa/.cache-tmp/sentropic-docker.lock` for every Docker/test step.
- [x] Use `API_PORT=8805 UI_PORT=5191 MAILDEV_UI_PORT=1098 ENV=test-app-w3c`; ports checked free before startup.
- [x] No production activation, publication or deployment; no Python, AI trailers, broad staging or destructive cleanup.
- [x] Keep selective commits below 150 changed lines and stop the isolated stack after each Docker step.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/Dockerfile`
  - `scripts/test-artifact-content-image.sh`
  - `scripts/test-api-image-canonical.sh`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `api/src/**`
  - `apps/artifact-content/**`
  - `deploy/**`
  - `docker-compose*.yml`
  - `.track/**`
  - `.cursor/rules/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `.github/workflows/app-cm-w3c.yml`
  - `.dockerignore`
- [x] **Exception process**: BR03c-EX1 below records the plan-authorized build/CI extension before edits.

## Feedback Loop
- [x] BR03c-EX1 — acknowledged: W3.c authorizes `Makefile`, `.github/workflows/{ci,app-cm-w3c}.yml` and `.dockerignore` for hash/filters, runtime gates and generated bundle exclusion. The topic workflow follows W3.b because shared CI excludes this integration base. Impact: canonical API image and validation only. Rollback: revert W3.c commits; retain W3.b source and prior qualified image. No deployment edits.
- [x] Track remains single-writer: update this mergeable plan; conductor owns import and independent final acceptance.

## AI Flaky tests
- [x] No AI/provider behavior changes or accepted flaky tests; all selected checks must pass.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one code author; merge-only integration, draft PR against `feat/app-cm-integration`.

## UAT Management (in orchestration context)
- [x] No UI change; isolated image health/denial qualification only. W3.d/e own deployment and HTTPS browser acceptance.
- [x] No live activation; FIRST-IMMO and production owner gates remain downstream.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read MASTER/workflow/testing/subagents, README/TODO/PLAN, branch template, W3.c row and cited policy/dependency sections.
  - [x] Read W3.b entrypoint/runtime and #712 Dockerfile, resolver, publisher, canonical tests, hash inputs and CI filters.
  - [x] Create isolated worktree and pass `harness check branch` before work.
- [x] **Lot 1 — Content hash and build inputs**
  - [x] Add failing content-only invalidation and CI-filter tests in `scripts/test-artifact-content-image.sh`: both fail on the missing content input/filter.
  - [x] Extend canonical required-input inventory in `scripts/test-api-image-canonical.sh`.
  - [x] Hash/copy content sources, exclude generated bundles and align `.github/workflows/ci.yml` filters.
  - [x] Gate: scoped static image/hash/filter tests turned red then green; CI filter guard passes.
- [ ] **Lot 2 — Production entrypoint**
  - [x] Add real-image test for pruned dependencies, Node startup, health, denial and shutdown; assembly test fails because content sources are not copied.
  - [x] Compile/copy content bundle in `api/Dockerfile`, retaining existing API/IdP commands and single image resolver.
  - [ ] Gate: build canonical image once, run content process with no activation/DB/storage credentials, verify health and denial.
- [ ] **Lot 3 — Artifact identity and CI**
  - [x] Test image receipt equality/substitution refusal using #712 canonical resolver/publisher; dry-run asserts canonical promotion pins without deployment.
  - [x] Wire real content-image verification before image save/upload in `.github/workflows/ci.yml`; ordering test turned red then green.
  - [ ] Gate: `test-ci-api-image-canonical`, `test-ci-api-tag-guard`, `test-ci-api-runtime`, `test-artifact-content-image`, `check-ci-version-filters`.
- [ ] **Lot 4 — Docs consolidation and final validation**
  - [ ] Keep acceptance evidence and review findings in this plan; no unrelated spec edits or package bumps.
  - [ ] Review every changed hunk; pass branch/scope checks and shell syntax checks.
  - [ ] Create draft PR with this file as body and a 3–6 step plan comment; push without force.
  - [ ] Confirm GitHub CI success on the exact final head and report PR/head.
  - [ ] Run `make down ENV=test-app-w3c` and verify no remaining project services.
