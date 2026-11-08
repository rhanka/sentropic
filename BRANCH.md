# Feature: A4 import RP provenance, mapping digest coverage and preprod IdP enrolment guard (T1)

## Objective
- [ ] Fail the A4 identity import closed when legacy credentials exist and the declared IdP RP ID (`CM_IDENTITY_CUTOVER_IDP_RP_ID`) is absent or differs from the app RP ID: the legacy table has no RP column and was shared by the app and the IdP, so a single stamp is faithful only on a single-RP tier (preprod 08/11: 22 credentials mis-stamped, `.tmp/rv/idp-passkey-diag.md` F2).
- [ ] Hash `cm-import-source.ts` (and its source table list) into `a4MappingAssetSha256` (GLM #948 MEDIUM).
- [ ] Converge the source `rpId` onto an existing replica credential in the identity replica sync instead of a whole-batch conflict (F3), so the first post-A4 prod to preprod sync repairs the import stamps.
- [ ] Disable passkey registration ceremonies on the preprod IdP by explicit configuration `WEBAUTHN_REGISTRATION=disabled` (s-archi verdict A4): preprod receives IdP credentials only through the G7 sync.

## Scope / Guardrails
- [ ] Train T1 wagon (s-archi verdict `.tmp/rv/app-plan-archi-verdict.md`, inventory `.tmp/rv/app-cm-inventory.md` §3.1.4); branch `fix/a4-import-rp-provenance` from origin/main `c22163106`; worktree `tmp/worktrees/t1-a4-import-rp-provenance`; no PR (train lane assembles).
- [ ] Make-only, Docker-first, no Python; `ENV=test-t1b-rp` last; ports API_PORT=9281 UI_PORT=5481 MAILDEV_UI_PORT=1181; never ENV=dev; end with `make down-volumes ENV=test-t1b-rp`.
- [ ] No version bump, lock, fixture or image pin change in this wagon (train lane): `packages/cluster-mesh/src/**` changes and needs the train bump.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/cm-import-source.ts`
  - `api/src/services/identity/cm-import-manifest.ts`
  - `api/src/services/identity/cm-cutover-config.ts`
  - `api/src/scripts/cm-preprod-state.ts`
  - `api/src/config/env.ts`
  - `api/src/routes/namespaces/auth.ts`
  - `api/tests/unit/auth/cm-import-source-rp.test.ts`
  - `api/tests/utils/cm-cutover-test-config.ts`
  - `api/tests/utils/cm-fresh-database.ts`
  - `api/tests/api/auth/passkey-registration-guard.test.ts`
  - `packages/cluster-mesh/src/storage/identity/replica-sync.ts`
  - `packages/cluster-mesh/tests/identity/replica-sync.spec.ts`
  - `deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml`
  - `deploy/ci/preprod-a4/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `**/package.json`, `**/package-lock.json` (train lane bumps)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `deploy/k8s/overlays/prod/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] `attention`: prod A4 operator wagon (`feat/prod-a4-operator`) must set `CM_IDENTITY_CUTOVER_IDP_RP_ID` on the api for the prod rehearsal and cutover, ideally `configMapKeyRef: auth-idp/WEBAUTHN_RP_ID`.
- [ ] `attention`: train lane bumps `@sentropic/cluster-mesh` (replica-sync change).

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (train T1 wagon; the train lane merges the wagon branches)
- Rationale: owner WAGON MODEL, one PR and one CI per train.

## UAT Management (in orchestration context)
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read verdict A1-A5, inventory §3.1.4, `.tmp/rv/idp-passkey-diag.md` F2/F3, GLM #948 review.
  - [x] Worktree on origin/main `c22163106`, ENV and ports above.
- [ ] **Lot 1 — Import RP guard and mapping digest (tests first)**
  - [x] `api/tests/unit/auth/cm-import-source-rp.test.ts`: same RP stamps every credential; differing or undeclared IdP RP refuses with `identity_import_invalid`; a source without credentials imports whatever the declaration; the digest covers `mapA4IdentitySource` and `readA4IdentitySource`.
  - [x] `cm-import-source.ts` guard + `idpRpId` option; `cm-cutover-config.ts` reads `CM_IDENTITY_CUTOVER_IDP_RP_ID`; `cm-preprod-state.ts` passes it; test configs declare it.
  - [x] `cm-import-manifest.ts` hashes the source module and table list.
- [ ] **Lot 2 — Replica sync rpId convergence (tests first)**
  - [x] `replica-sync.spec.ts`: a source rpId converges onto a live replica credential (counter kept, revision bumped, `updated`); a locally revoked credential keeps its rpId.
  - [x] `replica-sync.ts`: rpId leaves the conflict material set; apply converges it.
- [ ] **Lot 3 — Preprod IdP enrolment guard (tests first)**
  - [ ] `api/tests/api/auth/passkey-registration-guard.test.ts`: disabled refuses register options/verify with 403 `passkey_registration_disabled` before any author fence write; login options unaffected; enabled keeps registration reachable.
  - [ ] `bundle.selftest.mjs`: preprod-a4 auth-idp ConfigMap carries `WEBAUTHN_REGISTRATION=disabled`; preprod api and prod auth-idp do not.
  - [ ] `env.ts` enum, `auth.ts` guard, `patch-auth-idp-config.yaml` key.
- [ ] **Lot 4 — Final validation**
  - [ ] `make typecheck-api` + `make lint-api` (ENV=test-t1b-rp).
  - [ ] Scoped API tests: `make test-api-unit SCOPE="tests/unit/auth/cm-import-source-rp.test.ts tests/unit/auth/cm-import-mapping.test.ts tests/unit/auth/cm-cutover-migration.test.ts"`, `make test-api-endpoints SCOPE="tests/api/auth/passkey-registration-guard.test.ts tests/api/cluster-mesh-auth-roots.test.ts tests/api/auth/registration.test.ts"`.
  - [ ] `make test-cluster-mesh SCOPE=tests/identity/replica-sync.spec.ts`.
  - [ ] `make test-preprod-a4-manifests`.
  - [ ] Opus read-only review `.h2a/reviews/t1-a4-import-rp-provenance-opus.md`; push branch (no PR).
