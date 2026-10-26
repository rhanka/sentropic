# Feature: Engram E2 non-publishing integration qualification

## Objective
- [ ] Deliver PRE-E0 evidence and BR-E2-EX1 only; open the CI preparation PR to main and leave merging to the conductor after owner GO.

## Scope / Guardrails
- [x] Sole release integrator: Codex, requested gpt-6.1-sol high; no delegated implementation.
- [x] Worktree: `tmp/worktrees/engram-e2-integration`; branch: `feat/engram-e2-integration`; base: `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`.
- [x] Make-only, ENV last: `ENV=test-e2-int`; Docker commands serialized with `/home/antoinefa/.cache-tmp/sentropic-docker.lock` and cleaned with `make down` after each step.
- [x] Use existing `docker-compose.immo-861.yml`; no published ports, no owner stacks, no migration or package version edits.
- [x] Keep Engram 0.21.1, L4 P2 `2b85ff28`, and original P1 `68181613ff36b601d7f6bb62550294fdcd2c0ad26f2ed25cc1ad2fa633fafd5a` unchanged.
- [x] Reserve mesh 0.23.0 after #709, Immo 0.22.0 and corrective 0.22.1; development manifests are pack-only and never published.
- [x] Future E0–E11 topics need their own exact scope declarations; this preparation does not authorize source implementation.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/**`
  - `package*.json`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/ci.yml` — BR-E2-EX1
  - `Makefile` — BR-E2-EX1
- **Exception process**:
  - [x] Declare BR-E2-EX1 below before implementation; retain main and Immo qualification and publication predicates.

## Feedback Loop
- [x] BR-E2-EX1 — `acknowledge`, owner: sole release integrator, 2026-10-26; bounded to `.github/workflows/ci.yml` and `Makefile`.
  - [x] Mechanical alias `BR2-EX1` names the same exception because the installed harness accepts only numbered BR identifiers.
  - [x] Rationale: topic merges otherwise bypass the required checks.
  - [x] Impact: additional qualification and artifact retention only for PRs targeting `feat/engram-e2-integration` with E2-relevant paths; main and Immo PRs skip `qualify-engram-e2` and retain their existing gates. Preserve all main-only publish event/ref predicates and forbid publishing development versions.
  - [x] Rollback: remove the E2 branch trigger, `changes.outputs.engram_e2`, its path filter, `qualify-engram-e2` and its `ci-gate` need, plus E2-specific Make runner wiring; preserve Immo/main gates and suspend E2 topic merges until equivalent checks are restored.
  - [x] P2-1: qualify the path-filter output by the E2 PR base in `changes`; retain the existing job predicate so the expected-result evaluator and dispatch agree.
  - [x] Selection dry-run (2026-10-26): parse the actual workflow, evaluate `changes.outputs.engram_e2`, then pass that string output to `workflowExpected` and `evaluateExpected`; with relevant paths changed, `main` and Immo yield `false`/unselected and accept a skipped job, while E2 yields `true`/selected and rejects a skipped job. With no relevant paths, all three bases yield `false`/unselected.
  - [x] Dry-run receipt: `tmp/engram-e2-selection.test.mjs` (local probe); `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make test-publishable-manifests 'SCOPE=tmp/engram-e2-selection.test.mjs scripts/ci/publishable-ci-wiring.test.mjs scripts/ci/ci-expected-results.test.mjs' ENV=test-e2-int` passed 44/44 (six selection cases plus 38 existing assertions); `make down ENV=test-e2-int` under the same lock removed the disposable project.
- [ ] E0 admission remains blocked until this CI change reaches main, a real integration-target fail/pass bump probe passes, receiving records and Comments deployment separation are confirmed.

## AI Flaky tests
- [x] No AI tests, accepted flakiness or timeout changes in this preparation.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sole integrator for this CI preparation; E-lot topics later target this integration branch and rebase without cherry-picks.
- [ ] Multi-branch implementation is outside this preparation.

## UAT Management (in orchestration context)
- [x] No web, Chrome or VS Code behavior changes; qualify workflow routing, bump comparison and package/storage Make lanes.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read Docker lock, plan §§1/3.1/5/6/7, repository rules and template; create worktree from origin/main.
  - [x] Run mechanical `harness check branch`; inspect Immo Compose runner and existing PG qualification.
  - [x] Verify registry 0.22.0/0.22.1 and 0.23.0 absence; retain #709 closure bytes and ancestry evidence outside the PR.
- [x] **Lot 1 — BR-E2-EX1 CI qualification**
  - [x] Add exact E2 and preserve Immo integration PR bases; compare bump gate to actual PR head/base merge-base.
  - [x] Wire existing build/typecheck/lint/scoped memory/storage tests and real PG through isolated Compose; retain commands, exit codes, inventory, logs and hashes.
  - [x] Keep every existing publish job predicate unchanged; no development version publication.
  - [x] Verify compact/pretty development manifests refuse and the reserved stable manifest passes the publication guard without invoking a publisher.
  - [x] Include existing `scripts/ci/publishable-ci-wiring.test.mjs` assertions through the same disposable Compose runner.
  - [x] Connect E2's scoped change-filter and final `ci-gate`; keep selection compatible with the existing expected-result evaluator.
  - [x] Run `make scope-check ENV=test-e2-int` before each atomic commit below 150 lines.
- [ ] **Lot 2 — PRE-E0 record and final validation**
  - [x] Write root `.tmp/engram-e2-host-tuple/pre-e0-entry.md`, with registry, ancestry, repair/receiving status, Q1 conditions and Comments route.
  - [x] Preserve #709 Lots 2/4/6 succession to E6/E7/E10; retain completed descriptor/Engram pin, keep SQLite qualification separate.
    - [x] Future topics declare E1–E5 generic contracts/atomic/backend/u64/ownership, PG codecs/journal/roots/readers/migrations/instance/transaction/core/scope files, assets and plan §3.2 tests before editing; this preparation changes none.
  - [x] Execute build, typecheck, lint, `tests/engram-memory` (70), common-v1 (10), grants (3), and real PostgreSQL (51) through Make; crash-phase cases stay in the existing main crash lane.
  - [x] Push; open PR #755 to main using this file as body; leave merging to conductor/owner GO.
  - [x] Verify committed-head wiring (38 tests) and E2 CI after correcting fixture environment/lock context: job `121459264616` passed at `50dd8e91c`; final guard probes pass separately.
  - [ ] After owner GO and CI landing, conduct real integration-target unchanged/corrected bump probes before admitting topics; refresh each receipt on head/base changes.
