# Feature: Zero-Python Repository Guard (SJ-0s)

## Objective
Add the `make check-no-python` zero-Python repository guard, its empty allowlist (`scripts/no-python-allowlist.json`), its `node --test` suite, and its CI gate in `.github/workflows/ci.yml` (engram `plan/10-BRANCH_MEMORY_SESSION_JOURNAL.md` Row 14, `SJ-0s`).

## Scope / Guardrails
- Scope limited to `Makefile`, `scripts/check-no-python.mjs`, `scripts/no-python-allowlist.json`, `scripts/check-no-python.test.mjs`, `.github/workflows/ci.yml`, and `BRANCH.md`.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/sj0s-no-python` on `feat/sj0s-no-python-guard` (base `origin/main` `e201ed96f40631c56ec1e6473a4d766ac17910fe`).
- Dedicated test environment `ENV=test-cluster-mesh` passed as last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/check-no-python.mjs`
  - `scripts/no-python-allowlist.json`
  - `scripts/check-no-python.test.mjs`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `api/drizzle/*.sql`
- **Exception process**:
  - `BR10-EX1` (specification name `BRSJ-EX1` at SJ:647) declared in `## Feedback Loop` for `Makefile` and `.github/workflows/ci.yml`.

## Feedback Loop
- `acknowledge`: `BR10-EX1` (`BRSJ-EX1`, SJ:647) — scope exception for `Makefile` (default-forbidden) and `.github/workflows/ci.yml` (conditional).
  - Rationale: Row 14 (`SJ-0s`) requires one new `check-no-python` target in root `Makefile` running `node --test scripts/check-no-python.test.mjs && node scripts/check-no-python.mjs` inside the existing Node container (`$(LLM_MESH_NODE_IMAGE)`), plus wiring `make check-no-python ENV=test-ci-manifests` into `validate-publishable-manifests` in `.github/workflows/ci.yml`.
  - Impact: Adds one `.PHONY: check-no-python` target in `Makefile` with zero changes to existing targets, recipes, or container images; adds one step in `.github/workflows/ci.yml` (`validate-publishable-manifests`). Allowlist `scripts/no-python-allowlist.json` is empty (`[]` — verified 0 files matching `*.py`, `pyproject.toml`, or `requirements*.txt` on `origin/main` `e201ed96f4`), so no script, workflow, or test executes any allowlisted entry.
  - Rollback: Revert the lot commit(s) removing `check-no-python` from `Makefile`, the step from `.github/workflows/ci.yml`, and the three new files under `scripts/`.

## AI Flaky tests
- None (deterministic `node --test` and static file inventory checks only).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single isolated worktree `tmp/sj0s-no-python` for Row 14)
- Rationale: Single-lot guard addition with 6 scoped files and no cross-branch concurrency.

## UAT Management (in orchestration context)
- Not applicable (CI/build guard only; no UI/API runtime surface changes).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, and `plan/10-BRANCH_MEMORY_SESSION_JOURNAL.md` Row 14.
  - [x] Create isolated worktree `tmp/sj0s-no-python` at `feat/sj0s-no-python-guard` from `origin/main` (`e201ed96f4`).
  - [x] Verify disk space >= 20 GiB free on worktree, `TMPDIR`, and Docker root (66 GiB free recorded).
  - [x] Confirm allowlist is empty (`0` files matching `*.py`, `pyproject.toml`, `requirements*.txt` on `origin/main`).
  - [x] Declare `BR10-EX1` (`BRSJ-EX1`) in `BRANCH.md`.
- [x] **Lot 1 — No-Python guard (`SJ-0s`)**
  - [x] RED t1: through `make check-no-python`, a tree with `*.py`, `pyproject.toml`, or `requirements*.txt` outside the allowlist fails and names the path.
  - [x] RED t2: through `make check-no-python`, the repository as it is passes.
  - [x] Implement `scripts/no-python-allowlist.json`, `scripts/check-no-python.mjs`, `Makefile` `check-no-python` target, and `.github/workflows/ci.yml` step.
  - [x] Lot gate: `make scope-check ENV=test-cluster-mesh && make check-no-python ENV=test-cluster-mesh`.
- [ ] **Lot 2 — Final validation**
  - [x] Verify CI wiring tests (`make test-publishable-manifests ENV=test-cluster-mesh`).
  - [ ] Final gate step 1: create PR with title `feat(ci): no-Python guard (SJ-0s, engram plan/10 row 14)` and `BRANCH.md` + evidence.
  - [ ] Final gate step 2: monitor `gh pr checks <n> --watch` until green.
  - [ ] Final gate step 3: leave PR open (no merge, no publish); write report and `.done` marker.
