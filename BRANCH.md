# Feature: UI SvelteKit SCA remediation

## Objective
Clear the `security-code-ui (sca)` HIGH finding on `@sveltejs/kit` (`npm_audit_ui_@sveltejs_kit_high`) by bumping the UI kit dependency to a fixed 2.x release.

## Scope / Guardrails
- Scope limited to `ui/package.json` + `ui/package-lock.json` (dependency bump only).
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/fix-ui-kit-sca`.
- Test campaigns on `ENV=test-ui-kit-sca`, never on root dev.
- In every `make` command, `ENV=<env>` passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `ui/package.json`
  - `ui/package-lock.json`
  - `package-lock.json` (root workspace lock line for the same kit entry)
  - `.security/vulnerability-register.yaml` (time-boxed acceptance for the kit-3-only advisories)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- [x] `acknowledge`: finding reproduced from PR #1044 CI — `security-code-ui (sca)` fails repo-wide on the current UI lock (kit 2.60.1); dependabot major bump to 3.1.1 exists but a fixed 2.x keeps this remediation non-breaking.

## AI Flaky tests
- [ ] No flaky accepted without same-commit success + sign-off.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single dependency bump, one test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one package bump, no orthogonal sub-workstreams.

## UAT Management (in orchestration context)
- [ ] No UI behavior change expected; UAT on the integrated branch if CI asks for it.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Create isolated worktree `tmp/fix-ui-kit-sca` on `fix/ui-sveltekit-sca` from `origin/main`.
  - [x] Confirm scope and guardrails.
- [x] **Lot 1 — Kit bump**
  - [x] Bump `@sveltejs/kit` to the latest fixed 2.x via the make install target.
  - [x] Add the time-boxed register acceptance for the kit-3-only advisories (the remaining HIGH is fixed only by the kit 3 major line).
  - [x] UI security SCA gate green (`make test-ui-security-sca ENV=test-ui-kit-sca`).
- [ ] **Lot 2 — Publication**
  - [ ] Scope-check, commit, push, open PR.
