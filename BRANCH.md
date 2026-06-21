# Feature: Focus-M1 L2 — bind `packages/focus` to the real `@sentropic/track/read`

## Objective
Bind the private `packages/focus` render-core to the REAL `@sentropic/track` read API so it produces a `DecisionDossierDocument` from a real decision, replacing L1's local `DecisionDossierViewFixture` type with the versioned `@sentropic/track/read` contract.

## Scope / Guardrails
- Scope limited to `packages/focus/**`, plus three declared conditional-path exceptions (`Makefile`, `.github/workflows/ci.yml`, `package-lock.json`).
- No new `api/drizzle/*.sql` migration.
- Make-only workflow, no direct Docker commands.
- Root workspace `/home/antoinefa/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable; never run the dev/up stack here.
- Branch development happens in isolated worktree `tmp/focus-track-read`.
- No service stack starts in this branch (pure-TS package gates only): no ports needed.
- In every `make` command, `ENV=<env>` is passed as the last argument when relevant.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/focus/**`
  - `BRANCH.md`
  - `spec/SPEC_VOL_FOCUS.md`
- **Forbidden Paths (must not change in this branch)**:
  - any OTHER package under `packages/**`
  - `api/**`, `ui/**`, `apps/**`
  - any track-WRITE / ingest path (L4)
  - cerclage / live / diagram-adapter / mdast core
  - publishing focus (stays private) and the publish-bootstrap list
  - `docker-compose*.yml`, `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with the declared exception)**:
  - `Makefile` — `BR-FOCUS-EX (Makefile)`
  - `.github/workflows/ci.yml` — `BR-FOCUS-EX (ci.yml)`
  - `package-lock.json` — `BR-FOCUS-EX (lock)`
- **Exception process**:
  - Each `BR-FOCUS-EX` is declared in `## Feedback Loop` with reason, impact, and rollback before touching the path.

## Feedback Loop
- `BR-FOCUS-EX (lock)` — `acknowledge`:
  - Path: `package-lock.json`.
  - Reason: focus gains its first real runtime dep `@sentropic/track`; the workspace member needs the root lock entry so `npm ci` can resolve it (and its transitive deps) into `node_modules/@sentropic/track`.
  - Impact: root lockfile gains the `@sentropic/track` tree; no other package affected.
  - Rollback: revert `package.json` dep + regenerated `package-lock.json`.
- `BR-FOCUS-EX (Makefile)` — `acknowledge`:
  - Path: `Makefile` (`typecheck-focus` / `test-focus` / `build-focus` / `pack-focus` + `install-internal-packages`).
  - Reason: focus gains its first real runtime dep (`@sentropic/track`), so it must build via the WORKSPACE `node_modules` (the `install-internal-packages` + `npx --offline tsc/vitest` pattern used by chat-core/comments), NOT the isolated zero-dep temp-toolset L1 shipped — the temp-toolset cannot resolve `@sentropic/track` and its transitive deps.
  - Impact: the four `*-focus` targets migrate to the dep-aware pattern; `install-internal-packages` adds the `packages/focus` workspace so the lock entry is installed.
  - Rollback: revert the four targets to the isolated temp-toolset form and drop the `--workspace=packages/focus` flag.
- `BR-FOCUS-EX (ci.yml)` — `acknowledge`:
  - Path: `.github/workflows/ci.yml`.
  - Reason: focus needs a `validate-focus` CI gate (mirroring `validate-comments` / `validate-harness`) plus a `focus` change-output and path-filter; focus is PRIVATE so there is NO `focus_publish` output and NO publish job.
  - Impact: a new change-output, a new path-filter, and a new `validate-focus` job. No publish path, no publish-bootstrap entry.
  - Rollback: revert the three additions in `ci.yml`.

## AI Flaky tests
- Not applicable (pure-TS package; no AI/provider calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal lot; one final gate cycle)
- [ ] **Multi-branch**
- Rationale: one orthogonal lot (the track read binding); no independent sub-CI needed.

## UAT Management (in orchestration context)
- No UI surface in this lot. Gates = `make typecheck-focus test-focus build-focus pack-focus`. No user UAT required at L2; the first usable end-to-end dogfood is L3 (`stp focus`).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/{workflow,MASTER,subagents,testing}.md`, `spec/SPEC_VOL_FOCUS.md`, the L1 `packages/focus/**`, and the dep-aware Makefile/ci.yml exemplars.
  - [x] Confirm isolated worktree `tmp/focus-track-read` on branch `feat/focus-track-read`.
  - [x] Confirm `@sentropic/track` is an EXTERNAL npm dep (no local `packages/track`) → the workspace `node_modules` pattern (not the isolated temp-toolset) is required.
  - [x] Declare the three `BR-FOCUS-EX` exceptions above.

- [x] **Lot 1 — Dep + lockfile + Makefile workspace migration**
  - [x] Add `"@sentropic/track": "^0.17.0"` to `packages/focus/package.json` dependencies.
  - [x] Regenerate the root lockfile via `make lock-root`; commit `package-lock.json`.
  - [x] Migrate the four `*-focus` Makefile targets to the dep-aware workspace pattern (mount `$(CURDIR):/workspace`, `npx --offline tsc`/`vitest`); add `packages/focus` to `install-internal-packages`.
  - [x] Lot gate: `make install-internal-packages` then confirm `node_modules/@sentropic/track/read` resolves; inspect the installed `/read` `.d.ts` for the exact export names.

- [x] **Lot 2 — The `/track` read binding + corrected mapper**
  - [x] Add `packages/focus/src/track/` binding importing from the versioned `@sentropic/track/read` (gate on `reader.contractVersion`).
  - [x] Replace L1's local `DecisionDossierViewFixture` type + mapper with the REAL `@sentropic/track/read` types; map `canevas(workspace, { baselineCommit, decisionId }).dossier` → `DecisionDossierDocument`.
  - [x] Apply the corrected shapes: `DecisionDossierView{id,title,workspace,outcome,dossier}`; `Outcome`; `Dossier`; nested `ComprehensionEvidence` under `dossier.artifacts[] (kind:'h2a-decision-dossier').comprehension`; `amendmentTrace(id)` ordering; attester≠relayer invariant.
  - [x] Lot gate: `make typecheck-focus`.

- [x] **Lot 3 — Fixtures + tests + spec sync**
  - [x] Add a real `.track/events.jsonl` fixture the `TrackReader` reads to yield a `DecisionDossierView` (≥1 `h2a-decision-dossier` artifact + comprehension + an amendment step).
  - [x] Extend `packages/focus/tests/` to assert the binding maps a REAL `canevas(...).dossier` → `DecisionDossierDocument` with the corrected shapes, comprehension nesting, attester≠relayer invariant, amendmentTrace ordering; keep the L1 renderer tests green.
  - [x] Sync `spec/SPEC_VOL_FOCUS.md` §4b with the real `@sentropic/track/read` contract.
  - [x] Lot gate: `make test-focus`.

- [x] **Lot 4 — validate-focus CI job + final gates**
  - [x] Add a `focus` change-output, a `focus` path-filter, and a `validate-focus` job to `ci.yml` (mirror `validate-comments`/`validate-harness`; NO publish).
  - [x] Bump `packages/focus/package.json` version (enforce-package-bump applies even for private packages).
  - [x] Final gate: `make typecheck-focus test-focus build-focus pack-focus` — all GREEN.
  - [x] Push `feat/focus-track-read` (conductor opens the PR).

## Deferred
- L3 `stp focus` federated subcommand (read → render terminal/md/html).
- L4 the one write (`ratifyOutcome` / `amendSpec` via `@sentropic/track/ingest`).
