# Feature: RC1 session authority and isolated proof signing

## Objective
- [x] Implement the app-side RC1 boundary from plan v1.1 revision 2: repeated explicit actions and switching under one valid 2FA login; refuse invalidated authority. Native/real-session acceptance remains open below.

## Scope / Guardrails
- [x] Base: origin/main 76c90aef0a4ed9ffdd3a073cd49f640fb97b3b0a; branch feat/remote-ctl-rc1; worktree tmp/worktrees/rc1.
- [x] Muse r4: rebased 72 commits onto origin/main 76c90aef0; only BRANCH.md conflicted. Earlier merge/commit references below describe historical receipts before history rewriting, not the current ancestry.
- [x] Frozen interface SHA-256: 104e64761f957c12291ad86bc8553359d63bf15135660d7f53ddbdccded17032; plan: 31d6257d70fc87877e4a2076e4cbf0e58ffc33adc24b9d288590e6059f8d4256.
- [x] ENV=test-rc1 last; API_PORT=8799 UI_PORT=5199 MAILDEV_UI_PORT=1099; shared Docker locks; make down after execution.
- [x] Make-only; no live production operation; no frozen-directory writes; update from main by rebase; atomic commits at most 150 lines; no trailers.
- [x] RC2 transport/provider/capsule and K-app journal/claim/effects remain separate; native contribution requested through conductor with test fake behind the port.
- [x] D2 central signer/login-credential trust and bounded offline revocation remain as frozen; no claim of a trusted display or fresh human click.
- [x] BRRC0-EX1 preserves mechanism-only release dependencies and single-writer leases; artifact gates remain closed.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/auth/remote-*`
  - `api/src/routes/auth/remote-*`
  - `api/tests/unit/auth/remote-*`
  - `api/tests/api/auth/remote-*`
  - `apps/auth-idp/idp-app.ts`
  - `api/src/app.ts`
  - `api/src/services/session-manager.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/routes/namespaces/auth/federation.ts`
  - `api/src/routes/namespaces/auth/account.ts`
  - `api/src/routes/namespaces/session-lifecycle.ts`
  - `api/src/routes/namespaces/admin-product-authority.ts`
  - `api/src/middleware/auth-rate-limiters.ts`
  - `api/src/services/admin-approval-sweep.ts`
  - `deploy/k8s/base/35-auth-idp.yaml`
  - `deploy/k8s/base/15-networkpolicy.yaml`
  - `deploy/k8s/base/30-api.yaml`
  - `.github/workflows/ci.yml`
  - `.github/workflows/idp-session-secret.yml`
  - `deploy/ci/idp-identity-sync/session-*`
  - `deploy/ci/idp-identity-sync/idp-sync.selftest.mjs`
  - `spec/REMOTE_CONTROL_RC1.md`
  - `Makefile`
  - `plan/65-BRANCH_perf-ci-parallel-dag.md`
  - `scripts/ci/ci-dag.mjs`
  - `scripts/ci/ci-dag.test.mjs`
  - `scripts/ci/ci-expected-results.mjs`
  - `scripts/ci/ci-expected-results.test.mjs`
  - `scripts/security/security-parser-test.sh`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `api/tests/fixtures/canvas-live/b1-save-payloads.json`
  - `ui/tests/fixtures/canvas-live/b1-content.json`
  - `docs/canvas-live/h0-corpus.md`
  - `docs/canvas-live/h0-gates.md`
  - `docs/canvas-live/h0-inputs.sha256`
  - `docs/canvas-live/h0-inventory.md`
  - `docs/canvas-live/h0-transfer-receipts.md`
  - `docs/canvas-live/h0-validation.md`
  - `docs/canvas-live/verify-h0.sh`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/drizzle/**`
  - `api/drizzle-control/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `deploy/**`
- **Exception process**:
  - [x] Declare BRRC1-EXn with rationale, impact and rollback before any conditional edit.
