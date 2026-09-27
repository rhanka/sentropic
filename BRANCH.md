# Feature: Train lock integrity registry wait budget

## Objective
- [x] Align the train lock integrity registry defaults with the 18 x 10 s registry wait budget.

## Scope / Guardrails
- [x] Work only in `tmp/ci-lock-wait` on `fix/cluster-mesh-lock-integrity-wait`.
- [x] Use Make-only Docker validation with `ENV=test-ci-lock-wait` last.
- [x] Reserve slot 0 for backlog item 3: API_PORT=9015 UI_PORT=5215 MAILDEV_UI_PORT=1115.
- [x] Preserve unit-test environment overrides; no push, PR, merge, or publication.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/packaging/check-lock-integrity.mjs`
  - `packages/cluster-mesh/tests/packaging/*.spec.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - Everything outside the Allowed Paths.
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `packages/cluster-mesh/packaging.mk`
  - `packages/*/package.json`
- [x] **Conditional Paths**: none; stop on any required scope expansion.
- [x] **Exception process**: record a blocked item before any forbidden change; no exceptions authorized.

## Feedback Loop
- [x] CIWAIT-A1 — attention: retain existing override-based registry tests; changing only defaults is the conservative fix for the reported visibility delay. Owner: agent; resolved 2026-09-26.

## AI Flaky tests
- [x] Not applicable: deterministic package tests; no flaky acceptance requested.

## Orchestration Mode (AI-selected)
- [x] Mono-branch: one local change and one validation cycle; conductor owns independent review.

## UAT Management (in orchestration context)
- [x] Web, Chrome, and VS Code UAT not applicable: no user interface changes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read repository rules and branch template; inspect targets and registry helper.
  - [x] Verify requested branch and mechanical `harness check branch` (PASS C1).
  - [x] Confirm narrow allowed paths and isolated environment.
- [x] **Lot 1 — Registry defaults**
  - [x] Change helper defaults from 12/5000 to 18/10000 and header to 18 x 10 s.
  - [x] Preserve `lock-integrity-registry.spec.ts` overrides; no old budget assertions found.
  - [x] Confirm package bump exemption: `.github/workflows/ci.yml:60` skips packages without `src/` changes.
- [x] **Lot 2 — Final validation and local handoff**
  - [x] `make test-cluster-mesh ENV=test-ci-lock-wait` passed, including all four registry tests; packaging-only suites skip without their fixture environment.
  - [x] `make scope-check ENV=test-ci-lock-wait` passed C2 before commit.
  - [x] Inspect final diff; include this checklist with the local `make commit`, without attribution.
  - [x] `make down API_PORT=9015 UI_PORT=5215 MAILDEV_UI_PORT=1115 ENV=test-ci-lock-wait` passed; matching `make ps` reports no services.
  - [x] Local handoff only; conductor owns independent review and publication workflow. Risk: longer failure latency if a required version never appears.
