# Feature: SG0-app host composition on the Sentropic public origin (A-LIVE W1 / M2-S)

## Objective
Mount the shipped cluster-mesh GitHub App router on the Sentropic public origin with a durable Postgres enrollment store, `secret-crypto:v1` custody, owner-session `resolveOwner`, service-identity `authenticateBroker`, the frozen two-repo target registry, and log suppression. Code only — merge and activation wait for the GB4-P go (A-LIVE §10).

- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Scope / Guardrails
- Scope limited to SG0-app host composition (`resolveOwner`, `authenticateBroker`, durable shared store, custody key, HTTPS public mount, target registry, log suppression) as defined in plan lot M2-S.
- One migration file max; this branch adds exactly one control migration (`api/drizzle/control/0021_github_app_enrollments.sql`).
- Make-only workflow, no direct Docker commands; no host npm.
- Root workspace `~/src/sentropic` is reserved for the user (`ENV=dev`); this lane works in the `tmp/worktrees/alive-w1` worktree.
- Automated test campaigns on `ENV=test-alive-w1`, never on root `dev`.
- Host disk above 90%: no local image build this session (owner disk rule 06/11); scoped test runs are deferred to the CI per that rule.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All new text in English.
- Wagon model: branch pushed only, no PR; the train integration lane merges.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/cluster-mesh/github-app-host.ts`
  - `api/src/services/cluster-mesh/github-app-envelope-store.ts`
  - `api/src/routes/github-app.ts`
  - `api/src/app.ts`
  - `api/src/config/env.ts`
  - `api/src/db/control-schema.ts`
  - `api/tests/unit/services/cluster-mesh/github-app-host.test.ts`
  - `api/tests/api/github-app-product-mount.test.ts`
  - `api/src/services/secret-crypto.ts`
  - `ui/nginx/default.conf`
  - `api/tests/api/github-app-envelope-store.spec.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/**` (cluster-mesh SG0-app core and its contract tests are frozen on this lane)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/control/*.sql` + `api/drizzle/control/meta/_journal.json` (max 1 file; BR86-EX1 below)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR86-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `BR86-EX1` (declared before writing): one control migration `api/drizzle/control/0021_github_app_enrollments.sql` plus its journal entry `api/drizzle/control/meta/_journal.json`.
  - Reason: `GitAppEnvelopeStore` requires a durable, replica-shared store with a unique enrollment reference (`OP6 §2.7`, `G0 v3 §2.7`); the control stream is where cluster-mesh host tables live (precedent `control.cluster_mesh_*`).
  - Number scan: rescanned all `origin/*` refs before writing; `0016`–`0019` exist only on remote heads of #677's stream, `0020` only in stale refs predating the `0012_app_artifact_host` renumber; `0021` is free everywhere.
  - Impact/rollback: additive single table; `make down-volumes ENV=<env>` and journal-file revert remove it cleanly.
- `attention`: host disk usage read 91–92% all session; the owner rule (06/11) forbids new local image builds above 90%, and no local sentropic-api image exists, so local `make up`/`test-api-unit` runs are impossible this session. Scoped tests were authored and pushed for the CI (final gate is the branch CI / train integration).
- `attention`: `authenticateBroker` trusts `createRequireServiceAuth` (mcp-auth) + a server-side client-id → `{ storageScopeId, repoId }` binding; the immo host service client credential itself is provisioned out-of-band (secret bundle, not this lane). Immo's binding values and target scope/repo ids come from `GITHUB_APP_TARGETS_JSON` / `GITHUB_APP_BROKER_BINDINGS_JSON` at deploy time; none is committed.

## AI Flaky tests
- Not applicable this session (no local test run; see Feedback Loop). CI failures to be triaged by the train integration lane against the recorded signatures.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- Rationale: one orthogonal lot (SG0-app host composition); wagon branch consumed by the train integration lane.

## UAT Management (in orchestration context)
- **Mono-branch**: no UAT in this lane. Deployment and the owner enrollment gesture (`<sentropic origin>/api/v1/github-app`) wait for the GB4-P go and the M2-G runbook; nothing here deploys or activates.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `COMMON-RULES.md`, `rules/workflow.md`, `rules/testing.md`, plan `M2-S`, `G0 v3 §2.7`, `A-LIVE v2 §6/§10`, immo reservations R1–R5.
  - [x] Worktree `tmp/worktrees/alive-w1`, branch `feat/alive-w1` from `origin/main` (`3f1027496`).
  - [x] `harness check branch` PASS.
  - [x] Environment mapping: `test-alive-w1` (API_PORT 8799, UI_PORT 5199, MAILDEV_UI_PORT 1099); make commands end with `ENV=test-alive-w1`.
  - [x] Control migration number rescan (see BR86-EX1).
- [x] **Lot 1 — Durable store + migration (tests first)**
  - [x] `api/tests/api/github-app-envelope-store.spec.ts` — real-Postgres store contract: ref-uniqueness, durable round-trip across store instances, serialized per-ref transactions, rollback of failed actions.
  - [x] `api/src/db/control-schema.ts` — `control.github_app_enrollments` table entry.
  - [x] `api/drizzle/control/0021_github_app_enrollments.sql` + `api/drizzle/control/meta/_journal.json` (single migration, unique enrollment reference via PK).
  - [x] `api/src/services/cluster-mesh/github-app-envelope-store.ts` — `GitAppEnvelopeStore` + ref→target mapping (`record`/`lookup`).
- [x] **Lot 2 — Host composition router (tests first)**
  - [x] `api/tests/services/cluster-mesh/github-app-host.spec.ts` — frozen registry/config resolution, owner flow with single-use callback states and replay/cross-owner refusal, broker leases bound to the authenticated service identity, forbidden permissions refused with revocation, owner revocation closing leases, durable ref→target resolution on ref routes, path fence for log suppression.
  - [x] `api/src/services/cluster-mesh/github-app-host.ts` — `resolveGitHubAppHostConfig`, `createGitHubAppHostRouter` (custody through `secret-crypto:v1`, enrollment, adapters target mapping, invalidation bus).
  - [x] `api/src/routes/github-app.ts` — product wiring: CM owner session (`authenticateCmHttpRequest`), service S2S broker (`createRequireServiceAuth`, scope `github-app:broker`, client-id bound tuple), real `createGitHubAppApi` egress to `https://api.github.com`.
  - [x] `api/src/config/env.ts` — `GITHUB_APP_PUBLIC_BASE_URL`, `GITHUB_APP_TARGETS_JSON`, `GITHUB_APP_BROKER_BINDINGS_JSON`.
  - [x] `api/src/app.ts` — public mount at `/github-app` and http log suppression for `isGitHubAppPath`.
  - [ ] Lot gate (CI): `make typecheck-api ENV=test-alive-w1`, `make lint-api ENV=test-alive-w1`, `make test-api-unit SCOPE=tests/api/github-app-envelope-store.spec.ts ENV=test-alive-w1`, `make test-api-unit SCOPE=tests/services/cluster-mesh/github-app-host.spec.ts ENV=test-alive-w1` — blocked locally by the disk rule; run on the CI/train lane or when the host drops below 90%.
- [ ] **Lot 3 — s-archi review fixes (`.tmp/rv/reviews/w1-alive-w1-26209d5f.md`, R1–R5)**
  - [x] R1 custody fail-closed: the mount gate refuses an absent, blank or dev-seed `SECRET_ENCRYPTION_KEY` (`isProvisionedSecretEncryptionKey`); the shared `v1` fallback is unchanged.
  - [ ] R3+R4 host: public mount `/api/v1/github-app/*` translated onto the frozen package root; required enroll target (no `targets[0]` default); landing lists both registry targets; callbacks, redirects and form actions republished on the public mount; broker identity via a stripped per-request token header.
  - [ ] R2+R4 edge: product `secureHeaders` skipped on `isGitHubAppPath`; ui nginx location `^/api/v1/github-app` with `access_log off` and error log at `crit`.
  - [ ] R5 wiring: host spec moved to `api/tests/unit/services/cluster-mesh/github-app-host.test.ts` (unit suite, wired in CI).
  - [ ] Tests: host unit spec (custody gate, explicit target, public mount, headers, chunked broker body); product mount test `api/tests/api/github-app-product-mount.test.ts` (real app, admin_app session, CSP/referrer, both targets, gate refusal); store overlap forced through `pg_blocking_pids` with the deterministic 40001 refusal.
  - [ ] Local runs: none (host disk above 90%, no local image build); CI gate on `ENV=test-w1-fix`: typecheck-api, lint-api, the unit host spec, and the endpoints product-mount and store specs.
- [ ] **Lot N — Final validation**
  - [ ] Scoped tests green (CI).
  - [x] `make scope-check` (PASS C2) before every commit: c1 store lot, c2 host lot, c3 wiring, c4 docs.
  - [x] `make down-volumes ENV=test-alive-w1` once any local stack exists (none started this session).
  - [x] Push wagon `feat/alive-w1`; report to the conductor in `.tmp/rv/alive-W3-W7.md`; no PR, no CI polling.
