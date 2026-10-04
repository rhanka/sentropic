# Feature: BR-45b — IdP identity and consent sync with safe failure reporting

## Objective
Synchronize prod identities and explicitly granted consents into preprod through a versioned client map, with PII-free failure reporting and silent synthetic selftests. Users without prod consent must still see the consent screen.

## Scope / Guardrails
- Scope limited to BR-45 identity/consent export, import, orchestration and their selftests.
- Consent semantics and reader column grants are authorized by BR45b-EX1; Kubernetes privileges and workflow triggers stay unchanged.
- Make-only workflow, no direct Docker commands; ZERO Python.
- Failure output carries a fixed code and, for re-key refusals, UUID pairs only; never raw SQL stderr, emails or secrets.
- Root workspace `~/src/sentropic` is reserved for user dev/UAT and must remain stable.
- Branch development happens in isolated worktree `tmp/idp-sync-failure-codes`.
- Automated tests run with `ENV=test-idp-sync-codes`, never on root `dev`; `ENV` is the last make argument.
- Ports (no app stack expected): slot 0 `API_PORT=9230 UI_PORT=5430 MAILDEV_UI_PORT=1330`.
- Commits < 150 lines, `make commit MSG="..."`, selective `git add`, no AI attribution.
- No merge, no deploy: PR only, merge by s-conductor under owner GO.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sh`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/client-map.csv`
  - `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql`
  - `deploy/k8s/overlays/prod/idp-identity-sync/reader-role.sql`
  - `deploy/k8s/overlays/prod/idp-identity-sync/kustomization.yaml`
  - `deploy/k8s/overlays/prod/idp-identity-sync/cronjob.yaml`
  - `deploy/ci/idp-identity-sync/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/**`, `ui/**`, `packages/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/overlays/{prod,preprod}/idp-identity-sync/*.yaml`
- **Exception process**:
  - Declare exception ID `BR45b-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention` context: run 37204934129 failed by design (empty `ALLOWED_REKEY`, re-key guard) but CI only printed `audit unavailable`; `run.selftest.mjs:89` printed an audit-shaped fixture (`rekeyed 0`, `rekey_pairs []`) that was mistaken for a real audit.
- `acknowledge` resolved locally by DEV on 2026-10-04: validated failure codes and UUID-only pairs replace the failed-Job audit fallback; the selftest output probe passes without fixture audits or summaries. Lot 3 remains with the conductor.
- `acknowledge` review follow-up resolved by DEV on 2026-10-04: F1–F4/F6–F9 fixed and tested; F5 retained per conductor decision. Review evidence: `.h2a/inputs/review-br45b.md`.
- BR45b-EX1 — Owner decision "Synchro des consentements" (2026-10-04, `.h2a/inputs/consent_brief.md`): permit consent SQL, six read-only consent column grants and the versioned ConfigMap client map. Include the prod CronJob's checksum/snapshot parsing because its hardcoded three-file manifest cannot transport the new export correctly. Impact: four-file relay and transactional mapped consent convergence; no trusted-client bypass or Kubernetes privilege/trigger change. Rollback: revert the Lot 4 commits.

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
- Rationale: one small hardening change; DEV `gpt-6.1-sol` (high) builds, `gemini-3.8-flash-high` cross-reviews read-only, auth session reviews.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change; acceptance = local gates + CI green.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/idp-sync-failure-codes` from `origin/main` (ade43cc07).
  - [x] Confirm root causes (run 37204934129 log; `run.selftest.mjs:89`).

- [x] **Lot 1 — PII-free failure codes**
  - [x] `import-preprod.sh`: every `fail` writes `{"outcome":"failed","code":"<code>"}` to `/dev/termination-log` (codes: `invalid_dry_run`, `invalid_age_limit`, `invalid_manifest`, `integrity_failed`, `invalid_counts`, `invalid_timestamp`, `stale_snapshot`, `rekey_not_allowed`, `manifest_mismatch`, `empty_export`, `dv5_invariant_changed`, `postcondition_failed`, `lock_timeout`, `sql_error`, `invalid_audit`); SQL failures are classified by matching the known `RAISE EXCEPTION` texts in the private stderr file; for `rekey_not_allowed` add `rejected_rekey_pairs` extracted with a strict UUID>UUID regex; nothing else from stderr is forwarded.
  - [x] `run.mjs` / `run-core.mjs`: on a failed Job, read the termination message, validate it against the failure schema (known code, UUID-only pairs) and print `job/<name> failed: <code>` (+ pairs); keep failing the step.
  - [x] Lot gate:
    - [x] `make test-idp-sync-sql ENV=test-idp-sync-codes`: wrapper cases assert the code for empty allowlist, unknown pair, manifest mismatch, DV5 tamper, checksum tamper and stale snapshot.
    - [x] `make test-idp-sync-selftest ENV=test-idp-sync-codes`: failure-message parsing, unknown code rejected, non-UUID pair rejected.

- [x] **Lot 2 — Silent, unmistakable fixtures**
  - [x] `run.selftest.mjs`: no fixture audit or summary is printed to stdout/stderr; fixture values made visibly synthetic (e.g. `synced_users: 101`, UUIDs `00000000-0000-4000-8000-00000000000x`).
  - [x] Selftest assertion that the selftest's own output contains no line starting with `{"outcome"`.
  - [x] Lot gate: `make test-idp-sync-selftest ENV=test-idp-sync-codes`.
  - [x] Review follow-up: snapshot EOF/CR handling, unset allowlist, pair filtering, final import-container verdict, failure-code coverage and import control flow.

- [ ] **Lot 3 — Final validation**
  - [x] gemini cross-review recorded; auth review.
  - [ ] CI green on the PR.
  - [ ] Remove `BRANCH.md` before merge.

- [ ] **Lot 4 — Consent sync**
  - [x] Grant six consent columns to the reader and export consents in the identity snapshot with its count.
  - [x] Ship the versioned prod-to-preprod client map in the preprod SQL ConfigMap, absent from the relay.
  - [ ] Require four relay files and consent counts; classify consent map and postcondition failures safely.
  - [ ] Transactionally upsert mapped prod consents and remove missing/revoked grants for prod users; retain preprod-only and unmapped grants, clients and signing keys.
  - [ ] Audit changed upserts/removals; unchanged reruns report 0/0.
  - [ ] SQL fixtures cover owner scopes, Farid removal, preserved grants, scope changes, revocation, missing/duplicate map targets, consent rollback, DV5 and reader grants.
  - [ ] Selftest verifies new audit counts/codes, four-file manifest and ConfigMap-only map.
  - [ ] README documents consent semantics, versioned mapping and fail-closed rollout order.
  - [ ] Lot gates: `make test-idp-sync-sql ENV=test-idp-sync-codes` and `make test-idp-sync-selftest ENV=test-idp-sync-codes`.
