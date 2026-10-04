# Feature: BR-45b — IdP identity sync: PII-free failure codes and silent selftest fixtures

## Objective
Make a failed preprod import self-explaining in CI (PII-free failure code in the termination message, printed by the run workflow) and stop the selftest from printing audit-shaped fixtures that can be mistaken for a real audit.

## Scope / Guardrails
- Scope limited to the BR-45 identity sync wrapper, run orchestration and their selftests.
- No change to `import-preprod.sql` semantics, to the Kubernetes objects' privileges, or to the workflow triggers.
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
  - `deploy/ci/idp-identity-sync/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`
  - `api/**`, `ui/**`, `packages/**`
  - `plan/NN-BRANCH_*.md`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `deploy/k8s/overlays/{prod,preprod}/idp-identity-sync/*.yaml`
- **Exception process**:
  - Declare exception ID `BR45b-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention` context: run 37204934129 failed by design (empty `ALLOWED_REKEY`, re-key guard) but CI only printed `audit unavailable`; `run.selftest.mjs:89` printed an audit-shaped fixture (`rekeyed 0`, `rekey_pairs []`) that was mistaken for a real audit.

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
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/idp-sync-failure-codes` from `origin/main` (ade43cc07).
  - [x] Confirm root causes (run 37204934129 log; `run.selftest.mjs:89`).

- [ ] **Lot 1 — PII-free failure codes**
  - [ ] `import-preprod.sh`: every `fail` writes `{"outcome":"failed","code":"<code>"}` to `/dev/termination-log` (codes: `invalid_dry_run`, `invalid_age_limit`, `invalid_manifest`, `integrity_failed`, `invalid_counts`, `invalid_timestamp`, `stale_snapshot`, `rekey_not_allowed`, `manifest_mismatch`, `empty_export`, `dv5_invariant_changed`, `postcondition_failed`, `lock_timeout`, `sql_error`, `invalid_audit`); SQL failures are classified by matching the known `RAISE EXCEPTION` texts in the private stderr file; for `rekey_not_allowed` add `rejected_rekey_pairs` extracted with a strict UUID>UUID regex; nothing else from stderr is forwarded.
  - [ ] `run.mjs` / `run-core.mjs`: on a failed Job, read the termination message, validate it against the failure schema (known code, UUID-only pairs) and print `job/<name> failed: <code>` (+ pairs); keep failing the step.
  - [ ] Lot gate:
    - [ ] `make test-idp-sync-sql ENV=test-idp-sync-codes`: wrapper cases assert the code for empty allowlist, unknown pair, manifest mismatch, DV5 tamper, checksum tamper and stale snapshot.
    - [ ] `make test-idp-sync-selftest ENV=test-idp-sync-codes`: failure-message parsing, unknown code rejected, non-UUID pair rejected.

- [ ] **Lot 2 — Silent, unmistakable fixtures**
  - [ ] `run.selftest.mjs`: no fixture audit or summary is printed to stdout/stderr; fixture values made visibly synthetic (e.g. `synced_users: 101`, UUIDs `00000000-0000-4000-8000-00000000000x`).
  - [ ] Selftest assertion that the selftest's own output contains no line starting with `{"outcome"`.
  - [ ] Lot gate: `make test-idp-sync-selftest ENV=test-idp-sync-codes`.

- [ ] **Lot 3 — Final validation**
  - [ ] gemini cross-review recorded; auth review.
  - [ ] CI green on the PR.
  - [ ] Remove `BRANCH.md` before merge.
