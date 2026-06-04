# Feature: Standalone IdP deploy artifacts (auth.sent-tech.ca)

## Objective
Author the deploy artifacts (api-image extension, k8s manifests, prod OIDC client registration script) for the standalone IdP `auth.sent-tech.ca`, PR-validated and ready, with the actual deploy gated on external items (poc-k8s quota, DNS, prod KEK).

## Scope / Guardrails
- Scope limited to: `api/Dockerfile` (additive build/prod-stage IdP build), `deploy/k8s/**` (new `35-auth-idp.yaml`, extend `15-networkpolicy.yaml` + `60-ingress.yaml`), `Makefile` (build IdP web into the api image + register IdP manifest), `.github/workflows/ci.yml` (auth-idp rollout-status), `api/src/scripts/oauth-register-client.ts` (new prod-safe script) + its `api/package.json` script entry.
- NO deploy, NO kubectl, NO prod touch. PREPARE only.
- One migration max in `api/drizzle/*.sql` — N/A (zero schema change).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); branch work in `tmp/feat-auth-idp-deploy`.
- In every `make` command, `ENV=<env>` last.
- All new text in English.
- F5 is USER-VALIDATED FINAL: dir `apps/auth-idp`, service `auth-idp`, domain `auth.sent-tech.ca`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/35-auth-idp.yaml`
  - `api/src/scripts/oauth-register-client.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `api/drizzle/**`
  - `packages/auth-*/**` (src)
  - `api/src/routes/auth/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/Dockerfile` — `BR39deploy-EX1`
  - `deploy/k8s/15-networkpolicy.yaml` — `BR39deploy-EX2`
  - `deploy/k8s/60-ingress.yaml` — `BR39deploy-EX2`
  - `Makefile` — `BR39deploy-EX3`
  - `.github/workflows/ci.yml` — `BR39deploy-EX4`
  - `api/package.json` — `BR39deploy-EX5`
  - `api/src/index.ts` — `BR39deploy-EX6`
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional path (done below).

## Feedback Loop
- `BR39deploy-EX1` (`api/Dockerfile`): extend the build + production stages so the SAME api image also compiles `apps/auth-idp/index.ts` -> `apps/auth-idp/dist/index.js` (esbuild, same externals as the api build) and bundles `apps/auth-idp/web/build`. Reason: D4-a one-image strategy, lowest entropy. Impact: api default CMD unchanged (`node dist/index.js` from `/workspace/api`); additive COPY + one esbuild call. Rollback: revert the added lines; api runtime identical.
- `BR39deploy-EX2` (`deploy/k8s/15-networkpolicy.yaml`, `deploy/k8s/60-ingress.yaml`): extend NetworkPolicies (auth-idp->postgres egress source, traefik->auth-idp ingress) and add the `auth.sent-tech.ca` Ingress host. Reason: required for the new public IdP service under `default-deny-ingress`. Impact: additive resources only; existing api/ui policies/ingress untouched. Rollback: delete the appended NetworkPolicy docs + Ingress doc.
- `BR39deploy-EX3` (`Makefile`): register `35-auth-idp.yaml` + the auth-idp rollout (restart + status) in `k8s-deploy` (after `30-api.yaml` so the api rolls first), and its delete in `k8s-undeploy`. Reason: the manifest must be applied + rolled out by `k8s-deploy`. NOTE: the IdP screens are built INSIDE `api/Dockerfile` (self-contained `idp-web-build` stage), so NO `build-idp-web` prerequisite is needed — the api image stays self-contained for CI (`publish-api-image`). Impact: additive apply/rollout/delete lines; api/ui order unchanged. Rollback: revert the added lines.
- `BR39deploy-EX4` (`.github/workflows/ci.yml`): add `rollout status deployment/auth-idp` to the `deploy-k8s` job. Reason: assert IdP rollout post-apply, mirroring api/ui. Impact: one additive line (fires only on a real deploy). Rollback: remove the line.
- `BR39deploy-EX5` (`api/package.json`): add an `oauth:register-client` script entry pointing to the new prod-safe script. Reason: runnable as a one-off Job/`npm run`. Impact: one script line. Rollback: remove the line.
- `BR39deploy-EX6` (`api/src/index.ts`): add a guarded, idempotent OAuth/OIDC signing-key init at boot, right after `runMigrations()`/`ensureIndexes()`. Reason: the prod image prunes devDependencies (no `tsx`), so the dev-only `oauth:init-keys` script (and the `make oauth-init-keys` compose-exec target) cannot run in-cluster — there was NO prod path to materialize the JWKS from `OAUTH_SIGNING_KEK`. Boot-time init mirrors the existing 5 idempotent boot steps and is the house pattern; the api owns shared-DB init, the IdP reads the same rows. Impact: ~20 lines guarded by `env.OAUTH_SIGNING_KEK` — when the KEK is absent it logs a warn and skips (no behavior change to the currently-live api, which has no KEK yet); when present it creates the key once (idempotent via `getActiveKey()`), never fatal. Once the KEK is added to the `sentropic-api` Secret, the next api rollout materializes the active key automatically — no Job, no exec. Rollback: remove the block + the `createJwksAdapter` import; api runtime identical.

## Decisions (from spec/SPEC_EVOL_AUTH_IDP_DEPLOY.md §7)
- D4-a (image strategy): extend the existing api image; api vs IdP selected by k8s `command:`. One image, one publish pipeline.
- F1 / D8 (prod DB): SHARED main-api Postgres. No new DB, no new migration, no `users` move. Physical split deferred to Phase D.
- D6 (KEK): `auth-idp` reuses the existing `sentropic-api` Secret via `envFrom` -> shares `DATABASE_URL` + `OAUTH_SIGNING_KEK` + `SCW_TEM_SECRET_KEY`. The KEK MUST be identical for api + idp (shared JWKS rows). Confirming the live Secret carries `OAUTH_SIGNING_KEK` is an execution-gate.
- D7-a (prod OIDC client): prod-safe idempotent `oauth-register-client.ts` (env-driven upsert keyed on `client_id`), NOT the dev seed.
- D11: design-system onboards first (A0).
- F5: FINAL (user-validated) — `apps/auth-idp`, `auth-idp`, `auth.sent-tech.ca`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single artifact stream; no independent CI needed)
- [ ] **Multi-branch**
- Rationale: One coherent deploy-artifact deliverable; no orthogonal sub-streams.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read deploy spec, `api/Dockerfile`, `apps/auth-idp/*`, `apps/auth-idp/web`, `docker-compose.idp.yml`.
  - [x] Read `deploy/k8s/*` (30-api, 40-ui, 15-networkpolicy, 60-ingress, 10-rbac), `make k8s-deploy`, `deploy-k8s` CI job.
  - [x] Read `api/src/config/env.ts`, `oauth-init-keys.ts`, `oauth-seed-clients.ts`, `oauth-client-seed.ts` service, `oauthClients` schema.
  - [x] Confirm isolated worktree `tmp/feat-auth-idp-deploy`, branch `feat/auth-idp-deploy`.
  - [x] Confirm scope, declare EX1–EX5.

- [x] **Lot 1 — D4-a image (api/Dockerfile)**
  - [x] In the `build` stage: esbuild `apps/auth-idp/index.ts` -> `apps/auth-idp/dist/index.js` (same externals as the api build).
  - [x] In the `production` stage: `COPY --from=build /workspace/apps/auth-idp/dist` + `COPY --from=idp-web-build` the `apps/auth-idp/web/build` screens (self-contained `idp-web-build` stage mirrors `apps/auth-idp/web/Dockerfile`); `404.html` asserted inside that stage.
  - [x] api default CMD unchanged (`node dist/index.js` from `/workspace/api`).
  - [x] Lot gate: `make build-api-image` builds (exit 0, after one transient ETXTBSY flake on the unmodified `npm ci` step, green on clean retry); `make typecheck-api` (exit 0) + `make lint-api` (0 errors) green.

- [x] **Lot 2 — k8s manifests**
  - [x] `deploy/k8s/35-auth-idp.yaml`: ConfigMap + Service + Deployment for `auth-idp` (api image, `command:` runs IdP from `/workspace`, port 8787, probes on `/healthz`, env per spec §2.1, reuse `sentropic-api` Secret).
  - [x] Extend `deploy/k8s/15-networkpolicy.yaml`: `allow-auth-idp-to-postgres`, `allow-traefik-to-auth-idp`.
  - [x] Extend `deploy/k8s/60-ingress.yaml`: host `auth.sent-tech.ca` -> `auth-idp:8787`, `letsencrypt-prod`, tls `auth-idp-tls`.
  - [x] Register `35-auth-idp.yaml` + auth-idp rollout in `make k8s-deploy` (+ delete in `k8s-undeploy`). Screens built inside the Dockerfile (self-contained), no build-idp-web prerequisite.
  - [x] Add `rollout status deployment/auth-idp` to the `deploy-k8s` CI job.
  - [x] Lot gate: YAML well-formed (pyyaml safe_load_all on all manifests + ci.yml OK).

- [x] **Lot 3 — Prod OIDC client registration (D7-a)**
  - [x] `api/src/scripts/oauth-register-client.ts`: idempotent env-driven upsert of ONE client keyed on `client_id`, prod URIs only (rejects http/localhost + dev-only secrets), strong external secret (sha256 hash only stored), no dev secrets.
  - [x] `api/package.json` `oauth:register-client` script entry.
  - [x] Lot gate: `make typecheck-api` (exit 0) + `make lint-api` (0 errors) green.

- [x] **Lot N — Final validation**
  - [x] `make build-api-image` (extended image builds, exit 0).
  - [x] `make typecheck-api` + `make lint-api` green (0 errors).
  - [x] YAML manifests well-formed.
  - [x] `make down ENV=test-feat-auth-idp-deploy` + `make ps-all` clean; no services left up.
  - [ ] Create/update PR using `BRANCH.md` (DEFERRED — not requested; PREPARE only).
  - [ ] Merge (DEFERRED — execution-gated).

## Deferred / execution-gates
Deploy EXECUTION (out of this branch — PREPARE only) is gated on:
- **poc-k8s ResourceQuota bump** (G3): the `sentropic` namespace quota (`requests.cpu 300m`, `requests.memory 768Mi`) has no headroom for an api-sized `auth-idp` pod. `claude:poc-k8s` must bump `tenants/sentropic/00-namespace.yaml` (or the IdP is sized down to 75m/192Mi). BLOCKING for apply.
- **Cloudflare DNS A record** `auth.sent-tech.ca` -> Traefik LoadBalancer public IP (same LB as `sentropic.sent-tech.ca`). User / zone holder. cert-manager DNS-01 token already covers the zone.
- **Prod `OAUTH_SIGNING_KEK` secret** in the live `sentropic-api` Secret (D6) — confirm present and IDENTICAL for api + idp (shared JWKS). If absent, seal/add it. Plus confirm a JWKS active key exists (`oauth:init-keys` has run in prod); if not, run a one-time init-keys Job before first IdP traffic.
- **D5**: design-system prod redirect URI (`https://design-system.sent-tech.ca/auth/oauth/callback`) + generated client secret + its hosting — user/design-system.
- **D9**: DNS/cert ownership (covered by the DNS A record gate above).
- **D10**: poc-k8s owns Traefik / cert-manager / ClusterIssuer / namespace baseline; this branch only references them.
- **D12**: public-IdP abuse posture (trusted-proxy/XFF + tighter rate limits) — confirm harden-at-A0 vs defer.
- **User greenlight** for the actual deploy + `make k8s-deploy K8S_INGRESS=1` run (api first so migrations apply, then auth-idp), then `oauth:register-client`, then `make k8s-dns-smoke K8S_HOST=auth.sent-tech.ca` + real-flow UAT (spec §8).
