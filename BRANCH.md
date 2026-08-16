# Feature: BR-75 Recurring LLM Model Update Runbook

## Objective
- [x] Make recurring LLM model updates repeatable through one owner directive, one safe scaffold command, explicit evidence gates, and blind review.

## Scope / Guardrails
- [x] Base is `origin/main` at merge PR #539; PR #540 is the canonical model-cutover reference only.
- [x] Scope is facilitation documentation, one additive scaffold script, its unit test, and one Make target.
- [x] Preserve existing catalog, provider, routing, equivalence, package publication, and consumer behavior.
- [x] Require official model-id evidence before any scaffold is applied.
- [x] Use make-only commands, dedicated `ENV=test-model-update-runbook` for tests, selective staging, and sub-150-line commits.
- [x] Keep all code, documentation, commit text, and PR text in English.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**
  - [x] `BRANCH.md`
  - [x] `spec/SPEC_RUNBOOK_LLM_MODEL_UPDATE.md`
  - [x] `docs/runbooks/model-update-launch-packet.md`
  - [x] `packages/llm-mesh/scripts/add-model.mjs`
  - [x] `packages/llm-mesh/tests/add-model-script.test.ts`
  - [x] `.tmp/engage/model-update-runbook-report.md`
- [x] **Forbidden Paths (must not change in this branch)**
  - [x] `docker-compose*.yml`
  - [x] `.cursor/rules/**`
  - [x] `.github/workflows/**`
  - [x] Existing `packages/llm-mesh/src/**` model data and generated council output.
  - [x] Package manifests and lockfiles; this branch does not ship a model or package runtime change.
- [x] **Conditional Paths**
  - [x] `Makefile` only under `BR75-EX1`.
- [x] **Exception process**
  - [x] Declare an exception before changing any other conditional or forbidden path.

## Feedback Loop
- [x] `BR75-EX1` accepted by owner request: change the normally forbidden `Makefile` because the repository's make-only policy requires an entrypoint for this recurring job; impact is one additive target plus one script; rollback removes that target and script.
- [x] Source gap: PR #540 is not merged into this branch base, so its Gemini 3.7 changes are evidence, not files to copy into this deliverable.
- [x] Source gap: vendor documentation is mutable; every future update must capture its dated official model-id evidence in its PR.
- [x] Source gap: host defaults for h-cond/h2a-runtime, including agy, live outside this repository and require a notification handoff rather than an in-repo edit.

## AI Flaky tests
- [x] Accept no deterministic scaffold, generation-freshness, typecheck, lint, build, or package test failure as flaky.

## Orchestration Mode
- [x] **Mono-branch** with no implementation sub-agent; two independent blind h2a review legs are read-only gates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and exact scope**
  - [x] Read project rules, workflow, sub-agent contract, project context, PLAN model-council constraint, and branch template.
  - [x] Verify `feat/llm-model-update-runbook` mechanically with `harness check branch`.
  - [x] Confirm HEAD equals `origin/main` merge PR #539 and study the complete PR #540 delta.
  - [x] Locate catalog, providers, route definitions, capability sources, council generator/check, publish order, and internal consumers.
  - [x] Confirm official OpenAI, Anthropic, and Gemini model registries are reachable.

- [ ] **Lot 1 — Owner runbook**
  - [x] Add the anti-phantom evidence gate and copy-from-BASE procedure.
  - [x] Document catalog, provider, routing, and council refresh/check gates.
  - [ ] Add a precise current-tree file-and-line table and mark every unresolved external/source gap.
  - [ ] Gate: Markdown paths and cited line anchors verified against the current tree.

- [ ] **Lot 2 — Safe add-model scaffold**
  - [x] Add an idempotent script that plans or applies catalog, provider, and default-route stubs copied from `BASE`.
  - [x] Make dry-run side-effect free and print the manual evidence, council, consumer, test, version, publication, and host-default checklist.
  - [x] Add focused tests for valid stubs, dry-run immutability, idempotence, partial repair, and invalid input.
  - [x] Add `make llm-mesh-add-model MODEL=<id> BASE=<id>` under `BR75-EX1`.
  - [ ] Gate: focused test and dry-run make invocation are green.

- [ ] **Lot 3 — Standard MODEL UPDATE launch packet**
  - [ ] Add copy-ready drumbeat and mesh-lane mandates for `MODEL=<X>` and `BASE=<Y>`.
  - [ ] Specify Codex 5.6 Sol xhigh build, blind Opus 4.8 review, exact evidence/scope/test/publish gates, stop conditions, and report contract.
  - [ ] Gate: packet requires one directive, one make scaffold, one blind review, and no merge.

- [ ] **Lot 4 — Final validation and PR-only delivery**
  - [ ] Run `make scope-check`, `harness check scope`, council freshness, focused tests, dry run, build, typecheck, lint, and test gates.
  - [ ] Run two eligible independent blind review legs on the exact diff and reconcile all findings.
  - [ ] Verify `git branch --show-current` immediately before every commit.
  - [ ] Push `feat/llm-model-update-runbook`, open the requested PR without merging, and verify CI.
  - [ ] Write `.tmp/engage/model-update-runbook-report.md` and deposit a valid `sentropic.h2a` v1.0 report to `claude:sentropic-drumbeat:21fe3355ad7d`.
