# Feature: cyber-act-L05 immutable main image cohort, trusted acquisition, isolated rebuild, report transfer

## Objective
Implement r6 wave W2 lot ACT-L05: exact main image cohort, trusted remote acquisition, isolated rebuild and report transfer, with receipt validation in the existing daily adapter seams (acceptance L5-A–E).

## Scope / Guardrails
- Scope limited to `scripts/security/daily/**` target-custody / rebuild-isolation / report-transfer / trivy adapter seams plus the `test-security-daily` SCOPE wiring.
- One migration max in `api/drizzle/*.sql` (if applicable).
- Make-only workflow, no direct Docker commands (Docker only under the shared flock in `.tmp/packets/DOCKER-LOCK.md`).
- Root workspace is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/cyber-act-L05`.
- Automated test campaigns run on dedicated environments (`ENV=test-cyber-L05`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English. Zero Python. No secret values read, printed or committed.
- No schedule enablement, no seat operation, no live provider/registry call, no other lot touched.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/target-custody.mjs`
  - `scripts/security/daily/target-custody.test.mjs`
  - `scripts/security/daily/rebuild-isolation.mjs`
  - `scripts/security/daily/rebuild-isolation.test.mjs`
  - `scripts/security/daily/report-transfer.mjs`
  - `scripts/security/daily/report-transfer.test.mjs`
  - `scripts/security/daily/trivy.test.mjs`
  - `scripts/security/daily/acceptance-disposition.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `Makefile` (BR05-EX1: one-line SCOPE extension of `test-security-daily`)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BRLOCK-EX1` acknowledgement: review_by=2026-11-30T00:00:00Z (CI lockfile lane policy, owner CI maintainers).
- `BR05-EX1`: extend `Makefile` `test-security-daily` SCOPE with the two new r4 Lot-5 required destinations (`target-custody.test.mjs`, `rebuild-isolation.test.mjs`).
  - Reason: r4 Lot 5 names `target-custody.test.mjs` and `rebuild-isolation.test.mjs` as required test files; r6 §7.3/§6.4 requires every file/case wired into its owning required Make suite, and `publishable-ci-wiring.test.mjs` fails if an on-disk daily test is not in the SCOPE.
  - Impact: one SCOPE line gains two files, all existing entries unchanged.
  - Rollback: revert the SCOPE line; the new suites still run standalone via `node --test`.

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
- Rationale: single lot ACT-L05, one review-ready head, one CI run.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read r6 §7.2 row ACT-L05, §7.3, §7.4, §8 A5 and r4 Lot 5 (L5-A–E, test destinations).
  - [x] Verify amendment sha256 `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
  - [x] Create worktree `tmp/worktrees/cyber-act-L05` on branch `feat/cyber-act-L05` from `origin/main`; `harness check branch` PASS C1.
  - [x] Confirm ENV `test-cyber-L05` (ports API_PORT=8815 UI_PORT=5215 MAILDEV_UI_PORT=1115 if a stack is ever started; tests here are compose-free).
  - [x] Confirm scope boundaries and BR05-EX1 before touching the Makefile.
- [ ] **Lot 1 — Tests first (L5-A–E)**
  - [ ] `target-custody.test.mjs` — L5-A cohort identity negatives/positives, L5-B acquisition boundary.
  - [ ] `rebuild-isolation.test.mjs` — L5-C isolated rebuild plan and receipt validation.
  - [ ] Extend `report-transfer.test.mjs` — L5-D hostile transfer negatives, L5-E budget/storage-independence.
  - [ ] Extend `trivy.test.mjs` — cohort at the adapter seam (`validateTarget`/`prepareImageScan` per surface).
  - [ ] Extend `acceptance-disposition.mjs` — L05_ACCEPTANCE rows; validate in `target-custody.test.mjs`.
  - [ ] Wire both new test files into `Makefile` `test-security-daily` SCOPE (BR05-EX1).
  - [ ] Local gate: `flock .tmp/packets/DOCKER-LOCK.md make test-security-daily ENV=test-cyber-L05` green, then `make down ENV=test-cyber-L05`; `make scope-check` PASS C2.
- [ ] **Lot 2 — Implementation**
  - [ ] `target-custody.mjs`, `rebuild-isolation.mjs`, `report-transfer.mjs` extensions.
  - [ ] Re-run the full daily suite under the flock; `make down ENV=test-cyber-L05`.
- [ ] **Lot 3 — Final validation**
  - [ ] `make scope-check` PASS C2 on the final tree.
  - [ ] Atomic `make commit` per logical change (≤150 lines), push branch (crash-safety copy).
  - [ ] Open draft PR (body = this BRANCH.md), run ONE CI on the final head, wait for completion.
  - [ ] Write `.tmp/rv/cyber-act-L05.md`; do not merge.
