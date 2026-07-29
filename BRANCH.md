# Fix: make the CI filter / image-hash invariant executable

## Objective
- [ ] Turn the `ci.yml` comment "Keep `api` and `ui` in sync with the API_VERSION / UI_VERSION content-sha inputs" into an enforced control. The invariant is real and currently HOLDS, but nothing detects a drift, and a drift silently pins a deploy tag that was never built.

## Scope / Guardrails
- [ ] Purely preventive: no filter is changed, because none is wrong today (verified path-by-path).
- [ ] Scope limited to one new script, one additive Makefile target, one CI step.
- [ ] No app code, no migration, no infra, no prod change.
- [ ] Runs inside the existing `changes` job — no extra runner.
- [ ] POSIX awk only (the runner has no gawk 3-arg `match`).
- [ ] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/check-ci-version-filters.sh`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`, `ui/**`, `packages/**`
  - `deploy/k8s/**` (owned by the sibling preprod-postgres branch)
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile` — covered by `BR-INFRA-EX2`
  - `.github/workflows/ci.yml` — covered by `BR-INFRA-EX3`

## Feedback Loop
- `BR-INFRA-EX2` — **Makefile** (default Forbidden Path).
  - Reason: Make-only is mandatory, so the check must be reachable as a target rather than a raw script call in CI.
  - Impact: additive only — one `.PHONY` target, no existing target modified.
  - Rollback: delete the target block.
  - Owner ratification: WP-INFRA scope exception on dedicated branches (2026-07-29).
- `BR-INFRA-EX3` — **.github/workflows/ci.yml** (Conditional Path).
  - Reason: the control has to run in CI to have any effect; it belongs in `changes`, where the filters are declared and which always runs.
  - Impact: one added step in an existing job. No job graph change, no `needs` change, no new runner.
  - Rollback: remove the step.
  - Owner ratification: same exception.
- `clarification` — the inherited brief stated that `packages/comments/src`, and by extension other hash inputs, feed `API_VERSION` without being in the `api` filter. **That is incorrect.** Verified extraction: the `api` filter already lists `packages/comments/**`, and the `ui` filter already lists `packages/chat-ui/**`, `packages/cowork-desktop/**`, `packages/cowork-bridge/**`. All 18 `API_VERSION` inputs and all `UI_VERSION` inputs are covered. PR #470's "already SUPERSET (verified)" claim was right. No filter edit is warranted; only the missing enforcement is delivered here.
- `attention` — the guard is proven by mutation, not by passing: removing `packages/comments/**` from the `api` filter makes it exit 1 on all three comments paths, and restoring it makes it pass. A guard that has never been observed failing is not evidence of anything.

## AI Flaky tests
- Not applicable: no AI-backed test is touched.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one small preventive control. The preprod-postgres fix (PR #471) and the `SECRET_ENCRYPTION_KEY` delivery are separate branches by owner ratification.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change, so no user UAT. Acceptance = the `changes` job runs the check green on this PR.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Extract the 18 `API_VERSION` inputs and the `UI_VERSION` inputs from `Makefile`.
  - [x] Extract the `api`, `ui` and `global` filter blocks from `ci.yml`.
  - [x] Establish that coverage currently HOLDS — correcting the inherited brief.
  - [x] Create isolated worktree `tmp/infra-ci-filters`.
  - [x] Declare `BR-INFRA-EX2` and `BR-INFRA-EX3`.

- [x] **Lot 1 — The guard**
  - [x] Add `scripts/check-ci-version-filters.sh`, POSIX-awk only, treating `global` as coverage for both components (publish is gated on `<component> || global`).
  - [x] Add the `check-ci-version-filters` Makefile target.
  - [x] Wire it as a step of the `changes` job, before `paths-filter`.
  - [x] Lot gate:
    - [x] `make check-ci-version-filters` passes on the current tree.
    - [x] Mutation test: dropping `packages/comments/**` from the `api` filter makes it exit 1 with a `::error::` per uncovered path.
    - [x] Restoring the filter makes it pass again.
    - [x] `ci.yml` still parses as YAML.

- [ ] **Lot N — Docs consolidation**
  - [ ] Confirm the `changes` job runs the step green on this PR.
