# Feature: Fix live provider select ENOBUFS

## Objective
- [ ] Fix `select` ENOBUFS by bounding every `gh api` call with `--jq` projection, `per_page` and explicit `maxBuffer`, with explicit route+size errors.

## Scope / Guardrails
- [ ] Worktree `tmp/worktrees/fix-live-provider-enobufs` on branch `fix/live-provider-select-enobufs` from `origin/main`.
- [ ] ENV `test-live-provider-enobufs` last in every `make` command; ports API_PORT=8895 UI_PORT=5295 MAILDEV_UI_PORT=1195.
- [ ] Docker only via `.tmp/packets/docker-slot.sh make ...`; never ENV=dev; never `make clean-all`; no Python.
- [ ] Commits via `make commit MSG="..."` only; no attribution trailer; max 150 lines per commit.
- [ ] Generic fix only; no dual path; no weakening of `schedule-health` or any gate.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `scripts/ci/live-provider-receipt.mjs`
  - `scripts/ci/live-provider-receipt.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `api/drizzle/*.sql`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] ENOBUFS-1: `select` fails with `Error: spawnSync gh ENOBUFS` at `live-provider-receipt.mjs:103` on route `repos/rhanka/sentropic/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=100&page=1` (run 42474921060, job 128713986254): confirmed from job log plus raw size ~117KB per 10 runs.
- [x] BR01-EX1: touch `.github/workflows/ci.yml` (`global` paths-filter only): add `scripts/ci/live-provider-receipt.mjs` and `scripts/ci/live-provider-receipt.test.mjs`. Rationale: any `scripts/**` change classifies as `root-lock-toolchain`, whose `consumer-contracts-verify` gate requires the six integration lanes, but those lanes only run when `api`, `ui` or `global` matches; without this, a `scripts/ci`-only PR can never go green (run 42548638007: `consumer-contracts` + `ci-gate` failure). Impact: strictly more CI for these two paths (full integration), same family as `image-receipt`/`compatibility-classifier` already listed; no gate, threshold or assertion loosened. Rollback: remove the two lines; dispatch returns to `manifest_guard`-only.
- [x] ARGON-1: PR #970 Argon review REQUEST_CHANGES (BLOCKER `pages()` double `[key]` fails `select` 100%; MAJOR missing `select`/`health` CLI e2e against stubbed `gh`; MINOR hardcoded `100` vs `GH_PER_PAGE` + checkbox coherence). Addressed in Lot 3.
- [x] BR01-EX1b: run 42552089131 `validate-publishable-manifests` pins the exact `global` scripts list (`publishable-ci-wiring.test.mjs:144`); the two deliberate BR01-EX1 additions are added to the pin. The pin stays an exact match (any other unlisted addition still fails): evolution of the intended contract, not a loosening.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams need independent CI or long-running validation)
- Rationale: single small CI fix, one branch, one CI.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI change in this branch: no UAT surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Create worktree `tmp/worktrees/fix-live-provider-enobufs` on branch `fix/live-provider-select-enobufs` from `origin/main`.
  - [x] Verify branch with `git -C tmp/worktrees/fix-live-provider-enobufs branch --show-current`.
  - [x] Write `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm root cause from job log 128713986254 plus `live-provider-receipt.mjs:103` default 1 MiB `maxBuffer`.
  - [x] Confirm `make` targets: `test-ci-live-provider-receipt`, `ci-live-provider-select`, `ci-live-provider-health`.
  - [x] Define environment mapping (`test-live-provider-enobufs`) and ports (API 8895, UI 5295, Maildev 1195).
  - [x] Confirm command style: `.tmp/packets/docker-slot.sh make ... ENV=test-live-provider-enobufs` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.
- [ ] **Lot 1 — Bound every gh call plus regression test**
  - [x] Replace bare `execFileSync('gh', ['api', route])` with bounded helper (`--jq` projection, `per_page`, explicit `maxBuffer`, explicit route+size error on overflow).
  - [x] Apply helper to `select` runs, jobs, artifacts, pull-request runs, `health` and `finish` schedule routes.
  - [x] Keep `scheduleHealth`, `qualifiedMain`, `liveReceipt`, `readPages` gates byte-identical in behavior.
  - [x] Add unit test in `scripts/ci/live-provider-receipt.test.mjs`: large response handled/reported (overflow becomes explicit route+size error; projections bound size).
  - [ ] Lot gate:
    - [ ] `make typecheck-<ui/api>` + `make lint-<ui/api>` if impacted (Node script only: at least `node --check` equivalent via test target).
    - [ ] **API tests**
      - [ ] No API change: none.
    - [ ] **UI tests (TypeScript only)**
      - [ ] No UI change: none.
    - [ ] **E2E tests**
      - [ ] No E2E change: none.
    - [ ] Scoped gate: `.tmp/packets/docker-slot.sh make test-ci-live-provider-receipt ENV=test-live-provider-enobufs`.
- [ ] **Lot 2 — Dispatch fix plus final validation**
  - [x] Add `live-provider-receipt` files to the `global` paths-filter under BR01-EX1 (conditional path with rationale, impact, rollback).
  - [x] Retest scoped: `.tmp/packets/docker-slot.sh make test-ci-live-provider-receipt ENV=test-live-provider-enobufs` (14/14).
  - [x] Retest scoped: `test-ci-compatibility` (20/20), `test-ci-consumer-contracts` (25/25, classifier and gate untouched in behavior).
  - [x] Local verify simulation: `consumer-contracts --verify` ok:true with `global=true`, reproduces the CI failure with `manifest_guard`-only.
  - [x] Push 2044ede94, update PR body with `BRANCH.md` (PR #970, no merge).
  - [x] Iterate new-head CI to green (no rerun, no skip): run 42554897053 success on head a57246c82; PR MERGEABLE/CLEAN.
  - [ ] Do NOT merge.
  - [x] Write French report to `.tmp/rv/fix-live-provider-enobufs.md`.
- [ ] **Lot 3 — Argon review fixes (BLOCKER + MAJOR + MINORs)**
  - [x] Fix `pages()` double `[key]` indexation (BLOCKER) and use `GH_PER_PAGE` in `readPages` (MINOR).
  - [x] Add CLI `select` + `health` end-to-end test against stubbed `gh` (MAJOR): `--jq`, pagination runs/jobs/artifacts to `selection.json`, explicit overflow error.
  - [x] Fix `BRANCH.md` checkbox coherence (MINOR).
  - [x] Retest scoped: `test-ci-live-provider-receipt` (15/15) via `node --test`.
  - [x] Retest scoped via `make`: `test-ci-live-provider-receipt` (15/15), `test-ci-compatibility` (20/20), `test-ci-consumer-contracts` (25/25), `test-publishable-manifests` (137/137), `scope-check` PASS C2.
  - [ ] Commit via `make commit`, push, CI green (no rerun, no skip).
  - [ ] Update `.tmp/rv/fix-live-provider-enobufs.md`.
  - [ ] Do NOT merge.
