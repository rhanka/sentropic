# Feature: Focus-M1 L3 — `stp focus <decision-id>` read-only dogfood

## Objective
Add the first usable end-to-end Focus dogfood: a `./cli` subpath on the private `packages/focus` that renders a real track decision dossier read-only (terminal / MD / HTML), and wire it into the `stp` umbrella CLI as a conditional in-repo `focus` subcommand (federation manifest left cross-repo-only).

## Scope / Guardrails
- Scope limited to `packages/focus/**`, the `stp` focus wire in `packages/cli/**`, and `spec/SPEC_VOL_FOCUS.md`.
- No migration files (no `api/`).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/focus-cli-readonly`.
- Read-only: NO track write, NO new track event, NO publish of focus.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/focus/**`
  - `spec/SPEC_VOL_FOCUS.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/cli/src/federation.ts` `FEDERATION_MANIFEST` (cross-repo-only, test-locked)
  - any track-WRITE / ingest path; any new track event; cerclage / live / diagram-adapter / mdast core
  - any OTHER package
- **Conditional Paths (allowed only with declared `BR-FOCUS-EXn`)**:
  - `packages/cli/bin/stp.mjs` (the `tryRegisterFocus` wire) — `BR-FOCUS-EX1`
  - `packages/cli/src/**` (the factored `tryRegisterFocus` helper only) — `BR-FOCUS-EX1`
  - `packages/cli/package.json` (additive version bump) — `BR-FOCUS-EX1`
  - `packages/cli/tests/**` (the helper test) — `BR-FOCUS-EX1`
  - `package-lock.json` (version-bump lock refresh via `make lock-root`) — `BR-FOCUS-EX2` (APPLIED)
- **Exception process**:
  - Declare `BR-FOCUS-EXn` in `## Feedback Loop` with reason, impact, rollback.

## Feedback Loop
- `BR-FOCUS-EX1` — `acknowledge` (conductor-authorized in the L3 launch packet): the `stp focus` federation wire is L3's deliverable. Touch `packages/cli/bin/stp.mjs` (call a `tryRegisterFocus` helper after `app` registration, before `loadFederatedSubcommands`), factor that helper into `packages/cli/src/focus.ts` (mirrors `federation.ts` injectable-importer pattern → testable), export it from `packages/cli/src/index.ts`, add `packages/cli/tests/focus.spec.ts`, and bump `packages/cli/package.json` version (additive: `stp` gains a subcommand). Impact: additive only — no existing behavior changes; `FEDERATION_MANIFEST` untouched. Rollback: revert the cli commit; `stp` loses only the in-repo `focus` wire.
- `BR-FOCUS-EX2` — `acknowledge` (APPLIED): `make lock-root` run because the version bumps (focus 0.2.0→0.3.0, cli 0.3.1→0.4.0) made the lockfile workspace `version` fields stale (`npm ci` would fail "out of sync"). Diff is version-only (2 lines: focus + cli versions) — no dependency change. Rollback: revert the lock line.

## AI Flaky tests
- None — focus + cli tests are pure/deterministic (no AI, no network).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal lot; one final gate cycle)
- [ ] **Multi-branch**
- Rationale: a single orthogonal deliverable (the CLI read-only surface + its wire); no independent CI sub-streams.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI surface — gates are the focus + cli make checks. Conductor opens the PR.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/{workflow,MASTER,subagents,testing}.md`, `spec/SPEC_VOL_FOCUS.md`, `packages/focus/**`, `packages/cli/{bin/stp.mjs,src/federation.ts,tests/federation.spec.ts}`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/focus-cli-readonly` from `origin/main`; verify branch.
  - [x] Capture make targets: `typecheck-focus test-focus build-focus pack-focus install-internal-packages`, `typecheck-cli test-cli build-cli pack-cli`, `lock-root`.
  - [x] Confirm scope + declare `BR-FOCUS-EX1`/`BR-FOCUS-EX2`.

- [x] **Lot 1 — focus `./cli` + exports + bump**
  - [x] Add `packages/focus/src/cli/index.ts` exporting `{ run, version }` (version = focus package version).
  - [x] `run` parses `stp focus <decision-id> [--format terminal|md|html] [--workspace <ws>] [--baseline-commit <sha>] [--events-path <path>]`; defaults `--events-path=.track/events.jsonl`, `--format=terminal`; clear error on missing decision-id / unknown decision / contract mismatch.
  - [x] Flow: `readDecisionDossier(eventsPath, query, readAt)` → renderer for chosen format → stdout; exit 0 success, non-zero + stderr on error. Read-only.
  - [x] Add `./cli` subpath to `packages/focus/package.json` exports; bump focus version (additive minor → 0.3.0).
  - [x] Lot gate: `make typecheck-focus build-focus pack-focus ENV=focus-cli-l3` — GREEN (dist/cli ships in tarball).

- [x] **Lot 2 — `stp focus` wire + cli bump + helper test**
  - [x] Factor `tryRegisterFocus(registry, deps?)` into `packages/cli/src/focus.ts` (injectable importer + error sink; ABSENCE_CODES mirror; `{run,version}` shape check; register name `focus`).
  - [x] Export it from `packages/cli/src/index.ts`; call it in `packages/cli/bin/stp.mjs` after `app`/`surface`, before `loadFederatedSubcommands`.
  - [x] Add `packages/cli/tests/focus.spec.ts` (9 tests): absent-code → skipped; broken/bad-shape/null → throws; registration-fail → throws; valid → registered.
  - [x] Did NOT touch `FEDERATION_MANIFEST`. Bumped `packages/cli/package.json` 0.3.1 → 0.4.0 (additive).
  - [x] Lot gate: `make typecheck-cli test-cli build-cli pack-cli ENV=test-focus-cli-l3` — GREEN (72 cli tests pass; federation.spec.ts 16 unchanged-green; dist/focus.js ships).

- [x] **Lot 3 — focus cli specs + spec sync**
  - [x] Add `packages/focus/tests/cli.spec.ts` (8 tests): run `./cli`'s `run([...])` against the L2 `.track` fixture for each `--format`; assert exit 0 + output contains the decision title/outcome; assert non-zero + message on missing/unknown decision-id, missing --workspace, unknown --format.
  - [x] Update `spec/SPEC_VOL_FOCUS.md` §4b: marked L3 SHIPPED with the CLI surface + the DECIDED federation mechanism (Option B conditional-bin-wire; manifest cross-repo-only) + consensus note + review-log entry.
  - [x] Lot gate: `make test-focus ENV=test-focus-cli-l3` — GREEN (38 tests).

- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-focus test-focus build-focus pack-focus ENV=test-focus-cli-l3`
  - [ ] `make typecheck-cli test-cli build-cli pack-cli ENV=test-focus-cli-l3`
  - [ ] Confirm `packages/cli/tests/federation.spec.ts` still green (manifest length 6, no in-repo entries).
  - [x] Bumped `packages/focus/package.json` (0.3.0) + `packages/cli/package.json` (0.4.0); `make lock-root` to refresh.
  - [ ] Push `feat/focus-cli-readonly`. Conductor opens the PR.
