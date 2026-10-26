# Feature: Fix CI gateway mesh range wait

## Objective
Fix `wait-llm-gateway-mesh-dependency` so a semver range dependency resolves before publishing llm-gateway.

## Scope / Guardrails
- Scope limited to registry wait for gateway mesh dependency.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/worktrees/ci-gateway-wait` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/publishable-pack.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BR01-EX1: touch conditional `Makefile` target `wait-llm-gateway-mesh-dependency` only. Reason: the target strips one leading `^` and passes a broken `@sentropic/llm-mesh@0.27.0 || ^0.28.0` spec, so `publish-llm-gateway` can never observe the range. Impact: one recipe line plus pinned `semver` tool setup; no other target changed. Rollback: restore the single recipe line from `origin/main`.
- [ ] CI run for PR: pending.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: Single CI fix with one test cycle.

## UAT Management (in orchestration context)
- [x] No UI change; no UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read packet, `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `DOCKER-LOCK.md`, `harness-using-harness`, `durable-test-collateral`.
  - [x] Create worktree `tmp/worktrees/ci-gateway-wait` on `origin/main` as `fix/ci-gateway-mesh-range-wait`.
  - [x] Confirm scope and declare `BRCGW-EX1` before touching `Makefile`.
- [x] **Lot 1 — Range-aware wait**
  - [x] Extend `scripts/ci/publishable-manifests.mjs` wait to resolve a full semver range against fresh packuments.
  - [x] Pass the full declared requirement from `wait-llm-gateway-mesh-dependency` (no caret stripping).
  - [x] Add maintained tests: single caret, `||` range, unsatisfiable range.
  - [x] Lot gate:
    - [x] `make test-publishable-manifests ENV=test-ci-gateway-wait` (88 pass).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [ ] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
