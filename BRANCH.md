# Feature: RC1 session authority and isolated proof signing

## Objective
- [ ] Implement RC1 from plan v1.1 revision 2: repeated explicit actions and switching under one valid 2FA login; refuse invalidated authority.

## Scope / Guardrails
- [x] Base: origin/main 5e986a0b6cd2dfecfbde6a588d30055271124696; branch feat/remote-ctl-rc1; worktree tmp/worktrees/rc1.
- [x] Frozen interface SHA-256: 104e64761f957c12291ad86bc8553359d63bf15135660d7f53ddbdccded17032; plan: 31d6257d70fc87877e4a2076e4cbf0e58ffc33adc24b9d288590e6059f8d4256.
- [x] ENV=test-rc1 last; API_PORT=8799 UI_PORT=5199 MAILDEV_UI_PORT=1099; shared Docker locks; make down after execution.
- [x] Make-only; no production changes; no frozen-directory writes; merge only; atomic commits at most 150 lines; no trailers.
- [x] RC2 transport/provider/capsule and K-app journal/claim/effects remain separate; native contribution requested through conductor with test fake behind the port.
- [x] D2 central signer/login-credential trust and bounded offline revocation remain as frozen; no claim of a trusted display or fresh human click.
- [x] BRRC0-EX1 preserves mechanism-only release dependencies and single-writer leases; artifact gates remain closed.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.dockerignore`
  - `.github/workflows/ci.yml`
  - `Makefile`
  - `api/Dockerfile`
  - `e2e/Dockerfile`
  - `e2e/tests/07_comment_assistant.spec.ts`
  - `package-lock.json`
  - `packages/chat-runtime/**`
  - `plan/64-BRANCH_perf-ci-image-artifacts.md`
  - `scripts/check-ci-version-filters.sh`
  - `scripts/ci/ci-expected-results.test.mjs`
  - `scripts/ci/image-receipt.mjs`
  - `scripts/ci/image-receipt.test.mjs`
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/test-api-tooling.sh`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `ui/Dockerfile`
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
  - `deploy/k8s/base/35-auth-idp.yaml`
  - `spec/REMOTE_CONTROL_RC1.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/drizzle/**`
  - `api/drizzle-control/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
  - `deploy/**`
- **Exception process**:
  - [x] Declare BRRC1-EXn with rationale, impact and rollback before any conditional edit.

## Feedback Loop
- [x] BRRC1-EX2: temporary scope for byte-preserving import of origin/main 8d37455df7f019cb42699257d343abbcc7ac2f68 by merge. Reason: main advanced and BRANCH.md conflicts prevent PR CI. Impact: import accepted upstream build/CI/chat-runtime commits; no RC1 edits to those files. Resolve only BRANCH.md, verify Track containment, then immediately restore narrow scope. Rollback: revert the integration merge without rewriting history. The 150-line author-change limit remains on authored patches; this merge preserves upstream commit identities.
- [x] BRRC1-EX1 extension: issuer-private durable session authority on its own PVC prevents shared-DB row restoration from undoing logout/revocation. The product has no mount; loss or corruption refuses remote authority. No schema migration or live storage mutation; rollback disables remote issuance while preserving tombstones.
- [x] BRRC1-EX1: isolate IdP session signing in deploy/k8s/base/35-auth-idp.yaml and bind immutable MFA/lineage in session-manager credentials. Reason: shared DB writers must not elevate issuer MFA. Impact: new IdP session-secret reference; pre-upgrade unsigned-lineage credentials cannot control remotely. Rollback: disable remote issuance and restore manifest; no data reversal or gate bypass. User's RC1 login/proof-key isolation mandate authorizes this directly blocking correction; no deployment is run.
- [ ] Native I2 verifier/proof/capsule contribution: conductor handoff in .tmp/remote-ctl/RC1-requests-to-native.md; use test-only fake pending receipt.
- [x] Native reply R01–R15 tracking IDs linked beside existing tests and in spec/REMOTE_CONTROL_RC1.md; no wire identifier, assertion or native acceptance changed.
- [ ] R15 / RC1-S2-POLICY-01: frozen line 140 references absent S2 share/amend schema/vector bytes; exact normative change request in .tmp/remote-ctl/RC1-share-amend-proof.md; no policy-proof implementation or fixture invented.
- [ ] Real enrolled-2FA/installed native acceptance remains separately witnessed; local fake results cannot close RC-SESSION.

## AI Flaky tests
- [x] No AI-dependent tests; no timeout increases or accepted skips.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single author; no cherry-pick or rebase.
- [x] Independent consensus review before handoff.

## UAT Management (in orchestration context)
- [x] Automated tests remain in isolated worktree; root user environment untouched.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and scope**
  - [x] Read MASTER/workflow/testing/domain rules, I1–I6, D2 limits and BRRC0-EX1; mechanical branch check passes.
- [ ] **Lot 1 — Session evidence, RED then GREEN**
  - [x] RED: four unit and two API suites fail on missing RC1 modules; RC1-red.log records exit 2 for each command.
  - [x] Signed D2-JWS identity, exact action, audience, MFA, lifetime and tenancy mutation vectors authored.
  - [x] Unknown and regressing clock refusal tests authored before implementation.
  - [x] Closed I2 schemas, exact domain bytes and conservative immutable proof deadline primitives implemented.
  - [x] IdP evidence producer derives identity from current credential, preserves login authentication time and reserves each action issuance.
  - [x] Independent pinned-key JWS and current CLI proof validation implemented; no proof-selected trust roots.
  - [x] Three signing roles validate distinct public fingerprints, kids, workloads and secret references; loader reads only its role secret.
  - [x] Owner/current exact-workspace role and consent-scope predicate implemented with the frozen refusal codes and attestation fields.
  - [x] Internal evidence route requires TLS and the exact authenticated app workload before bounded strict body parsing; browser/product issuance refused.
  - [x] Durable issuer adapter revalidates credential/hash/session record and signed immutable login lineage; replay issuance fence uses a separate metadata namespace.
  - [x] Standalone issuer composition uses exact S2S client/scope/audience, public trust and own key; independent tenant/workspace lookup; absent native mapping stays closed.
  - [x] Actual product root exposes only a refusal; standalone IdP owns the internal route with default-closed native contribution.
  - [x] Review coverage additions: valid verifier acceptance, revoked/unknown keys, signed times, every Target field and foreign consent owner/binding.
  - [x] Public-only trust fixture and manifest isolation test authored before IdP deployment-secret change.
  - [x] Integrity RED: all three signed-lineage/MFA-elevation/version tests fail against session-manager before correction.
  - [x] Session and refresh credentials now bind immutable MFA/auth_time/version; refresh validates them and rotates with a hash CAS.
  - [x] Manifest test resolves the actual product deployment path 30-api.yaml.
  - [x] Native verifier fake retains one-use jti state across reconstruction; acknowledged IdP rotation and reciprocal operation scopes covered.
  - [x] Source-switch tests use distinct native audiences; issuer rejects row reparenting and retains clock fencing across requests.
  - [x] api/tests/unit/auth/remote-private-session.test.ts authored before private-store implementation: restart, revocation/DB restore, refresh CAS and immutable lineage.
  - [x] Review-vector RED: 111 passing cases, three required failures (revoked IdP/source keys and separate manifest secret), plus missing private-store suite; explicit key revocation now refused.
  - [x] Issuer-private authority stores only signed-lineage/hash metadata with fsync/atomic replacement, per-session writer fences and retained revocation tombstones.
  - [x] Login/refresh/revoke hooks update issuer-private metadata; resolver requires both credential validity and current private authority, so a restored shared row cannot revive logout.
  - [x] BRRC1-EX1 manifest isolates the IdP session secret and durable volume; an interrupted private writer leaves reads closed until recovery.
  - [x] spec/REMOTE_CONTROL_RC1.md documents exact ports, private authority/configuration, D2 trust limits and native/installed qualification handoff.
  - [x] Explicit unsupported-version versus invalid-kind refusal vectors added for issuer and internal route.
  - [x] First GREEN pass: 118 unit cases passed and 16 API cases passed; fixed a missing test-local workload mock binding before rerun.
  - [x] Code-review OIDC end_session restore regression authored; OAuth revocation adapters and federated login minting must share the canonical session lifecycle.
  - [x] Unknown wire versions now produce unsupported_version/426 independently of schema/kind errors.
  - [x] OAuth single/bulk revocation persists the same private tombstone before DB deletion; federation uses canonical signed session/refresh minting without adding MFA.
  - [x] Review-r2 regressions authored for late private creation after bulk revoke and revocation/deadline changes during asynchronous evidence preparation.
  - [x] Bulk logout fences every deleted session, including a private create that has not completed; unknown-session tombstones prevent late recreation.
  - [x] Issuer-private synchronous signing boundary shares the revocation fence and validates current immutable login/hash/deadline before signing.
  - [x] Evidence revalidates login after asynchronous work and signs standard compact EdDSA synchronously inside the mandatory private fence; original deadlines never extend.
  - [ ] api/tests/unit/auth/remote-evidence.test.ts: repeated actions/switch, logout/revoke/expiry, wrong sid/version/MFA/audience/key, replay and workload separation.
  - [ ] Closed EvidenceRequest; issuer-derived identity and original authentication time; per-operation EdDSA evidence with pinned audiences.
- [ ] **Lot 2 — Consent and authorization, RED then GREEN**
  - [x] api/tests/unit/auth/remote-native-proof.test.ts authored for exact current CLI proof and substitution/expiry/key refusals.
  - [ ] api/tests/unit/auth/remote-authority.test.ts: owner-only, exact workspace membership/role/scopes/consent/epoch, signed attestation, source/read separation.
  - [ ] Separate IdP/app/mesh key and workload references; current native-proof port; no per-action MFA or new unlock.
- [ ] **Lot 3 — Internal IdP composition, RED then GREEN**
  - [x] api/tests/unit/auth/remote-session-integrity.test.ts authored before session-manager changes to challenge DB-only MFA elevation.
  - [x] api/tests/api/auth/remote-session.test.ts authored for durable issuer login/refresh/revocation/version/replay behavior.
  - [ ] api/tests/api/auth/remote-evidence.test.ts: internal workload before body, browser/product denial, bounded strict body, no-store and sanitized failures.
  - [ ] Real session-store adapter preserves sid/version/auth_time across refresh and revalidates logout/revocation/expiry.
- [ ] **Lot 4 — Documentation and validation**
  - [x] internal route acceptance tests authored before implementation.
  - [x] signing isolation acceptance tests authored before implementation.
  - [x] authority acceptance tests authored before implementation.
  - [x] Consent fixture scopeDigest checked against SHA-256 of the exact canonical scope array.
  - [ ] spec/REMOTE_CONTROL_RC1.md: ports, isolation, native request vectors, trust limits and qualification boundaries.
  - [ ] Scoped API tests, retained session/auth regression suites, API typecheck/lint; no UI behavior changed.
  - [ ] Independent review findings reconciled; make scope-check before every commit.
  - [ ] Draft PR to main using this file; first PR comment with execution plan.
  - [ ] CI completed/success on exact reported head; teardown test-rc1; report PR/head without merging.
