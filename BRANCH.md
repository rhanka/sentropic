# Feature: APP-837-REBASE — rebase PR #837 onto main (replay 7)

## Objective
- [x] Rebase `feat/app-cm-integration` (PR #837) conflict-free onto `origin/main` per fast-track plan r2 lot APP-837-REBASE (Wave 0) and COMMON-RULES (`git rebase origin/main`, then `--force-with-lease` on this PR branch only).
- [x] Keep the schema/migration delta minimal (reserved `0020` control slot plus its journal entry) so APP-837-DUMP can regenerate the clean schema dump after A2-M0-MIG repairs `0007`–`0011`.
- [ ] One CI run on the final head; PR stays open; merge belongs to APP-837-MERGE.

## Scope / Guardrails
- [x] Worktree `tmp/pr-837`; branch `feat/app-cm-integration`; replayed from head `10d289560` (base `d08517ed1`) onto main `1b7f8ab94`; replay 7.
- [x] Make-only; Docker serialized under `.tmp/packets/DOCKER-LOCK.md` (plus the legacy `/home/antoinefa/.cache-tmp/sentropic-docker.lock`); `ENV=test-app-837-rebase` always last; `make down` after campaigns.
- [x] Local acceptance gates pass before the single push; zero WIP pushes; Post-Rebase Gate re-verified (no package source or manifest difference from main).
- [x] Atomic commits below 150 changed lines via `make commit`; selective staging; English only.
- [x] No production activation, Python, AI trailers or destructive cleanup; no draft-state change; this author does not merge.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `.dockerignore`
  - `.github/workflows/**`
  - `Makefile`
  - `api/**`
  - `apps/**`
  - `deploy/**`
  - `docs/**`
  - `package-lock.json`
  - `scripts/**`
  - `spec/**`
  - `track/TRACK.md`
  - `packages/cluster-mesh/tests/packaging/activation-environment.ts`
  - `packages/cluster-mesh/tests/packaging/activation-vectors.spec.ts`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `packages/**` except the two activation test paths allowed by BR143-EX3
  - `plan/**`
  - `ui/**`
  - `e2e/**`
  - `.cursor/rules/**`
  - `.track/**`
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- [x] **Exception process**: BR143-EX1 covers the completed inherited merge only; BR143-EX2 covers topic workflow retirement and equivalent CI gates; BR143-EX3 covers the two activation test paths under `packages/**`. This lot adds no new exception.

## Feedback Loop
- [x] PR837-R7-1: rebase onto `origin/main 1b7f8ab94`. Conflicts at the initial plan patch (branch plan intent kept) and at `702185813` (canonical API image). The Makefile version-input block union retains main's `scripts/ci/locked-tools.mjs` and `scripts/ci/tool-locks.json` inputs, main's `chat-core` and `e2e/npm-toolchain` UI/E2E inputs, and adds `apps/artifact-content`; `ci.yml` keeps main's `scripts/ci/tool-locks.json` path filter plus `apps/artifact-content/**`; `api/Dockerfile` retains main's `npx --no-install` and locked-npm lines plus the artifact-content COPY/esbuild/dist lines; `.dockerignore` unions both sides. Lockfiles merge additively: main's pins retained, `file:../packages/artifacts` workspace link retained, no registry fallback. `BRANCH.md` ends deleted as at the pre-rebase head; this file re-adds the lot scope contract, and APP-837-MERGE branch-close removes it again on the final head.
- [x] PR837-R7-2: drizzle delta vs main verified exactly `A api/drizzle/control/0020_app_artifact_host.sql` plus one `_journal.json` entry (`0020_app_artifact_host`, idx 11, when 1791860000001; `0012_decision_host` bumped to idx 12). No stale schema dump hunks; APP-837-DUMP regenerates the restore smoke dump with zero drift after A2-M0-MIG.

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
- Rationale: single existing PR branch; one rebase, one final local gate cycle, one CI run on the final head.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- This lot changes no UI behavior (rebase plus docs); UAT belongs to the integration gates already recorded on PR #837.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/pr-837` on `feat/app-cm-integration`; `.env` copied; `harness check branch` C1 PASS.
  - [x] Capture pre-replay-7 references: net diff vs main (140 files), PR body, journal delta, prior replay evidence.
- [x] **Lot 1 — Rebase onto origin/main (replay 7)**
  - [x] `git rebase origin/main`; resolve the two conflict stops (see PR837-R7-1).
  - [x] Verify the net file set is identical to the pre-rebase PR (140 files) and every union keeps main's authority.
  - [x] Post-Rebase Gate: no `packages/*/src/**` or `packages/*/package.json` difference from main, so no registry/version comparison is required.
- [x] **Lot 2 — Stale schema dump strip verification**
  - [x] Drizzle delta is exactly the reserved `0020` slot plus its journal entry (see PR837-R7-2).
- [ ] **Lot 3 — Replay 7 patch-equivalence evidence**
  - [x] `git range-diff --no-color d08517ed1..10d289560 1b7f8ab94..<head>`: 190 equal / 1 changed / 1 old-only / 1 new-only.
  - [x] Extend `docs/runbooks/app-cm-integration-review.md` with the replay 7 row and publish the full output from the PR.
  - [ ] Update the PR body N5 record to the exact final head and its completed/success CI run.
- [ ] **Lot 4 — Local acceptance gates (ENV=test-app-837-rebase)**
  - [ ] `make typecheck-auth-hono ENV=test-app-837-rebase`
  - [ ] `make test-auth-hono ENV=test-app-837-rebase`
  - [ ] `make test-auth-ui ENV=test-app-837-rebase`
  - [ ] `make scope-check`
  - [ ] `make down ENV=test-app-837-rebase`
- [ ] **Lot 5 — Single push and CI**
  - [ ] `git push --force-with-lease origin feat/app-cm-integration` exactly once, after Lot 4 is green.
  - [ ] One CI run on the final head, completed/success including the gates named by the review (endpoints shard 2, chat lanes, security-container, validate-artifacts, validate-idp-sync, ci-gate).
