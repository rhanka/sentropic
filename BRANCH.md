# Feature: Add Fable 5.1 and GPT-6 Astra routing

## Objective
- [ ] Add `claude-fable-5-1` and `gpt-6-astra` to `@sentropic/llm-mesh` and expose the contract through `@sentropic/llm-gateway`.
- [ ] Keep every Fable 5.1 Codex fallback on `gpt-5.6-sol`, including `max`, until GPT-6 reaches GA.

## Scope / Guardrails
- [x] Work only in `tmp/feat-mesh-fable51-astra` on `feat/mesh-add-fable51-astra` from `origin/main@7a565be20`.
- [x] Sole-agent execution; no subagents, manual publication, or unrelated-package changes.
- [x] Make-only implementation and verification; tests use `ENV=test-feat-mesh-fable51-astra`, never `ENV=dev`.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths**
  - [ ] `BRANCH.md`, `packages/llm-mesh/**`
  - [ ] `packages/llm-gateway/package.json`, `packages/llm-gateway/tests/target.test.ts`
  - [ ] `scripts/llm-model-equivalences/council.source.json`, `package-lock.json`
- [ ] **Forbidden Paths**
  - [ ] `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`, `.github/workflows/**`
  - [ ] Unrelated packages, API, UI, E2E, and specifications
- [ ] **Conditional Paths**
  - [ ] None; declare `BRMESH-EXn` with reason, impact, and rollback before any unlisted path.

## Feedback Loop
- [x] `BRMESH-EX1 attention`: the sanctioned scaffold rejected the inline Anthropic provider registry; allow the smallest `add-model.mjs` parser fix plus regression test, rollback by reverting that isolated hunk.
- [x] `attention`: the owner supplied the exact ids, transports, interim equivalence, and GA cutover instruction; no live provider call is required.
- [x] `attention`: base `BRANCH.md` contained unrelated W33 residue; replace it before source commits.
- [x] `attention`: regenerate the model council from its pinned source; never hand-edit the output.

## AI Flaky tests
- [ ] Accept none without same-commit success and explicit owner sign-off; never add timeouts or weaken assertions.

## Orchestration Mode (AI-selected)
- [x] **Single branch, sole executor**; no interactive UAT for package catalog/route-table changes.
- [ ] **Multi-branch**

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and sanctioned flow**
  - [x] Read required rules/runbook; pass the expected-branch check; confirm clean base `7a565be20`.
  - [x] Inspect the scaffold, model/council/routes, tests, and manifests.
  - [x] Pre-bump audit: mesh `0.17.0`, gateway `0.13.3`, both equal npm latest.
  - [x] Repair the inline-provider defect; focused test and both dry-run previews pass.
- [x] **Lot 1 — Mesh models, routes, council, and tests**
  - [x] Apply both sanctioned scaffolds; verify profiles and faithful transports; remove markers.
  - [x] Add Fable 5.1 base/high/xhigh/max interim `gpt-5.6-sol` rows plus the GPT-6 GA switch comment.
  - [x] Classify both models, regenerate/check the council, and bump mesh to `0.18.0`.
  - [x] Extend add-model, routing-target, council, facade, and route-selection tests; focused runs pass (51 tests).
- [ ] **Lot 2 — Gateway publication contract**
  - [ ] Raise mesh floor to `^0.18.0`; bump gateway minor to `0.14.0`; extend `target.test.ts`.
  - [ ] Regenerate/inspect the root lock and run the focused gateway test.
- [ ] **Lot 3 — Final gates and delivery**
  - [ ] Run council check plus requested mesh typecheck/test/build/pack gates.
  - [ ] Run requested gateway typecheck/test gates.
  - [ ] Run `make scope-check` before each atomic `make commit`; inspect every hunk.
  - [ ] Push the branch, open the requested PR, and record versions/tests/commit/PR/GA-switch evidence.
