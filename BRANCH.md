# Fix: Clear dependency audit HIGH advisories

## Objective
Clear the repo-wide npm audit gate with compatible dependency updates so API typechecking reaches TypeScript and exits successfully.

## Scope / Guardrails
- Scope limited to Tiptap, xmldom, and js-yaml dependency metadata plus the security exception files if no compatible patch exists.
- Use compatible same-major releases; allowlist only when no non-breaking patched release is available.
- Do not change package versions for the root, UI, or API applications.
- Make-only and Docker-first workflow in `tmp/fix-deps-audit` with `ENV=test-deps-audit` last.
- Do not push or open a pull request.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `ui/package.json`
  - `.security/audit-allowlist.json`
  - `.security/vulnerability-register.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/cluster-mesh/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Declare a `BRDA-EXn` item in `## Feedback Loop` before touching a forbidden path.

## Feedback Loop
- [x] No exception is required for the scoped dependency and lockfile changes.

## AI Flaky tests
- [x] N/A; the required audit, typecheck, and dependency-focused test gates are deterministic.

## Orchestration Mode
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] One focused dependency-security correction with one final verification cycle.

## Plan / Todo
- [x] **Lot 0 — Reproduce and triage**
  - [x] Verify `fix/deps-audit-gate` mechanically with `harness check branch`.
  - [x] Reproduce the audit-gate failure for the three advisory groups.
  - [x] Confirm patched same-major releases and inspect in-repo API usage.
- [x] **Lot 1 — Compatible dependency remediation**
  - [x] Align the Tiptap runtime set on a patched 3.x release.
  - [x] Update xmldom to patched 0.9.x resolutions.
  - [x] Update the js-yaml overrides to patched 3.15.x resolutions.
  - [x] Regenerate the root workspace lockfile through the Make/Docker lane.
  - [x] Confirm no new allowlist or vulnerability-register entry is required.
- [x] **Lot 2 — Verification and handoff**
  - [x] Pass the exact audit-gate command.
  - [x] Pass API typechecking through `tsc --noEmit`.
  - [x] Pass focused runtime dependency tests and UI typechecking for Tiptap.
  - [x] Pass `make scope-check ENV=test-deps-audit` before each commit.
  - [x] Commit atomically with selective staging and no attribution trailer.
  - [x] Confirm the branch is not pushed and no pull request was opened.
