# Fix: UI image HIGH/CRITICAL advisories and audit integrity

## Objective
Reduce measured HIGH/CRITICAL findings in the production UI image and make API SCA/container audits fail closed on missing or empty scanner reports.

## Scope / Guardrails
- Scope limited to the UI production image, UI dependencies, vulnerability records, and security audit tooling.
- Make-only and Docker-first workflow; no native npm, Node, or Docker commands.
- Work only on `fix/ui-image-security-highcrit` in `/home/antoinefa/src/sentropic/tmp/ui-sec`.
- Automated checks use `ENV=test-ui-sec` with API `9325`, UI `5525`, and MailDev UI `1425`; `ENV` is always the last Make argument.
- No merge; owner GO is required.
- All new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `ui/Dockerfile`
  - `ui/package.json`
  - `package-lock.json`
  - `.security/**`
  - `scripts/security/**`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/cluster-mesh/**`
  - `api/src/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile`
  - `.github/workflows/**`
- **Exception process**:
  - Declare `BR74-EXn` in `## Feedback Loop` before touching a conditional path, including reason, impact, and rollback.

## Feedback Loop
- [x] `BR74-EX1 attention` — `Makefile` is required because the existing SCA/container recipes intentionally discard scanner failures and synthesize an empty successful report. Impact: only security targets change to preserve scanner exit/report integrity. Rollback: revert the target-only hunk.

## AI Flaky tests
- [x] No AI-dependent checks are in scope.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**
- [ ] **Multi-branch**
- Rationale: one tightly coupled image-and-audit correction with a single final scan cycle.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `rules/security.md`, `rules/workflow.md`, and `plan/BRANCH_TEMPLATE.md`.
  - [x] Confirm isolated checkout and branch mechanically with `harness check branch`.
  - [x] Map UI/API SCA and container targets, parsers, register, and CI artifact flow.
  - [x] Build the current UI image and save the raw baseline UI container report.
  - [x] Record the actual UI image count: 0 HIGH / 0 CRITICAL from a non-empty 162,503-byte Trivy 0.74.0 report.
  - [x] Record API baseline: SCA raw report 25,635 bytes with 2 HIGH / 0 CRITICAL was overwritten to zero; container raw report was empty after an image-not-found error and passed.
- [ ] **Lot 1 — UI image remediation**
  - [x] Update the UI builder/runtime bases to exact Node 24/Alpine 3.24 and Nginx 1.31.5/Alpine 3.24 digests.
  - [x] Upgrade no UI dependency: workspace-scoped UI SCA measured 0 HIGH / 0 CRITICAL.
  - [x] Bump `sentropic-ui` from `0.1.0` to `0.1.1`.
  - [ ] Add only exact, bounded, expiring register entries for irreducible findings.
  - [ ] Rebuild and rescan the UI image; record raw after report and counts.
- [ ] **Lot 2 — Audit fail-closed repair**
  - [ ] Remove empty-report-as-green behavior from API SCA/container targets.
  - [x] Add focused parser verification for empty, malformed, synthetic-empty, npm-audit, and Trivy reports (`make test-security-parser`: PASS).
  - [ ] Prove API SCA/container audits execute and produce non-empty reports.
- [ ] **Lot 3 — Final validation and PR**
  - [ ] Run `make typecheck-ui` with isolated ports/environment.
  - [ ] Run `make lint-ui` with isolated ports/environment.
  - [ ] Run `make build-ui-image` with isolated ports/environment.
  - [ ] Run the final UI image and API SCA/container audits.
  - [ ] Run `make scope-check` before every atomic commit.
  - [ ] Push `fix/ui-image-security-highcrit` and create the requested PR against `main`.
  - [ ] Stop before merge.
