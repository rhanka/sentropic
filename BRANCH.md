# Feature: Preprod S2S service-token issuer for the github-app broker and artifact builder

## Objective
- [x] Accept the standalone IdP S2S tokens of immo-preprod-host on `/api/v1/github-app/broker/*` and `/api/v1/artifacts/builder`: the guards expected `iss` and `aud` = request origin, which is `http://preprod.sentropic.sent-tech.ca` behind the plain-HTTP ui nginx (`X-Forwarded-Proto $scheme`), while the IdP mints `iss=https://preprod.auth.sent-tech.ca` and `aud=https://preprod.sentropic.sent-tech.ca`, so every broker call answered 403 access_denied.

## Scope / Guardrails
- [x] Branch fix/preprod-s2s-service-issuer from main 39bf243b4 (exact 39bf243b4); worktree tmp/fix-s2s-service-issuer; ENV=test-s2s-issuer.
- [x] Dedicated key OAUTH_SERVICE_ISSUER_URL (not OAUTH_ISSUER_URL: it also sets the api AS issuer and the federation `redirect_uri`, see patch-api-config.yaml); unset keeps the co-located dev/test behavior.
- [x] PREPROD ONLY overlay change: prod overlays and base untouched; no Secret value in Git.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/config/env.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/routes/github-app.ts`
  - `api/src/routes/artifacts-builder.ts`
  - `api/tests/unit/auth/oauth-service-issuer.test.ts`
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
  - `ui/**`
  - `deploy/k8s/base/**`
  - `deploy/k8s/overlays/prod/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: the ConfigMap key is read at api start only; after merge the preprod api needs a rollout (`kubectl rollout restart deploy/api -n sentropic-preprod`) and a repin to an image that carries this code.
- [x] `attention`: live probe 2026-11-08: pod env has no OAUTH_SERVICE_RESOURCE_URI; ui nginx forwards `X-Forwarded-Proto: http`; auth-idp reads ConfigMap auth-idp only.
- [x] `deferred`: guard-level test with a signed token on the nginx header shape (review F3) — follow-up.
- [x] `attention`: `service-s2s` `/ping` keeps `resolveOAuthIssuer` on purpose: its `/self-check` mints from this api's own token endpoint.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one narrow fix, one CI.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable: no AI test in scope.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Dedicated S2S issuer**
  - [x] `api/src/config/env.ts`: OAUTH_SERVICE_ISSUER_URL (optional).
  - [x] `api/src/routes/auth/oauth.ts`: `resolveOAuthServiceIssuer` (env, else `resolveOAuthIssuer`).
  - [x] `api/src/routes/github-app.ts`, `api/src/routes/artifacts-builder.ts`: guards use `resolveOAuthServiceIssuer`.
  - [x] `deploy/k8s/overlays/preprod/patch-api-config.yaml`: OAUTH_SERVICE_ISSUER_URL=https://preprod.auth.sent-tech.ca and OAUTH_SERVICE_RESOURCE_URI=https://preprod.sentropic.sent-tech.ca (review pr-963-opus F1/F2).
  - [x] `api/tests/unit/auth/oauth-service-issuer.test.ts`: configured and fallback cases on the real nginx header shape (`x-forwarded-proto: http`).
- [ ] **Lot 2 — Final validation**
  - [x] `make typecheck-api ENV=test-s2s-issuer`: local image build blocked by an npm network error; CI run 42492944203 green on head 2451b005d.
  - [ ] CI green on the final head (typecheck + unit shards).
  - [x] PR #963 opened; Opus review `.h2a/reviews/pr-963-opus.md` REQUEST_CHANGES on 2451b005d (F1 audience, F2 comments) addressed in the next head.
