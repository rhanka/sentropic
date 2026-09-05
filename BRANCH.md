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
- [x] **Lot 1 — UI image remediation**
  - [x] Update the UI builder/runtime bases to exact Node 24/Alpine 3.24 and Nginx 1.31.5/Alpine 3.24 digests.
  - [x] Upgrade no UI dependency: workspace-scoped UI SCA measured 0 HIGH / 0 CRITICAL.
  - [x] Bump `sentropic-ui` from `0.1.0` to `0.1.1`.
  - [x] Add exact API SCA entries for irreducible image-size/pptxgenjs findings, expiring 2026-10-05.
  - [x] Rebuild and rescan `local/sentropic-ui:21ba45`: non-empty 162,381-byte Trivy 0.74.0 report, 0 HIGH / 0 CRITICAL.
- [x] **Lot 2 — Audit fail-closed repair**
  - [x] Remove empty-report-as-green behavior, scope SCA to the named workspace, and scan both actual images with Trivy.
  - [x] Add focused parser verification for empty, malformed, synthetic-empty, npm-audit, and Trivy reports (`make test-security-parser`: PASS).
  - [x] Prove API SCA/container audits execute: SCA is 7,462 bytes with 2 HIGH / 0 CRITICAL; container is 748,780 bytes with 10 HIGH / 0 CRITICAL.
- [ ] **Lot 3 — Final validation and PR**
  - [x] Run `make typecheck-ui` with isolated ports/environment (0 errors, 6 existing warnings).
  - [x] Run `make lint-ui` with isolated ports/environment.
  - [x] Run `make build-ui-image` with isolated ports/environment.
  - [x] Run the final UI image and API SCA/container audits.
  - [x] Run `make scope-check` before every atomic commit.
  - [ ] Push `fix/ui-image-security-highcrit` and create the requested PR against `main`.
  - [x] Stop before merge.

## Measured security outcome

The trusted baseline was already clean at the requested severity: the original production UI image had no HIGH or CRITICAL Trivy findings. This branch therefore preserves the measured count while moving both build stages to current, immutable patched bases and making the audit path fail closed.

| Production UI image audit | Before (`local/sentropic-ui:cc0860`) | After (`local/sentropic-ui:21ba45`) |
| --- | ---: | ---: |
| HIGH | 0 | 0 |
| CRITICAL | 0 | 0 |
| HIGH + CRITICAL | 0 | 0 |
| Raw Trivy report | 162,503 bytes | 162,381 bytes |

The actual HIGH/CRITICAL list is empty before and after. Both reports are complete Trivy 0.74.0 image reports, not synthesized empty results.

## Upgrades

- UI builder: floating `node:24-alpine` to `node:24-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf`.
- UI runtime: floating `nginx:1.29-alpine` to `nginx:1.31.5-alpine3.24@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3`.
- UI package version: `0.1.0` to `0.1.1`, including the root lockfile workspace version.
- UI dependencies: no upgrade was warranted; the workspace-scoped UI SCA report measured 0 HIGH / 0 CRITICAL.

## Register-deferred findings

| Audit | Exact finding(s) | Disposition | Review due |
| --- | --- | --- | --- |
| API SCA | `image-size@1.2.1`, propagated `pptxgenjs@4.0.1` | No patched release; unreachable image parser chain; temporary exact exception | 2026-10-05 |
| API image | `CVE-2026-14456` in `libcrypto3` and `libssl3` 3.5.7-r0 (fixed 3.5.8-r0) | Separate API-image base refresh required | 2026-09-12 |
| API image | `CVE-2026-13149`, `CVE-2026-14257`, `CVE-2026-69152` in npm-bundled `brace-expansion@5.0.6` | Separate API-image npm bundle refresh required | 2026-09-12 |
| API image | `CVE-2026-69192` in npm-bundled `ip-address@10.2.0` (fixed 10.3.1) | Separate API-image npm bundle refresh required | 2026-09-12 |
| API image | `CVE-2026-9496` in npm-bundled `pacote@21.5.0` (fixed 21.5.1) | Separate API-image npm bundle refresh required | 2026-09-12 |
| API image | `CVE-2026-12151` in npm-bundled `undici@6.26.0` (fixed 6.27.0) | Separate API-image npm bundle refresh required | 2026-09-12 |
| API image | `CVE-2025-71329`, `CVE-2025-71330` in `image-size@1.2.1` | No patched release; same unreachable parser chain; temporary exact exception | 2026-10-05 |

Every entry records scanner/version, installed version, embedded path, image digest where applicable, owner, rationale, fix goal, and expiry. The compliance gate rejects missing, non-exact, or expired entries.

## API audit restoration

| Audit | Before | After |
| --- | --- | --- |
| API SCA | Scanner returned a 25,635-byte report with 2 HIGH / 0 CRITICAL, but parsing overwrote it to zero and passed | 7,462-byte workspace report; 2 HIGH / 0 CRITICAL preserved and reconciled with exact entries expiring 2026-10-05 |
| API container | Image-not-found produced a 0-byte report that passed | Actual production image scanned by Trivy; 748,780-byte report with 10 HIGH / 0 CRITICAL, all explicit and expiring |

## Verification

- `make test-security-parser`: pass; empty, malformed, and synthetic-empty reports are rejected, while real npm/Trivy schemas retain findings.
- `make typecheck-ui`: pass with 0 errors and 6 existing warnings.
- `make lint-ui`: pass.
- `make build-ui-image`: pass with a fresh no-cache production build.
- UI SCA/container audits: pass with non-empty reports and 0 HIGH / 0 CRITICAL.
- API SCA/container audits: run to completion with non-empty reports and the findings above.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
https://claude.ai/code/session_0131Z8YVBEhYXvxGHb7oFcpm
