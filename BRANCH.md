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
  - `BRANCH.md`
  - `api/src/services/auth/remote-*`
  - `api/src/routes/auth/remote-*`
  - `api/tests/unit/auth/remote-*`
  - `api/tests/api/auth/remote-*`
  - `apps/auth-idp/idp-app.ts`
  - `api/src/app.ts`
  - `api/src/services/session-manager.ts`
  - `deploy/k8s/base/35-auth-idp.yaml`
  - `spec/REMOTE_CONTROL_RC1.md`
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

## Feedback Loop
- [x] BRRC1-EX1: isolate IdP session signing in deploy/k8s/base/35-auth-idp.yaml and bind immutable MFA/lineage in session-manager credentials. Reason: shared DB writers must not elevate issuer MFA. Impact: new IdP session-secret reference; pre-upgrade unsigned-lineage credentials cannot control remotely. Rollback: disable remote issuance and restore manifest; no data reversal or gate bypass. User's RC1 login/proof-key isolation mandate authorizes this directly blocking correction; no deployment is run.
- [ ] Native I2 verifier/proof/capsule contribution: conductor handoff in .tmp/remote-ctl/RC1-requests-to-native.md; use test-only fake pending receipt.
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
