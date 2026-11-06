# Feature: Git artifact live pod lifecycle

## Objective
- [ ] Deliver A-LIVE pod lifecycle, locked dependency cache, idle build and same-origin live serving.

## Scope / Guardrails
- [x] Branch `feat/git-artifact-live-pod`; worktree `tmp/worktrees/live-pod`; base train `1f28f6792`.
- [x] Binding contracts: G0 FROZEN v3, A-LIVE FROZEN v2, Immo reservations R1-R5.
- [x] Wagon: push branch only; versions, locks and fixtures belong to integration.
- [x] Make only, no Python, secrets output, local image build, skip markers or attribution trailers.
- [x] Selective staging, make commit, fewer than 150 changed lines per commit.
- [x] Tests `API_PORT=9640 UI_PORT=5840 MAILDEV_UI_PORT=1740 ENV=test-live-pod`; ENV last.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/**`
  - `api/tests/unit/artifacts-live/**`
  - `apps/artifact-content/src/**`
  - `apps/artifact-content/tests/live*.test.ts`
  - `deploy/k8s/base/artifact-content-networkpolicy.yaml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `package-lock.json`
  - `packages/**/package.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
- **Exception process**:
  - [x] Declare reason, impact and rollback before conditional changes.

## Feedback Loop
- [x] Track single writer: integration imports this plan and report; this concurrent wagon does not write `.track`.
- [x] Production activation requires OD-SUBSTRATE, GB4 receipts, relay availability and complete integrity qualification.
- [x] Use existing local images only; real-cluster acceptance belongs to the later qualification lane.

## AI Flaky tests
- [x] No provider tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Single wagon, no delegated implementation; consolidated train review.

## UAT Management (in orchestration context)
- [ ] Train qualification: owner edit/HMR, retained draft, idle publication, release reader isolation.

## Plan / Todo (lot-based)
- [x] Lot 0: read contracts, initialize worktree and verify branch mechanically.
- [ ] Lot 1: durable runtime, attempt and publication-progress fences; Postgres CAS adapter.
  - [x] Define host runtime/progress records and transactional integration ports.
  - [x] Persist scoped state under a cross-replica Postgres transaction; freeze no-secret R1 recipes.
- [ ] Lot 2: one-pod Kubernetes adapter and restricted manifest; safe revive/stop/recovery.
  - [x] Pin the VAP-compatible pod and adopt response-loss creations under UID/session fences.
  - [x] Fence revive readiness, retain draft conflicts and checkpoint before decommissioning.
  - [x] Limit the in-cluster client to namespace pod/service CRUD with UID deletion preconditions.
- [ ] Lot 3: locked integrity-verified cache; fixed R1 live/build recipes.
  - [x] Require complete pre-approved integrity inventory and literal lockfile script-package qualification.
  - [x] Admit only clean locked installs; authenticate cache receipts and rehash safe read-only trees on use.
- [ ] Lot 4: clean idle build, B2 eligibility, wake/finalization serialization and crash recovery.
  - [x] Build a clean last head after strictly 600 seconds; atomically consume B2 eligibility with publication.
  - [x] Fence route epochs and advance clean drafts only through a verified empty-overlay CAS.
  - [x] Implement wake cancellation, narrow revoked-owner stop, heartbeat exclusion and crash/lifetime reaping.
  - [x] Add explicit historical build-only provisioning without Vite, routes or draft restoration.
  - [x] Bind supervisor operations to fixed recipes, phase fences, read-only dependencies and host-owned HMR configuration.
  - [x] Add bounded relay-only tarball fetching and exact served-script CSP hashes for Vite refresh.
  - [x] Bound revive/build phases and pass the current pod fence to clean cache installation.
  - [x] Verify native HMR handshake credential stripping and immediate socket revocation.
  - [x] Compose the API service with scoped Postgres state, private immutable cache blobs and Kubernetes/supervisor adapters.
- [ ] Lot 5: authenticated content proxy, exact HMR endpoint, live-only CSP and egress policy.
  - [x] Add separate live consent/path gate, credential-stripping proxy, bounded responses and scoped egress.
  - [x] Authenticate the exact same-origin HMR upgrade and disconnect tunnels on live authority changes.
- [ ] Lot 6: scoped fake Kubernetes/forge/cache/publication race tests and content proxy tests.
  - [x] Add an isolated transactional fake store, Kubernetes Core fake and forge/worker fixture.
  - [x] Cover exact revive, idle threshold/activity, dirty conflicts, divergence and B2 publication counterexamples.
  - [x] Exercise wake/build/finalization races, uncertain termination, interrupted work and store failures.
  - [x] Test cold/warm cache verification, integrity gaps, tampering, path escapes and R1 environment.
  - [x] Test live grant separation, credential stripping, CSP, source exclusions, HMR Origin/path and revocation.
  - [x] Use explicit non-returning guards so strict TypeScript retains refusal-path narrowing.
  - [x] Test VAP manifests, provision-response loss, foreign-generation denial and historical build-only entry.
- [ ] Lot 7: record evidence in `.tmp/rv/live-pod.md`, push without PR and remove test volumes.
