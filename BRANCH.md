# Fix: Docker npm audit HIGH vulnerabilities (GHSA-hq66-cqwq-w95j & GHSA-5p4m-2wfm-xmqj)

## Objective
Remediate the four Docker `npm audit` HIGH vulnerability build/typecheck failures in PR #514 CI run 31131336825 (`typecheck-lint-api`, `typecheck-lint-ui`, `build-ui`, `build-api-image`) by updating `officeparser` to `6.0.7` and adding package overrides for `pdfjs-dist` and `js-yaml` in `package.json` and lockfiles.

## Scope / Guardrails
- Scope limited to dependency lockfiles and package declarations for `officeparser`, `pdfjs-dist`, and `js-yaml`.
- No DB migrations or code logic changes.
- Make-only workflow, no direct host commands.
- Root workspace reserved for user dev/UAT.
- Branch development in `tmp/fix-security-docker-npm-audit/`.
- In every `make` command, `ENV=<branch-slug>` passed as the last argument.
- All text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/llm-mesh/**`
  - `api/src/**` (no code changes)
- **Conditional Paths (allowed only with explicit exception)**:
  - None
- **Exception process**:
  - None required.

## Feedback Loop
- `BR-SECURITY-01`: Remediated `GHSA-hq66-cqwq-w95j` (`pdfjs-dist` in `officeparser`) by aligning `officeparser` to `6.0.7` and overriding `pdfjs-dist` to `6.2.108` / `5.5.207`. Remediated `GHSA-5p4m-2wfm-xmqj` (`js-yaml` in `gray-matter`) by overriding `js-yaml` to `3.15.1`.

## AI Flaky tests
- N/A (no AI generation involved).

## Orchestration Mode
- [x] **Mono-branch** — single security remediation stream.

## Plan / Todo

- [x] **Lot 0 — Baseline & evidence validation**
  - [x] Create worktree `tmp/fix-security-docker-npm-audit` on `fix/security-docker-npm-audit` from `origin/main`.
  - [x] Run `harness check branch` (PASS C1).
  - [x] Validate CI run 31131336825 failure logs (`typecheck-lint-api`, `typecheck-lint-ui`, `build-ui`, `build-api-image`).

- [x] **Lot 1 — Security dependency remediation**
  - [x] Pin `officeparser` to `6.0.7` in `api/package.json` and `api/package-lock.json`.
  - [x] Add package overrides for `pdfjs-dist` and `js-yaml` in `package.json` and `api/package.json`.
  - [x] Sync `package-lock.json` and `api/package-lock.json` via `make lock-root`.
  - [x] Verify `npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root` returns 0 HIGH or CRITICAL vulnerabilities.

- [ ] **Lot N — Final validation, PR, CI & Merge**
  - [ ] Run `make scope-check`.
  - [ ] Commit changes atomically using `make commit`.
  - [ ] Push branch to origin.
  - [ ] Open GitHub Pull Request with English `BRANCH.md` body.
  - [ ] Monitor CI gates to green status.
  - [ ] Merge PR into `main`.
