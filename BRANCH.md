# Feature: Cluster Mesh v1 Degenerate Runtime

## Objective
- [x] Deliver `@sentropic/cluster-mesh` with a working single-instance plus local-device runtime and a federal-shaped public API.
- [x] Activate the package from the current API without observable behavior changes while keeping every multi-instance capability gated and fail-closed.

## Scope / Guardrails
- [x] Keep federation topology F-B/F-C and RFC 8693 broker behavior as typed seams only.
- [x] Keep the shipped runtime to one Sentropic instance, local workstations, and local h2a NHI command mapping.
- [x] Derive tenant identity only through a validated membership resolver and never from request input.
- [x] Derive workspace references as `ws:sha256:<digest>` and never alias `tenantId` to `workspaceId`.
- [x] Keep future OpenERP, immo, and design-system tenants app-neutral with no hard dependency.
- [x] Use only make targets for build, typecheck, lint, test, and package operations.
- [x] Use `ENV=test-cluster-mesh-v1` or `ENV=e2e-cluster-mesh-v1`, always as the last make argument.
- [x] Keep root `ENV=dev` untouched and perform no merge, deploy, or publication.
- [x] Keep each implementation commit under approximately 150 changed lines and stage explicit files only.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `packages/cluster-mesh/**`
  - [ ] `api/src/services/cluster-mesh-adapter.ts`
  - [ ] `api/src/services/tenancy/resolve-tenant.ts`
  - [ ] `api/src/routes/auth/device.ts`
  - [ ] `api/tests/unit/cluster-mesh-adapter.test.ts`
  - [ ] `api/tests/unit/device-route.test.ts`
  - [ ] `api/tests/api/tenancy/arch11-resolve-tenant.test.ts`
  - [ ] `api/package.json`
  - [ ] `package-lock.json`
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `api/drizzle/**`
  - [ ] Existing auth, tenant, workspace, and NHI persistence schemas
  - [ ] RFC 8693 endpoints, trusted-issuer stores, and inter-server directory runtime code
- [ ] **Conditional Paths**
  - [ ] `Makefile` — granted under `BR72-EX1`
  - [ ] `api/Dockerfile` — granted under `BR72-EX1`
  - [ ] `ui/Dockerfile` — granted under `BR72-EX1`
  - [ ] `.github/workflows/ci.yml` — granted under `BR72-EX1`
- [ ] **Exception process**
  - [ ] Use `BR72-EX1` only as this branch-local scope ID for the owner-mandated eight-point published-package wiring.

## Feedback Loop
- [x] `BR72-EX1` (`acknowledge`, GRANTED) — owner explicitly requires package.json, lock, two Dockerfiles, Make target, prerequisites, API_VERSION, and CI wiring.
  - [x] Reason: a published workspace package consumed by `api/` must be installed, built, hashed, and independently validated.
  - [x] Impact: API/UI image dependency layers and API cache invalidation include `packages/cluster-mesh`; CI gains one focused validation lane.
  - [x] Rollback: remove the package dependency, Dockerfile copies/build, Make targets/prerequisites/hash input, and CI filters/job as one mechanical reversal.
- [x] No unresolved product or architecture decisions; dossier v2 plus independent Opus review and owner GO are authoritative.
- [x] `CMV1-EX1` (`acknowledge`, GRANTED) — the owner-mandated fail-closed tenant boundary and blind review require an uncached membership check at the cluster-mesh authorization seam.
  - [x] Reason: process-lifetime tenant cache entries must not outlive membership revocation for directory authorization.
  - [x] Impact: add one uncached resolver entry point over the existing database query; no schema, alias, or ARCH-11 rollout-mode change.
  - [x] Rollback: remove the entry point, its adapter injection, and the two focused regression tests together.
- [x] Reconcile both blind-review rounds without waivers: membership shape, owner isolation, completion ordering, revocation freshness, aggregate coverage, and aggregate gate ordering are fixed with focused tests.
- [x] Record the post-fix reviewer-runtime failure without inventing a PASS: three Opus 4.8 launches and one Sonnet launch exited before producing artifacts in gateway and direct modes.

## AI Flaky tests
- [ ] Do not accept additive timeouts or deterministic failures as flaky.
- [ ] Record any eligible provider/network nondeterminism with same-commit pass evidence and owner sign-off.

## Orchestration Mode
- [ ] **Mono-branch**
- [ ] Keep construction on `feat/cluster-mesh-v1`; use an independent Opus 4.8 h2a reviewer only after construction.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and contract map**
  - [x] Read `rules/MASTER.md`, workflow, architecture, API, security, dossier v2, and the blind design review.
  - [x] Verify the isolated worktree branch with `harness check branch`.
  - [x] Open `harness brainstorm` and `harness plan` against the ratified design.
  - [x] Run `make scope-check` after this branch plan exists.

- [x] **Lot 1 — Membership, directory, and boundary primitives**
  - [x] Add typed node, workstation, validated membership, residence, and workspace-reference contracts.
  - [x] Implement single-node directory enumeration as self plus local workstations.
  - [x] Implement fail-closed tenant resolution and `ws:sha256` workspace references.
  - [x] Keep inter-server discovery and member revocation as unavailable typed ports.
  - [x] Add focused membership, directory, and boundary tests.
  - [x] Gate: `make typecheck-cluster-mesh ENV=test-cluster-mesh-v1` and `make test-cluster-mesh ENV=test-cluster-mesh-v1`.

- [x] **Lot 2 — Trust exchange seam**
  - [x] Add RFC 8693-shaped subject-token, audience, scope, actor-chain, and exchange result contracts.
  - [x] Ship a fail-closed exchange implementation returning a typed gated-capability error.
  - [x] Expose no HTTP broker route and persist no issuer trust relation.
  - [x] Add tests proving all exchange attempts deny without invoking remote behavior.
  - [x] Gate: focused package typecheck and tests.

- [x] **Lot 3 — Identity, agent, memory, and NHI wrap**
  - [x] Implement local W-A signed-reference projection contracts for human identity, agent identity, and memory snapshots.
  - [x] Map attest, offboard, and export to injected `h2a nhi` command execution without interpreting h2a references.
  - [x] Keep remote resolution and W-C replication as gated typed seams.
  - [x] Add tests for local projection, exact h2a command mapping, and fail-closed remote access.
  - [x] Gate: focused package typecheck and tests.

- [x] **Lot 4 — Local workstation attachment and mesh facade**
  - [x] Add a local attachment port matching the existing device-code issue, poll, and approve lifecycle.
  - [x] Compose the five domains behind a single degenerate cluster-mesh facade.
  - [x] Add tests for delegation fidelity and single-instance capability reporting.
  - [x] Gate: focused package typecheck, tests, build, and pack.

- [x] **Lot 5 — Current application adapter**
  - [x] Add a thin API adapter that injects existing device-code functions and the authoritative tenant resolver.
  - [x] Route existing device issue, poll, and approve calls through the adapter with byte-equivalent response behavior.
  - [x] Add API unit tests proving exact delegation and no tenant fallback.
  - [x] Gate: `make typecheck-api ENV=test-cluster-mesh-v1`, `make lint-api ENV=test-cluster-mesh-v1`, and scoped API tests.

- [x] **Lot 6 — Published package wiring**
  - [x] Add the API workspace dependency and regenerate the root lock through a make target.
  - [x] Wire both Dockerfiles, the Make package targets, runtime prerequisites, and `API_VERSION` under `BR72-EX1`.
  - [x] Add CI change filters plus validate/package job; document first-publish bootstrap without publishing.
  - [x] Serialize workspace installation before package prerequisites and return UI cache ownership after aggregate checks.
  - [x] Gate: `make check-ci-version-filters ENV=test-cluster-mesh-v1`, package build/pack, and API image build.

- [x] **Lot 7 — Final validation and independent review**
  - [x] Run `make scope-check` and `harness check scope`.
  - [x] Run package typecheck, test, build, pack plus API typecheck, lint, unit tests, and build.
  - [x] Run the applicable security and CI-configuration gates.
  - [x] Request a blind Opus 4.8 review with constructor not reviewer; reconcile every finding.
  - [x] Re-run all affected gates after review fixes.

## Verification Evidence
- [x] `@sentropic/cluster-mesh`: typecheck, 7 files / 19 tests, build, and pack PASS at `0.1.0`.
- [x] API focused suites: 24 assertions PASS across app adapter, device route/enrollment, and tenant resolution.
- [x] `make build ... ENV=test-cluster-mesh-v1`: PASS, including API/UI builds and container audit gates.
- [x] `make typecheck ... ENV=test-cluster-mesh-v1`: PASS with 0 errors; only historical UI warnings remain.
- [x] `make lint ... ENV=test-cluster-mesh-v1`: PASS with 0 errors; only historical API warnings remain.
- [x] `make check-ci-version-filters ... ENV=test-cluster-mesh-v1`: PASS for all API/UI hash inputs.
- [x] `make scope-check ... ENV=test-cluster-mesh-v1` and `harness check scope`: PASS C2.

- [x] **Lot 8 — Delivery**
  - [x] Push `feat/cluster-mesh-v1` without merging or deploying.
  - [x] Open draft PR #538 with this plan and exact verification evidence.
  - [x] Write `.tmp/engage/cluster-mesh-v1-report.md` in the repository owner workspace.
  - [x] Send valid `sentropic.h2a` envelopes to drumbeat and conductor, plus an `infra/WP-INFRA` lane-scoped envelope through the conductor because no sentropic infra-lane endpoint is registered; exclude unrelated infra sessions.
