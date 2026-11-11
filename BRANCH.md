# Fix: libxslt CVE-2026-87636 / CVE-2026-9947 in ui and e2e container images

## Objective
Pin libxslt 1.1.43-r4 in the ui and e2e Dockerfiles so the security-container-ui and security-container-e2e CI gates pass again.

## Scope / Guardrails
- Scope limited to `e2e/Dockerfile`, `ui/Dockerfile` and this `BRANCH.md`.
- Root-cause fix: Trivy reports FixedVersion 1.1.43-r4 for both HIGH CVEs on 1.1.43-r3 (PR #995 run 42935716970 artifacts); Alpine v3.23 and v3.24 both ship 1.1.43-r4 since 2026-11-10. No vulnerability-register entry needed.
- api and api-tool container scans pass on main (no libxslt in those images); `api/Dockerfile` untouched.
- Make-only workflow; every Docker build via `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make ...`, one slot per command, never nested.
- `ENV=test-cve-libxslt` always last argument; never `ENV=dev`; never `make clean-all`.
- All new text in English. No `[skip ci]` anywhere.
- Commits via `make commit MSG="..."` only, <=150 lines, selective staging.
- Branch `fix/ci-cve-libxslt` from `origin/main` (64274101c), worktree `tmp/worktrees/cve-libxslt`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `e2e/Dockerfile`
  - `ui/Dockerfile`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `.github/workflows/**`
  - `api/Dockerfile` (api container scan is green; libxslt absent from the api image)
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.security/**` (no register entry needed: fixed Alpine package exists)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- None open.
- Local validation 2026-11-11: `test-ui-security-container` PASS (0 HIGH/CRITICAL, image `ghcr.io/rhanka/sentropic-ui:7449e5`); `test-e2e-security-container` PASS (0 HIGH/CRITICAL, image `ghcr.io/rhanka/sentropic-e2e:d13ebc`).

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
- Rationale: single two-file CVE pin fix, one CI run; no sub-workstreams.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI/API behavior change in this lot (Alpine package pin only); no user UAT required. Evidence is the CI security-container gates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/security.md`, `rules/workflow.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Create/confirm isolated worktree `tmp/worktrees/cve-libxslt` on `fix/ci-cve-libxslt` from `origin/main` (64274101c); `harness check branch` PASS.
  - [x] Confirm PR #995 run 42935716970 fact: security-container-ui + security-container-e2e fail on CVE-2026-87636 / CVE-2026-9947 libxslt 1.1.43-r3; security-container-api + api-tool pass.
  - [x] Confirm Trivy FixedVersion 1.1.43-r4 (run artifacts) and Alpine v3.23/v3.24 ship 1.1.43-r4 (pkgs.alpinelinux.org, built 2026-11-10).
  - [x] Environment mapping: `ENV=test-cve-libxslt`, `API_PORT=8941 UI_PORT=5341 MAILDEV_UI_PORT=1241`.
  - [x] Command style: `/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make ... ENV=test-cve-libxslt` with `ENV` last.
  - [x] Confirm scope and guardrails.
- [x] **Lot 1 — Pin libxslt 1.1.43-r4 in ui + e2e Dockerfiles**
  - [x] Edit `e2e/Dockerfile`: add `libxslt=1.1.43-r4` to the apk add list with CVE comment.
  - [x] Edit `ui/Dockerfile` production stage: add `libxslt=1.1.43-r4` to the apk add line with CVE comment.
  - [x] Lot gate:
    - [x] `make scope-check` before commit.
    - [ ] `make commit MSG="fix(security): pin libxslt 1.1.43-r4 in e2e and ui images (...)"` (selective staging, <=150 lines).
- [x] **Lot 2 — Local container-scan validation**
  - [x] Build ui production image + run `test-ui-security-container` via docker-slot.sh in foreground.
  - [x] Build e2e image + run `test-e2e-security-container` via docker-slot.sh in foreground.
  - [x] Record scan outcomes in `## Feedback Loop` if related failures appear.
- [x] **Lot N — PR + CI + cleanup + report**
  - [x] Push branch (`git push origin fix/ci-cve-libxslt`, never `--set-upstream`).
  - [x] Open PR #996 with `BRANCH.md` text as body; security-container-ui and security-container-e2e jobs RAN and pass (api/api-tool pass unchanged).
  - [x] Do NOT merge.
  - [ ] End with `make down-volumes ENV=test-cve-libxslt`.
  - [ ] Write French report to `/home/antoinefa/src/sentropic/.tmp/rv/cve-libxslt.md`.
