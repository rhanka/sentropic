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
- [x] **Exception process**: document rationale, impact and rollback before editing.

## Feedback Loop
- [x] BR-IDP-EX1: Extend only test-idp-sync-sql in Makefile to exercise the real authorize handler with the imported fixture; isolated containers only; rollback removes the added acceptance invocation.
- [x] Design recorded in .h2a/SPEC.md; conductor review may follow the PR per build brief.

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
  - [x] Write spec and SPEC_READY artifact before implementation.
- [ ] **Lot 1 — Relay and run controls**
  - [ ] Export clients and boolean secret presence; provision column grants; count/checksum clients.
  - [ ] Wire ALLOWED_CLIENTS into dispatch validation and both import manifests.
  - [ ] Extend audit and failure whitelists and run/workflow/bundle selftests.
- [ ] **Lot 2 — Transactional client pass**
  - [ ] Add host-map.csv, URI policy, allowlist/source guards and target classification.
  - [ ] Preserve existing secrets; skip new confidential clients; map owner FK; upsert before consents.
  - [ ] Protect whole-row invariants and verify exact configuration postconditions.
- [ ] **Lot 3 — Pipeline acceptance**
  - [ ] Update fixtures/prod.sql, assertions.sql and assert-committed.sql for client convergence.
  - [ ] Update sql-test.sh for five-file relay, client allowlist, rollback, idempotence and failure cases.
  - [ ] Add real-handler authorize selftest proving immo-mcp 302 with the imported fixture.
  - [ ] Run make test-idp-sync-selftest and make test-idp-sync-sql ENV=test-idp-oauth-client-sync.
- [ ] **Lot 4 — Documentation and final gates**
  - [ ] Consolidate design into README.md, CRED_CYCLE.md and durable spec.
  - [ ] Check every diff hunk, run scope-check before commits and resolve review findings.
  - [ ] Open PR to main using BRANCH.md body and post the execution plan.
  - [ ] Wait for green CI at final PR head and write .h2a/report.md with PR/SHA/acceptance.
  - [ ] Stop with PR open; retain BRANCH.md; real sync remains owner-gated through CD.
