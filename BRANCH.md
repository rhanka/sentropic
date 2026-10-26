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
  - [x] Impact: additional PR qualification and artifact retention only; preserve all main-only publish event/ref predicates and forbid publishing development versions.
  - [x] Rollback: remove only the E2 branch trigger and E2-specific runner wiring, preserve Immo/main gates, and suspend E2 topic merges until equivalent checks are restored.
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
- [ ] **Lot 1 — BR-E2-EX1 CI qualification**
  - [x] Add exact E2 and preserve Immo integration PR bases; compare bump gate to actual PR head/base merge-base.
  - [x] Wire existing build/typecheck/lint/scoped memory/storage tests and real PG through isolated Compose; retain commands, exit codes, inventory, logs and hashes.
  - [x] Keep every existing publish job predicate unchanged; no development version publication.
  - [ ] Run `make scope-check ENV=test-e2-int` before each atomic commit below 150 lines.
- [ ] **Lot 2 — PRE-E0 record and final validation**
  - [ ] Write root `.tmp/engram-e2-host-tuple/pre-e0-entry.md`, with registry, ancestry, repair/receiving status, Q1 conditions and Comments route.
  - [ ] Preserve #709 Lots 2/4/6 succession to E6/E7/E10; retain completed descriptor/Engram pin, keep SQLite qualification separate.
  - [ ] Execute build, typecheck, lint, `tests/engram-memory`, `tests/storage/common-rule`, `scope-grant-modules`, and `tests/storage/postgres-` through Make.
  - [ ] Push; open PR to main using this file as body; record exact head and CI URL without merging.
  - [ ] After owner GO and CI landing, conduct real integration-target unchanged/corrected bump probes before admitting topics; refresh each receipt on head/base changes.
