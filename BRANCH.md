# Feature: Add Gemini 3.8 Flash and remap Fable and Opus routing

## Objective
- [ ] Add `gemini-3.8-flash` to `@sentropic/llm-mesh` and expose the updated routing contract through `@sentropic/llm-gateway`.
- [ ] Route Fable 5/5.1 fallbacks through GPT-6 Astra and Gemini 3.8 Flash, and route Opus 5 Codex fallbacks through GPT-5.6 Sol.

## Scope / Guardrails
- [ ] Work only in the standalone clone `tmp/mesh-g38` on `feat/mesh-gemini38-fable-astra-remap`.
- [ ] Use Docker-first Make targets; test only with `ENV=test-mesh-g38` and isolated ports `9330/5530/1430`.
- [ ] Do not merge, publish manually, touch Opus 4.8 or Sonnet routes, weaken assertions, or increase timeouts.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths**
  - [ ] `BRANCH.md`, `packages/llm-mesh/**`, `packages/llm-gateway/**`
  - [ ] `scripts/llm-model-equivalences/council.source.json`, `package-lock.json`
- [ ] **Forbidden Paths**
  - [ ] `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - [ ] Unrelated packages, API, UI, E2E, Opus 4.8 routes, and Sonnet routes
- [ ] **Conditional Paths**
  - [ ] `Makefile` only under `BRMESH38-EX1` if no existing scoped lint gate can satisfy the owner-required package lint checks.

## Feedback Loop
- [ ] `attention`: owner supplied the exact model, routes, versions, commit trailers, PR title/body ending, and no-merge boundary.
- [ ] `attention`: replace the stale prior-feature branch record before implementation.
- [ ] `BRMESH38-EX1 attention`: package-specific lint Make targets are absent on the base; allow only the smallest Make-only lint entrypoints if the existing workflow cannot provide an equivalent scoped gate. Impact is package quality-gate wiring only; rollback is reverting those target hunks.

## AI Flaky tests
- [ ] Accept none without same-commit success and explicit owner sign-off; never add timeouts or weaken assertions.

## Orchestration Mode (AI-selected)
- [x] **Single branch, sole executor**
- [ ] **Multi-branch**

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and scope**
  - [x] Read the mandatory rules and harness/test guidance.
  - [x] Create the standalone clone, branch, and pass `harness check branch`.
  - [x] Confirm clean base `29cf19d5` and inspect the model scaffold, routes, council, tests, package versions, and Make targets.
  - [x] Run the Docker-based npm registry version audit: mesh `0.18.0`, gateway `0.14.0`, both equal npm latest.
- [ ] **Lot 1 — Model, routing, council, and tests**
  - [ ] Run `make llm-mesh-add-model MODEL=gemini-3.8-flash BASE=gemini-3.7-flash` and remove scaffold markers.
  - [ ] Apply the exact Fable 5/5.1 and Opus 5 route remaps without changing Opus 4.8 or Sonnet routes.
  - [ ] Refresh/check the council and verify Gemini 3.8 Flash is excluded like Gemini 3.7 Flash.
  - [ ] Update mesh routing, council, and canonical contract tests without weakening assertions.
  - [ ] Focused tests: `routing-targets.test.ts` and `equivalence-council.test.ts`.
- [ ] **Lot 2 — Gateway contract and package versions**
  - [ ] Update gateway target/canonical tests for the new ordered routes.
  - [ ] Bump mesh to `0.19.0`, gateway to `0.15.0`, gateway mesh floor to `^0.19.0`, and refresh lockfiles.
  - [ ] Focused test: `packages/llm-gateway/tests/target.test.ts`.
- [ ] **Lot 3 — Final gates and delivery**
  - [ ] Pass mesh typecheck, lint, and full test suite.
  - [ ] Pass gateway typecheck, lint, and full test suite.
  - [ ] Pass council freshness/test checks, scope checks, and final route/version/diff inspections.
  - [ ] Commit atomically with the owner-required trailers, push, create the PR, and verify CI status without merging.
