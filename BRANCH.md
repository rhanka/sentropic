# Feature: Reject AI attribution trailers in commits and PR text

## Objective

Enforce the owner’s attribution policy on pull requests after the November 21 history cleanup.

## Scope / Guardrails

- Work in `tmp/no-coauthor-trailer` on `ci/no-coauthor-trailer`.
- Use Make targets with `ENV` last. Scope verification uses `test-trailer-ci` with ports 9202, 5402, and 1302.
- The repository owner controls whether the new check is required in branch protection.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/no-coauthor-trailer.yml`
  - `.github/workflows/ci.yml`
- **Exception process**:
  - See `BR9000-EX1` and `BR9000-EX2` in the Feedback Loop.

## Feedback Loop

- [x] BR9000-EX1 — Add `.github/workflows/no-coauthor-trailer.yml` to enforce the owner’s policy using the shared scanner pinned to a full commit SHA. Impact: the standalone check runs on PR opening, updates, edits, and reopening, with read access to contents. Rollback: revert the workflow addition.
- [x] BR9000-EX2 — Add the new workflow path to the `global` filter in `.github/workflows/ci.yml` because the compatibility classifier requires integration tests for workflow changes. Impact: a change to the guard selects the same validation lanes as other global CI changes. Rollback: revert the filter entry when removing the guard or changing its compatibility classification.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch** — One workflow change in a dedicated worktree.

## Plan / Todo (lot-based)

- [x] **Lot 0 — Confirm scope**
  - [x] Verify the branch with the harness and document the workflow exception.
- [x] **Lot 1 — Add the PR check**
  - [x] Pin the shared scanner from `rhanka/h2a` and enable PR text checks.
  - [x] Use a separate workflow because `ci-gate` aggregates jobs in `ci.yml`.
  - [x] Select the integration lanes required by the compatibility classifier for changes to the guard.
- [x] **Lot 2 — Validate initial rollout**
  - [x] Run `make scope-check` with the dedicated environment and ports before committing.
  - [x] Verify the attribution scanner and `ci-gate` on the initial PR head `0ac460a1025c2896800ab996932cae2646afc8d9`.
- [ ] **Lot 3 — Address Neon review**
  - [x] Pin the corrected scanner and grant only contents read access.
  - [ ] Record the checks for the exact post-review head in the delivery report.
