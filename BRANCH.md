# Feature: Official Google G logo on IdP sign-in

## Objective
Render the official multicolor Google "G" logo in AuthProviderGlyph for the google provider.

## Scope / Guardrails
- Scope limited to google glyph in packages/auth-ui, its tests, version bump, report.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/auth-ui/src/components/AuthProviderGlyph.svelte`
  - `packages/auth-ui/tests/**`
  - `packages/auth-ui/package.json`
  - `package-lock.json` (version-sync fallout of the mandatory package bump only)
  - `BRANCH.md` (plan tracker, updated within each commit)
  - `.h2a/build/google_logo_report.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- None.

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
- Rationale: Small single-file UI fix with one package test cycle.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules/MASTER.md, rules/workflow.md, rules/subagents.md, rules/testing.md, rules/security.md.
  - [x] Worktree tmp/worktrees/auth-google-logo on branch fix/auth-google-official-logo verified.
  - [x] Env mapping: API_PORT=9590 UI_PORT=5790 MAILDEV_UI_PORT=1690 ENV=test-auth-google-logo.
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Confirm scope: AuthProviderGlyph google glyph + design-system sweep + version bump.
  - [x] Design-system sweep: no packages/*design-system* in repo; external @sentropic/design-system-svelte only; no other Google glyph found.
- [x] **Lot 1 — Official multicolor Google G**
  - [x] Replace monochrome google path in AuthProviderGlyph.svelte with official 4-color inline SVG (no currentColor, no external fetch).
  - [x] Keep other providers monochrome; keep accessible label and data-provider wiring.
  - [x] Add packages/auth-ui/tests/google-glyph.test.ts asserting 4 official fills and no currentColor on google svg.
  - [x] Lot gate:
    - [x] `make typecheck-auth-ui ENV=test-auth-google-logo`
    - [ ] **API tests**
      - [ ] None (no API change).
    - [x] **UI tests (TypeScript only)**
      - [x] Existing: packages/auth-ui/tests/federation.test.ts (unchanged).
      - [x] New: packages/auth-ui/tests/google-glyph.test.ts.
      - [x] Scoped runs: `make test-auth-ui SCOPE=tests/google-glyph.test.ts ENV=test-auth-google-logo`
      - [x] Sub-lot gate: `make test-auth-ui ENV=test-auth-google-logo`
    - [ ] **E2E tests**
      - [ ] None (static SVG asset change; no flow change).
    - [ ] UAT: open IdP login with google provider in light and dark themes, verify multicolor G on white/neutral button.
- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Write .h2a/build/google_logo_report.md with screenshot description (untracked).
- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest UI (cf Lot1, copy checklist)
  - [ ] Retest API (cf Lot1, copy checklist)
  - [ ] Retest e2e (cf lots e2e_groups like in Lot1)
  - [ ] Retest AI flaky tests (non-blocking only under acceptance rule) and document pass/fail signatures in `BRANCH.md`
  - [ ] Record explicit user sign-off if any AI flaky test is accepted
  - [x] Bumped affected `packages/<pkg>/package.json` version (semver) for every package whose `src/**` changed in this branch — enforced by CI `enforce-package-bump`. See `rules/workflow.md → Package Publication`.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge.
