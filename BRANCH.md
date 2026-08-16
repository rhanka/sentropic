# Feature: Cluster Mesh v1 Degenerate Runtime

## Objective
- [ ] Deliver `@sentropic/cluster-mesh` with a working single-instance plus local-device runtime and a federal-shaped public API.
- [ ] Activate the package from the current API without observable behavior changes while keeping every multi-instance capability gated and fail-closed.

## Scope / Guardrails
- [ ] Keep federation topology F-B/F-C and RFC 8693 broker behavior as typed seams only.
- [ ] Keep the shipped runtime to one Sentropic instance, local workstations, and local h2a NHI command mapping.
- [ ] Derive tenant identity only through a validated membership resolver and never from request input.
- [ ] Derive workspace references as `ws:sha256:<digest>` and never alias `tenantId` to `workspaceId`.
- [ ] Keep future OpenERP, immo, and design-system tenants app-neutral with no hard dependency.
- [ ] Use only make targets for build, typecheck, lint, test, and package operations.
- [ ] Use `ENV=test-cluster-mesh-v1` or `ENV=e2e-cluster-mesh-v1`, always as the last make argument.
- [ ] Keep root `ENV=dev` untouched and perform no merge, deploy, or publication.
- [ ] Keep each implementation commit under approximately 150 changed lines and stage explicit files only.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `packages/cluster-mesh/**`
  - [ ] `api/src/services/cluster-mesh-adapter.ts`
  - [ ] `api/src/routes/auth/device.ts`
  - [ ] `api/tests/unit/cluster-mesh-adapter.test.ts`
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
- [ ] `BR72-EX1` (`acknowledge`, GRANTED) — owner explicitly requires package.json, lock, two Dockerfiles, Make target, prerequisites, API_VERSION, and CI wiring.
  - [ ] Reason: a published workspace package consumed by `api/` must be installed, built, hashed, and independently validated.
  - [ ] Impact: API/UI image dependency layers and API cache invalidation include `packages/cluster-mesh`; CI gains one focused validation lane.
  - [ ] Rollback: remove the package dependency, Dockerfile copies/build, Make targets/prerequisites/hash input, and CI filters/job as one mechanical reversal.
- [ ] No unresolved product or architecture decisions; dossier v2 plus independent Opus review and owner GO are authoritative.

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

- [ ] **Lot 4 — Local workstation attachment and mesh facade**
  - [x] Add a local attachment port matching the existing device-code issue, poll, and approve lifecycle.
  - [x] Compose the five domains behind a single degenerate cluster-mesh facade.
  - [x] Add tests for delegation fidelity and single-instance capability reporting.
  - [x] Gate: focused package typecheck, tests, build, and pack.

- [ ] **Lot 5 — Current application adapter**
  - [x] Add a thin API adapter that injects existing device-code functions and the authoritative tenant resolver.
  - [ ] Route existing device issue, poll, and approve calls through the adapter with byte-equivalent response behavior.
  - [ ] Add API unit tests proving exact delegation and no tenant fallback.
  - [ ] Gate: `make typecheck-api ENV=test-cluster-mesh-v1`, `make lint-api ENV=test-cluster-mesh-v1`, and scoped API tests.

- [ ] **Lot 6 — Published package wiring**
  - [x] Add the API workspace dependency and regenerate the root lock through a make target.
  - [ ] Wire both Dockerfiles, the Make package targets, runtime prerequisites, and `API_VERSION` under `BR72-EX1`.
  - [ ] Add CI change filters plus validate/package job; document first-publish bootstrap without publishing.
  - [ ] Gate: `make check-ci-version-filters ENV=test-cluster-mesh-v1`, package build/pack, and API image build.

- [ ] **Lot 7 — Final validation and independent review**
  - [ ] Run `make scope-check` and `harness check scope`.
  - [ ] Run package typecheck, test, build, pack plus API typecheck, lint, unit tests, and build.
  - [ ] Run the applicable security and CI-configuration gates.
  - [ ] Request a blind Opus 4.8 review with constructor not reviewer; reconcile every finding.
  - [ ] Re-run all affected gates after review fixes.

- [ ] **Lot 8 — Delivery**
  - [ ] Push `feat/cluster-mesh-v1` without merging or deploying.
  - [ ] Open a draft PR with this plan and exact verification evidence.
  - [ ] Write `.tmp/engage/cluster-mesh-v1-report.md` in the repository owner workspace.
  - [ ] Send valid `sentropic.h2a` envelopes to drumbeat, conductor, and the infra lane with package, API, seam/gate, commits, and PR facts.
