# Feature: W3.c canonical artifact content image

## Objective
- [x] Ship the W3.b content entrypoint in the canonical API/IdP image with content hash, runtime and identity evidence.

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
- [x] Review P2-2 — integration close-out owner: conductor. Remove `.github/workflows/app-cm-w3*.yml` before `feat/app-cm-integration` merges into `main`. That integration PR is the first real execution of the `ci.yml` content gate through `make build-api` (canonical resolver reuse path, real registry); shared CI must pass on its exact head.
- [x] Merge #813 from `origin/feat/app-cm-integration` at `b0e60eb34`, retaining this W3.c plan for the BRANCH.md conflict; no rebase or force-push.

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
- [x] **Lot 2 — Production entrypoint**
  - [x] Add real-image test for pruned dependencies, Node startup, health, denial and shutdown; assembly test fails because content sources are not copied.
  - [x] Compile/copy content bundle in `api/Dockerfile`, retaining existing API/IdP commands and single image resolver.
  - [x] Gate: build canonical image once, run content process with no activation/DB/storage credentials, verify health, denial, shutdown and incomplete-activation refusal (CI 40636597780).
- [x] **Lot 3 — Artifact identity and CI**
  - [x] Test image receipt equality/substitution refusal using #712 canonical resolver/publisher; dry-run asserts canonical promotion pins without deployment.
  - [x] Wire real content-image verification before image save/upload in `.github/workflows/ci.yml`; ordering test turned red then green.
  - [x] Gate: `test-ci-api-image-canonical`, `test-ci-api-tag-guard`, `test-ci-api-runtime`, `test-artifact-content-image`, `check-ci-version-filters` passed in CI 40636597780 on `275f0a0a0871417b4cb66b3ebcd0a5f40b255f8f`.
  - [x] CI-tested image receipt: `sha256:7c0bbee42561078fad5c782d1e8fe0600bb732c7b79c6f3eaaae8a0b67acfd3f`; source tag `853d98`. Publication guards use mocks; promotion is dry-run only, never a production receipt.
- [x] **Lot 4 — Docs consolidation and final validation**
  - [x] Local canonical build and the same five Make validation targets passed with all assigned ports and `ENV=test-app-w3c`; receipt `sha256:32718eeb1f4425bd6ed61674aa156671b368a2f0270ca1b8e87cc45e22deee29`.
  - [x] Keep acceptance evidence in this plan; no unrelated spec edits or package bumps. Independent acceptance remains with the conductor; this is an author draft.
  - [x] Review every changed hunk; branch/scope and shell syntax checks pass. Scope exception uses the mechanical `BR03c-EX1` grammar.
  - [x] Create draft PR #812 with this file as body and a five-step plan comment; push without force.
  - [x] Exact-head CI verifies checkout identity; retain final head/run/result in the PR validation comment after the evidence commit.
  - [x] Run scoped `make down`, remove the disposable test volume with scoped `make clean`, repeat `make down` and verify `make ps` has no project services; all under the shared lock with `ENV=test-app-w3c`.
