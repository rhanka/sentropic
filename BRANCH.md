# Feature: Focus-M1 L1 — focus render-core (private @sentropic/focus)

## Objective
Create the PRIVATE `packages/focus` render-core: the concrete `DecisionDossierDocument` model plus the terminal, MD and HTML (mandatory) renderers, driven by a `DecisionDossierView` fixture. Read-only FocusSnapshot; markdown injected by the host; no track dependency (that is L2).

## Scope / Guardrails
- Scope limited to `packages/focus/**` plus four additive `*-focus` Makefile targets (BR-FOCUS-EX1).
- No `api/drizzle/*.sql` migration (not applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/focus-render-core`.
- Pure-TS tooling-only package: no services, no ports, no `ENV` needed for the gates.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/focus/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `.github/workflows/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - any other package
  - any `@sentropic/track` or `@sentropic/cli` dependency
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (only the four additive `*-focus` targets under BR-FOCUS-EX1)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR-FOCUS-EX1` `acknowledge` (conductor-approved): path `Makefile`; reason: a new Docker-first pure-TS package needs build/test entry points mirroring `@sentropic/harness`; impact: four additive targets (`typecheck-focus`, `test-focus`, `build-focus`, `pack-focus`), no existing target changed; rollback: delete the four targets.
- `BR-FOCUS-EX2` `acknowledge` (conductor-approved): path `package-lock.json`; reason: `packages/focus` is a `workspaces: ["packages/*"]` member, so the root lock MUST list it or the CI `install-internal-packages` gate fails lock-sync (6 jobs failed on PR #344 for exactly this); impact: +242 generated lines (the focus workspace entry + its dev toolset tree), regenerated via `make lock-root` (`--package-lock-only`, no node_modules install); rollback: revert the lockfile hunk.

## AI Flaky tests
- None (no AI tests in scope).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one orthogonal lot (L1), no independent CI needed; the conductor integrates.

## UAT Management (in orchestration context)
- No UI surface in L1; no UAT. Gates are checks only.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant rules files and `spec/SPEC_VOL_FOCUS.md`.
  - [x] Create isolated worktree `tmp/focus-render-core` and verify the branch.
  - [x] Capture Makefile targets needed for checks (mirror `@sentropic/harness`).
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries and declare `BR-FOCUS-EX1` for the Makefile targets.

- [x] **Lot 1 — Private `packages/focus` render-core**
  - [x] `packages/focus/package.json` (private, MIT, type module, mirror harness devDeps).
  - [x] `packages/focus/tsconfig.json` (mirror harness).
  - [x] `packages/focus/src/model.ts` — concrete `DecisionDossierDocument` + node families.
  - [x] `packages/focus/src/render/hooks.ts` — host markdown-injection + sanitize hooks.
  - [x] `packages/focus/src/render/terminal.ts` — terminal renderer.
  - [x] `packages/focus/src/render/md.ts` — MD renderer (fenced-diagram fallback).
  - [x] `packages/focus/src/render/html.ts` — HTML renderer (mandatory; injection + sanitize).
  - [x] `packages/focus/src/fixture.ts` — local `DecisionDossierView` fixture type + mapper.
  - [x] `packages/focus/src/index.ts` — public barrel.
  - [x] `packages/focus/tests/fixture.data.ts` — hand-authored fixture.
  - [x] `packages/focus/tests/render.spec.ts` — pure unit specs (terminal/MD/HTML, trace, affordances, diagram fallback).
  - [x] `packages/focus/README.md` + `LICENSE`.
  - [x] Add the four `*-focus` Makefile targets under BR-FOCUS-EX1.
  - [x] Lot gate:
    - [x] `make typecheck-focus`
    - [x] `make test-focus`
    - [x] `make build-focus`
    - [x] `make pack-focus`

- [x] **Lot N — Final validation**
  - [x] Typecheck (`make typecheck-focus`).
  - [x] Specs (`make test-focus`).
  - [x] Build (`make build-focus`).
  - [x] Pack dry-run (`make pack-focus`).
  - [x] `packages/focus` is `"private": true` (publish jobs skip; enforce-package-bump still applies → version 0.1.0).
  - [ ] Conductor opens the PR using this file as the PR body.
