# Feature: BR-45c — IdP identity sync: consent map and export-count hardening

## Objective
Close the four minor cross-review findings left after BR-45b (PR #641): one-to-one client map, no shell in map loading, consent count in the prod export verdict, empty-map test.

## Scope / Guardrails
- Scope limited to the BR-45 identity sync import/export scripts and their tests.
- No schema change, no new grant, no workflow trigger change, no Kubernetes privilege change.
- Make-only workflow, no direct Docker commands; ZERO Python.
- Failure output stays PII-free (fixed codes only).
- Branch development happens in isolated worktree `tmp/idp-sync-consent-hardening`.
- Automated tests run with `ENV=test-idp-sync-hardening`, last make argument; never `ENV=dev`.
- Ports (no app stack expected): slot 0 `API_PORT=9235 UI_PORT=5435 MAILDEV_UI_PORT=1335`.
- Commits < 150 lines, `make commit MSG="..."`, selective `git add`, no AI attribution.
- No merge, no deploy: PR only, merge by s-conductor under owner GO.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/ci/idp-identity-sync/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sh`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`
  - `deploy/k8s/overlays/prod/idp-identity-sync/cronjob.yaml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `packages/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/overlays/{prod,preprod}/idp-identity-sync/{access,kustomization}.yaml`
- **Exception process**:
  - Declare exception ID `BR45c-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention` rollout: the prod export termination payload now requires the consent count; the export CronJob (bundle-prod on push) and `run-core.mjs` (main checkout) change together at merge; an older payload fails closed and the exporter is still re-suspended.
- `acknowledge` a missing map file is a file-loading error (`sql_error`); an empty, invalid or non one-to-one map is `consent_client_missing`.

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
- Rationale: single follow-up commit built by DEV `gpt-6.1-sol` (high) on the BR-45b branch, reviewed by `gemini-3.8-flash-high` findings, cherry-picked onto `origin/main` by the auth session.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change; acceptance = local gates + CI green.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/idp-sync-consent-hardening` from `origin/main`; cherry-pick of `79d0377d1` as `4deae1881` (BRANCH.md of BR-45b dropped).

- [x] **Lot 1 — Consent hardening**
  - [x] F1: client map loaded with a plain client-side `\copy` from `/sql/client-map.csv` (no `FROM PROGRAM`); missing file fails closed.
  - [x] F2: two prod clients mapped to the same preprod client rejected (`consent_client_missing`).
  - [x] F3: prod export stdout and termination JSON include the consent count; `run-core.mjs` validates it (counts only).
  - [x] F4: empty map fails closed.
  - [x] Lot gate:
    - [x] `make test-idp-sync-sql ENV=test-idp-sync-hardening`: 54 PASS, exit 0.
    - [x] `make test-idp-sync-selftest ENV=test-idp-sync-hardening`: 43 PASS, 0 failures.

- [ ] **Lot 2 — Final validation**
  - [ ] CI green on the PR.
  - [ ] Remove `BRANCH.md` before merge.
