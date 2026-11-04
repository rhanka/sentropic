# Feature: Disk hygiene make targets

## Objective
Add reviewed make targets for Docker builder-cache and worktree hygiene so lanes reclaim disk without host sudo or raw docker.

## Scope / Guardrails
- Scope limited to additive Makefile targets, one self-test script, and this BRANCH.md.
- Make-only workflow, no direct Docker commands in the lane; Docker runs inside make recipes or via docker-slot.sh.
- No ENV=dev; validation uses dry-runs and ENV=test-* only; the lane ends with nothing running (no stack started).
- Never [skip ci]; CI budget: one run on the final head; never gh run rerun (fresh pull_request run via a new commit instead).
- Never merge main into this branch; updates go through git rebase origin/main plus push --force-with-lease on this branch only.
- No Python anywhere (Node/TS and native binaries only).
- All new text in English.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `Makefile` (DH01-EX1, additive disk-hygiene targets only)
  - `scripts/check-disk-hygiene.sh` (DH01-EX1, self-test for the new targets)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (touched only under DH01-EX1 below; no existing recipe changed)
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**`, `ui/**`, `e2e/**`, `apps/**`, `deploy/**`
  - `packages/**`
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `DHxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- DH01-EX1 (Makefile scope exception, conductor-requested 2026-11-04): the host disk is at 98% and the Docker builder cache grew by 7.3G in 20 minutes because of our lanes. The conductor orders four additive make targets: `docker-builder-prune` (`docker builder prune -f --keep-storage <N>`, default 5GB via `DOCKER_BUILDER_KEEP`), `disk-hygiene ENV=<env>` (`down-volumes` then `docker-builder-prune`), `worktrees-prune-merged` (remove merged tmp/worktrees, root-owned/dirty skipped, `DRY_RUN=1` default, never `--force`), and `worktrees-purge-root-residue` (container-as-root deletion of root-owned leftovers of merged or half-removed tmp/worktrees, `DRY_RUN=1` default, skips unmerged worktrees plus main-ro). Impact: five new Makefile targets plus one new script; no existing recipe, compose file, workflow, or package version touched. Rollback: revert the Makefile hunks and delete `scripts/check-disk-hygiene.sh`.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- No AI tests in scope for this branch (no AI code touched).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single small branch, single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: four additive targets plus one script by one author; no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI surface changes; UAT = target dry-runs plus self-test on a test ENV. No browser UAT.
- Execution flow (mandatory):
  - Develop and run tests in `tmp/worktrees/disk-hygiene`.
  - Push branch before CI.
  - No root-workspace UAT needed (no app surface changed).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create isolated worktree `tmp/worktrees/disk-hygiene` on branch `chore/disk-hygiene-targets` from `origin/main`.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last; Docker through make targets or `docker-slot.sh` (one slot per command, never nested).
  - [x] Confirm scope boundaries and declare DH01-EX1 before touching `Makefile`.
  - [x] Environment mapping: no stack needed; validation with dry-runs and `ENV=test-disk-hygiene` (LAST); never `ENV=dev`.
- [x] **Lot 1 — Builder-cache targets**
  - [x] Add `DOCKER_BUILDER_KEEP ?= 5GB` plus `docker-builder-prune` (`docker builder prune -f --keep-storage "$(DOCKER_BUILDER_KEEP)"`).
  - [x] Add `disk-hygiene` running `down-volumes ENV=<env>` then `docker-builder-prune`.
  - [x] Lot gate: `make -n docker-builder-prune` shows keep-storage 5GB; override `DOCKER_BUILDER_KEEP=10GB` shows 10GB; `make -n disk-hygiene ENV=test-disk-hygiene` wires both steps; `ENV=dev` refused by the inherited guard.
- [x] **Lot 2 — Worktree targets**
  - [x] Add `worktrees-prune-merged` (merged-into-origin/main only; skips root-owned via `find -user root` and dirty via `status --porcelain`; `git worktree remove` without `--force`; then `git worktree prune`; summary of removed/skipped; `DRY_RUN=1` default).
  - [x] Add `worktrees-purge-root-residue` (only under `tmp/worktrees/`; skips worktrees whose HEAD is NOT merged plus main-ro; container-as-root `rm` following the `clean-node-modules` mount pattern, no host sudo; `DRY_RUN=1` default listing deletions; document `DRY_RUN=0` run).
  - [x] Lot gate: dry-run default removes nothing; root-owned and unmerged fixtures are skipped with reasons.
- [x] **Lot 3 — Self-test + scope**
  - [x] Add `scripts/check-disk-hygiene.sh` plus `check-disk-hygiene` target covering the dry run and the root-owned skip.
  - [x] Lot gate: `make check-disk-hygiene` green; `make scope-check` PASS C2 before every commit.
- [ ] **Lot 4 — PR + single CI + report**
  - [ ] Atomic commits via `make commit MSG="..."` (specific `git add` only, `BRANCH.md` checkboxes updated in the same commits); no AI trailers; no `[skip ci]`.
  - [ ] Push `chore/disk-hygiene-targets`; open exactly one READY PR (body = this BRANCH.md); do NOT merge.
  - [ ] Run one CI on the final head; if only the AI shards fail, retrigger with an empty commit, up to 3 times.
  - [ ] Report every step and the CI run id to `.tmp/rv/disk-hygiene.md` (root workspace).
