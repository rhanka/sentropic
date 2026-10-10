# Feature: Sync allowlisted OAuth clients from prod to preprod

## Objective
- [ ] Extend the IdP relay with safe OAuth client convergence and prove immo-mcp reaches preprod login.

## Scope / Guardrails
- [x] Work only in tmp/idp-oauth-client-sync on feat/idp-oauth-client-sync.
- [x] Make-only, Docker-first, Node/SQL only; ENV last; atomic commits under 150 lines.
- [x] No production sync, merge, publication, real credentials or schema migration.
- [x] Tests use ENV=test-idp-oauth-client-sync; isolated containers publish no ports.
- [x] Preserve signing keys, existing client secrets and clients outside the allowlist.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md`
  - `deploy/ci/idp-identity-sync/**`
  - `deploy/k8s/overlays/prod/idp-identity-sync/**`
  - `deploy/k8s/overlays/preprod/idp-identity-sync/**`
  - `.github/workflows/idp-identity-sync.yml`
  - `.h2a/**`
- [x] **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `packages/**`
  - `apps/**`
- [x] **Conditional Paths (allowed only with explicit exception)**:
  - `Makefile`
  - `.github/workflows/ci.yml`
- [x] **Exception process**: document rationale, impact and rollback before editing.

## Feedback Loop
- [x] BR45-EX2: Makefile — extend only test-idp-sync-sql with the real authorize handler and imported fixture; containers publish no ports, source mounts are read-only, Node runs as host UID, and network is required for temporary tool installation; rollback removes the added acceptance invocation.
- [x] Design recorded in .h2a/SPEC.md; conductor review may follow the PR per build brief.
- [x] R1: Independent review identified malformed URI authorities; reproduced the failure and reject invalid DNS/IPv4/percent syntax for redirects and resources with rollback regression checks.
- [x] M1: Preserve source ambiguity checks using a prod-owned boolean presence view; remove raw hash privileges and prove the reader cannot read hashes or export prod IDs/hashes.
- [x] BR45-EX3: .github/workflows/ci.yml — add the real authorize-handler sources to the IdP test filter; impact is an extra isolated gate on auth-hono changes; rollback removes only those filter entries.
- [x] Review follow-up: gate auth-hono changes, run Node acceptance as host UID, validate client-map shape before writes and prove the mapped radar client target with rollback.

## AI Flaky tests
- [x] No provider-dependent tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; conductor coordinates independent read-only reviews.

## UAT Management (in orchestration context)
- [x] Synthetic pipeline acceptance only; owner-gated real CD acceptance follows merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and spec**
  - [x] Read brief, rules, consent pass, schema, authorize handler and registration shape.
  - [x] Harness branch check passes; capture isolated pipeline make targets.
  - [x] Write spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md and .h2a/SPEC_READY.md before implementation.
- [x] **Lot 1 — Relay and run controls**
  - [x] Export clients and boolean secret presence; provision column grants; count/checksum clients.
  - [x] Wire ALLOWED_CLIENTS into dispatch validation and both import manifests.
  - [x] Extend audit and failure whitelists and run/workflow/bundle selftests.
- [x] **Lot 2 — Transactional client pass**
  - [x] Add host-map.csv, URI policy, allowlist/source guards and target classification.
  - [x] Preserve existing secrets; skip new confidential clients; map owner FK; upsert before consents.
  - [x] Protect whole-row invariants and verify exact configuration postconditions.
- [x] **Lot 3 — Pipeline acceptance**
  - [x] Update fixtures/prod.sql, assertions.sql and assert-committed.sql for client convergence.
  - [x] Update sql-test.sh and clients-test.sh for five-file relay, client allowlist, rollback, idempotence and failure cases.
  - [x] Add real-handler authorize selftest proving immo-mcp 302 with the imported fixture.
  - [x] Run make test-idp-sync-selftest and make test-idp-sync-sql ENV=test-idp-oauth-client-sync; controls 44/44 and immo-mcp 302 pass.
- [ ] **Lot 4 — Documentation and final gates**
  - [x] Consolidate design into README.md, CRED_CYCLE.md and durable spec.
  - [ ] Check every diff hunk, run scope-check before commits and resolve review findings.
  - [ ] Open PR to main using BRANCH.md body and post the execution plan.
  - [ ] Wait for green CI at final PR head and write .h2a/report.md with PR/SHA/acceptance.
  - [ ] Stop with PR open; retain BRANCH.md; real sync remains owner-gated through CD.
