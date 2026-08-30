# Feature: Cluster Mesh Central Control Plane

## Objective

- [ ] Build the accepted r8 Cluster Mesh central control plane in one branch, delivering the minimum centralized h2a capability first and then converging MCP, sessions, persistence, Graphify memory binding, shared enrollments, security enforcement, and the reusable Focus architecture renderer.
- [ ] Preserve provider authorship and the `LOCAL_ONLY`/`APP_MANAGED` writer boundaries defined by `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md`.

## Scope / Guardrails

- [ ] Treat `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` and `docs/specs/decisions/cluster-mesh-r8/` as the accepted architecture baseline.
- [ ] Keep the entire implementation on `feat/cluster-mesh-central-control-plane`; do not create implementation sub-branches.
- [ ] Execute the build with Codex 5.6 Sol at max reasoning effort.
- [ ] Assign the independent plan/build review to Gemini 3.7 at max reasoning effort; builder and reviewer must differ.
- [ ] Do not merge without explicit owner GO after review, CI, and UAT.
- [ ] Use `make` targets only; do not invoke Docker, npm, package managers, migrations, test runners, linters, or typecheckers directly.
- [ ] Pass `ENV=<env>` as the final argument of every `make` command.
- [ ] Run all branch development in `tmp/feat-cluster-mesh-central-control-plane`.
- [ ] Run automated tests only in `ENV=test-cluster-mesh-central-control-plane` or `ENV=e2e-cluster-mesh-central-control-plane`, never in `ENV=dev`.
- [ ] Reserve the root `/home/antoinefa/src/sentropic` checkout for owner UAT and keep it stable.
- [ ] Ensure the UAT checkout is commit-identical to the pushed branch HEAD before sign-off; record both SHAs in this file.
- [ ] Add at most one generated application migration in `api/drizzle/*.sql`.
- [ ] Keep all new source, test, documentation, migration, and commit text in English.
- [ ] Keep commits atomic and run `make scope-check` before each commit.
- [ ] Remove each legacy effect path in the same lot that activates its central-runtime replacement; no permanent dual path or fallback flag.
- [ ] Keep `/home/antoinefa/src/h2a` and `/home/antoinefa/src/graphify` read-only; validate them through pinned releases and compatibility fixtures.
- [ ] Do not claim external h2a consumer cutover or Graphify activation without the corresponding published package/release gate.

## Branch Scope Boundaries (MANDATORY)

- [ ] **Allowed Paths (implementation scope)**
  - [ ] `BRANCH.md`
  - [ ] `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md`
  - [ ] `docs/specs/decisions/cluster-mesh-r8/**`
  - [ ] `packages/contracts/src/**`
  - [ ] `packages/contracts/tests/**`
  - [ ] `packages/contracts/package.json`
  - [ ] `packages/events/src/**`
  - [ ] `packages/events/tests/**`
  - [ ] `packages/events/package.json`
  - [ ] `packages/cluster-mesh/src/**`
  - [ ] `packages/cluster-mesh/tests/**`
  - [ ] `packages/cluster-mesh/README.md`
  - [ ] `packages/cluster-mesh/package.json`
  - [ ] `packages/mcp-platform/src/**`
  - [ ] `packages/mcp-platform/tests/**`
  - [ ] `packages/mcp-platform/README.md`
  - [ ] `packages/mcp-platform/package.json`
  - [ ] `packages/mcp-platform/etc/mcp-platform.api.md`
  - [ ] `packages/mcp-auth/src/**`
  - [ ] `packages/mcp-auth/tests/**`
  - [ ] `packages/mcp-auth/README.md`
  - [ ] `packages/mcp-auth/package.json`
  - [ ] `packages/mcp-broker/**`
  - [ ] `packages/connector-host/src/**`
  - [ ] `packages/connector-host/tests/**`
  - [ ] `packages/connector-host/package.json`
  - [ ] `packages/llm-mesh/src/**`
  - [ ] `packages/llm-mesh/tests/**`
  - [ ] `packages/llm-mesh/README.md`
  - [ ] `packages/llm-mesh/package.json`
  - [ ] `packages/llm-gateway/src/**`
  - [ ] `packages/llm-gateway/tests/**`
  - [ ] `packages/llm-gateway/package.json`
  - [ ] `packages/focus/src/**`
  - [ ] `packages/focus/tests/**`
  - [ ] `packages/focus/README.md`
  - [ ] `packages/focus/package.json`
  - [ ] `api/src/services/cluster-mesh-adapter.ts`
  - [ ] `api/src/services/cluster-mesh/**`
  - [ ] `api/src/services/llm-account-transports.ts`
  - [ ] `api/src/routes/api/mcp.ts`
  - [ ] `api/src/routes/api/cluster-mesh.ts`
  - [ ] `api/src/routes/api/index.ts`
  - [ ] `api/src/db/schema.ts`
  - [ ] `api/src/db/control-schema.ts`
  - [ ] `api/tests/unit/cluster-mesh-*.test.ts`
  - [ ] `api/tests/unit/llm-account-transports.test.ts`
  - [ ] `api/tests/unit/connector-host.test.ts`
  - [ ] `api/tests/api/mcp-resource-server.test.ts`
  - [ ] `api/tests/api/cluster-mesh-control-plane.test.ts`
  - [ ] `api/tests/api/cluster-mesh-session-authority.test.ts`
  - [ ] `api/tests/api/cluster-mesh-enrollment.test.ts`
  - [ ] `ui/src/lib/cluster-mesh/**`
  - [ ] `ui/src/lib/components/cluster-mesh/**`
  - [ ] `ui/src/lib/components/chat/AppChatPanel.svelte`
  - [ ] `ui/src/lib/chat/session-adapter.ts`
  - [ ] `ui/src/lib/stores/session.ts`
  - [ ] `ui/tests/cluster-mesh/**`
  - [ ] `ui/tests/components/chat/AppChatPanel-session-state.test.ts`
  - [ ] `ui/tests/chat/session-adapter.test.ts`
  - [ ] `ui/tests/stores/session.test.ts`
  - [ ] `e2e/tests/13-cluster-mesh-control-plane.spec.ts`
  - [ ] `package-lock.json`
- [ ] **Forbidden Paths (must not change in this branch)**
  - [ ] `Makefile`
  - [ ] `docker-compose*.yml`
  - [ ] `.cursor/rules/**`
  - [ ] `.github/workflows/**`
  - [ ] `.track/**`
  - [ ] `plan/NN-BRANCH_*.md`
  - [ ] `rules/**`
  - [ ] `infra/**`
  - [ ] `packages/mcp-connector-*/**`
  - [ ] `/home/antoinefa/src/h2a/**`
  - [ ] `/home/antoinefa/src/graphify/**`
- [ ] **Conditional Paths (allowed only through the exception process)**
  - [ ] `api/drizzle/0042_cluster_mesh_control_plane.sql` and its generated `api/drizzle/meta/**` entries; one migration total; requires `CMCP-EX1` before generation.
  - [ ] `package.json`; only if workspace/package export wiring cannot be expressed in package-local manifests; requires `CMCP-EX2`.
  - [ ] `.security/**`; only for an expiring security exception accepted by the owner; requires `CMCP-EX3`.
- [ ] **Exception process**
  - [ ] Declare `CMCP-EXn` in `## Feedback Loop` before touching a conditional path.
  - [ ] Record reason, exact paths, impact, rollback strategy, owner status, and closing commit.
  - [ ] Never use an exception to introduce a second writer, bypass the runtime, select a D10 wire profile, or modify the external h2a/Graphify repositories.

## Feedback Loop

- [ ] Use `blocked`, `deferred`, `cancelled`, or `attention` only when a lot cannot safely proceed or a consequential owner decision is required.
- [ ] Record the owner/reviewer response as `clarification`, `acknowledge`, or `refuse` beside the affected lot before resuming.
- [ ] `CMCP-EX1` — pending only if the build reaches the single PostgreSQL migration; expected paths are `api/drizzle/0042_cluster_mesh_control_plane.sql` and generated metadata; rollback is migration rollback plus removal of unused schema bindings.
- [ ] Graphify publication gate — `blocked` for activation until the neutral `graphify-memory` contract exists and its L0–L7 evidence is available; neutral fixtures and fail-closed adapter work may proceed.
- [ ] D10 profile gate — `deferred` by owner r8; no remote actionable activation and no cross-language message-profile promise may proceed until a separate owner decision.
- [ ] External h2a consumption — `attention`; this Sentropic branch proves package compatibility but does not edit or release the external h2a consumer.

## AI Flaky tests

- [ ] Accept only non-systematic provider, network, or model nondeterminism as `flaky accepted`.
- [ ] Require at least one success on the same commit and same command before classifying a failure as non-systematic.
- [ ] Never add timeouts to silence a failure.
- [ ] Compare the signature with `main`; a related failure blocks the lot.
- [ ] Record command, commit, failing test file, signature, successful rerun, impact analysis, and explicit owner sign-off in this file before merge.

## Orchestration Mode (AI-selected)

- [x] **Mono-branch + cherry-pick** — template mode label selected for a single integration branch; execution uses direct sequential commits on `feat/cluster-mesh-central-control-plane` and no cherry-picks or sub-branches.
- [ ] **Multi-branch** — prohibited for this build by the owner's one-branch instruction.
- [ ] Rationale: the lots are causally ordered, share contract/schema cutovers, and must be reviewed as one converged control plane.

## UAT Management (in orchestration context)

- [ ] Run development and automated tests in `tmp/feat-cluster-mesh-central-control-plane` only.
- [ ] Push the branch before each owner UAT checkpoint.
- [ ] Make the root checkout commit-identical to the branch HEAD before UAT; record source SHA and UAT SHA in this file.
- [ ] Run owner UAT from `/home/antoinefa/src/sentropic` with `ENV=dev` only after the owner confirms the root environment is available.
- [ ] Return to the branch worktree after each UAT checkpoint.
- [ ] Do not merge or remove `BRANCH.md` until final Gemini review and explicit owner GO.

## Plan / Todo (lot-based)

- [x] **Lot 0 — r13 baseline, source ledger and execution inventory**
  - [x] Namespace: N-A; type: read-only baseline and conductor gate preparation.
  - [x] Verify branch with `harness check branch`, record base SHA and run `make scope-check ENV=test-cluster-mesh-central-control-plane` before implementation.
    - [x] Evidence: branch `feat/cluster-mesh-central-control-plane`; base SHA `90c7f5c81f03a8cf9fab4e9e18cb0987455a6cc0`; harness `PASS C1`; scope `PASS C2`.
  - [x] Reconcile all 56 route files with `api/src/routes/api/index.ts`, `api/src/app.ts`, `api/src/routes/auth/index.ts`, `api/src/routes/well-known.ts` and `apps/auth-idp/idp-app.ts`.
    - [x] Evidence: 44 API files, 11 auth files and one well-known file; product mounts `/.well-known`, `/api/v1` and `/api/v1/auth`; IdP mounts `/.well-known` and `/api/v1/auth`.
  - [x] Confirm 29 namespace keys, current owners, target owners, legacy deletion locator and package semver impact.
    - [x] Evidence: the 29-row D13 inventory is reconciled; Lots 1–2 require minor bumps for `contracts`, `events` and `cluster-mesh`; legacy removals remain assigned to their cutover lots.
  - [x] Freeze the `mcp-broker` bypass locator as N-A because no reference exists in `api/src/**` or `api/package.json`; Lot 5 is the sole owner of the verified direct MCP-to-connector dispatch removal, and Lot 14 has no bypass-removal ownership.
  - [x] Confirm free migration ids public 0042/control 0007 and approve only `BR75-EX1`.
    - [x] Evidence: latest files are public `0041_track_owner_signatures.sql` and control `0006_arch11_outbox_tenant_rekey.sql`; no SQL is created in this leg.
  - [x] Reproduce h2a CURRENT A1/A2 failure counters without changing h2a and attach evidence to `BR75-SG1`.
    - [x] `BR75-SG1` evidence: pinned qualification records 0 central listeners, 44 per-session `mcp-serve` sidecars, `missing-registration`, `relanced:[]` and ghost presence; the build-host live snapshot found 0 central listener processes and 0 active sidecars, so 44 is retained as pinned qualification evidence rather than a live count.
  - [x] Archive a durable digest of the r13 dossier/route inventory needed by the build without modifying the dossier.
    - [x] Evidence: dossier SHA-256 `7e45fb1fb026e85f974ffaa79279745b6a0587af5ef7c9f55a58fb2747591fc3`; sorted route-path SHA-256 `9ee50300f4c4e2df6dbafdfb4770a4e9188d150a77932961264b1e34d2fb82d4`; route tree `1a395d0ebe704371bb9e74b80aa49660810f5d99`.
  - [x] Tests by file: N-A; this lot changes only plan/evidence text.
  - [x] Lot gate: `make scope-check ENV=test-cluster-mesh-central-control-plane`.
  - [x] Internal gates: C4 conductor-normalized provenance; C5 superseded synthesis language; D17 internal classification.

- [x] **Lot 1 — Neutral `VerifiedInvocationContext` and namespace module contracts**
  - [x] Namespace: shared socle; type: contract extraction.
  - [x] Add `packages/contracts/src/verified-invocation-context.ts`, `packages/contracts/src/cluster-mesh-namespace.ts` and neutral reference/port exports; update `packages/contracts/src/index.ts` and package version.
  - [x] Add `packages/events/src/invocation-receipt.ts` for transported/verified/acted stages, generation, correlation and idempotency; update exports/version.
  - [x] Keep every field secret-free and provider-neutral; do not import Cluster Mesh from contracts/events.
  - [x] Tests new: `packages/cluster-mesh/tests/verified-invocation-context.spec.ts` and `packages/cluster-mesh/tests/namespace-module-contract.spec.ts` using a synthetic injected context.
  - [x] API/UI/E2E tests: N-A; no application mount changes.
  - [x] Lot gate: `make typecheck-contracts build-contracts typecheck-events build-events ENV=test-cluster-mesh-central-control-plane`.
  - [x] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [x] Internal gates: C3 neutral injectable context; A5 standalone contract foundation.

- [x] **Lot 2 — Hono plugin, integrated runtime, registration and capacity socle**
  - [x] Namespace: shared socle; type: plugin/runtime implementation without app cutover.
  - [x] Add `packages/cluster-mesh/src/hono/plugin.ts`, `src/runtime/generation.ts`, `admission.ts`, `registration.ts`, `receipts.ts`, `namespace-registry.ts` and `src/config.ts`; export `createClusterMeshPlugin`.
  - [x] Implement `clusterMesh.capacity.maxConcurrent` default 12 and configurable `clusterMesh.capacity.poolSize` with pre-spawn reservation.
  - [x] Define preferred `PtyActuatorPort`, secondary fallback adapter selection and fail-closed registration reasons; do not implement a fake production PTY driver.
  - [x] Preserve `createDegenerateClusterMesh` only for current callers until their same-branch cutover; mark its removal locator.
  - [x] Tests new: `packages/cluster-mesh/tests/hono-plugin.spec.ts`, `packages/cluster-mesh/tests/generation.spec.ts`, `packages/cluster-mesh/tests/registration.spec.ts`, `packages/cluster-mesh/tests/capacity.spec.ts`, `packages/cluster-mesh/tests/namespace-registry.spec.ts`.
  - [x] Tests updated: `packages/cluster-mesh/tests/mesh.spec.ts` for coexistence only before cutover.
  - [x] API/UI/E2E tests: N-A; no application mount changes.
  - [x] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh pack-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [x] Internal gates: C3 provider-neutral runtime ports; A4 hermetic 12/13 pre-spawn proof; A5 plugin disableability partial.

- [ ] **Lot 3 — D6 runtime-internal MCP gateway and bypass removal**
  - [ ] Add `packages/mcp-platform/src/runtime-module.ts` to compose MCP session, consent, enrollment, elicitation, cancellation, and connector dispatch behind a neutral capability.
  - [ ] Add `packages/mcp-platform/src/http-ingress.ts` as an HTTP-neutral handler consumed by Cluster Mesh, not a second server/runtime owner.
  - [ ] Replace mock-only production defaults in `packages/mcp-platform/src/persistence.ts` and `stores.ts` with required injected durable ports; retain in-memory stores in testing exports only.
  - [ ] Evolve `packages/mcp-auth/src/core.ts` and `hono.ts` only where needed to return linked verified-principal references without moving OAuth/MCP semantics into Cluster Mesh.
  - [ ] Add `packages/cluster-mesh/src/providers/mcp.ts` and register the internal MCP module with `WorkspaceRuntime`.
  - [ ] Evolve `packages/connector-host/src/mount.ts` so effects require the invocation supervisor context and cannot resolve a workspace through an alternate route.
  - [ ] Move reusable private proof orchestration from `packages/mcp-broker/src/` into the internal MCP module, update package references, and delete `packages/mcp-broker` after the conformance gate.
  - [ ] Replace direct connector dispatch in `api/src/routes/api/mcp.ts` with MCP client → runtime HTTP → internal MCP module.
  - [ ] Add `packages/mcp-platform/tests/runtime-module.test.ts`, `http-ingress.test.ts`, and durable restart/cancel/elicitation tests.
  - [ ] Update `packages/mcp-auth/tests/core.test.ts` and `hono.test.ts` for linked references, audience, tenant, scope, DPoP, and fail-closed verifier status.
  - [ ] Update `packages/connector-host/tests/mount.test.ts` for required supervisor context and bypass refusal.
  - [ ] Replace `packages/mcp-broker/tests/broker.test.ts` with internal-module conformance coverage before deleting the package.
  - [ ] Update `api/tests/api/mcp-resource-server.test.ts` to prove HTTP first hop, auth-before-policy, workspace binding, consent, invocation receipt, streaming/cancellation, and no direct connector path.
  - [ ] Update `api/tests/unit/connector-host.test.ts` to prove effects cannot execute without a verified runtime command.
  - [ ] Lot gate: `make typecheck-mcp-auth test-mcp-auth build-mcp-auth typecheck-mcp-platform test-mcp-platform build-mcp-platform ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-connector-host test-connector-host build-connector-host ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-api SCOPE=mcp-resource-server.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-unit SCOPE=connector-host.test.ts ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 4 — D7 singular session authority and remote-control surface**
  - [ ] Add `packages/cluster-mesh/src/session/contracts.ts` with `LOCAL_ONLY`, `ADOPTING`, `APP_MANAGED`, and `DETACHING`, plus command/event/receipt/checkpoint/high-water contracts.
  - [ ] Add `packages/cluster-mesh/src/session/authority.ts` with fenced adopt/detach transitions and exactly one writer per `sessionId/homeEpoch`.
  - [ ] Add `packages/cluster-mesh/src/session/provider.ts` for host-local h2a session/terminal custody without moving PTY execution into the app.
  - [ ] Add `api/src/services/cluster-mesh/session-ledger.ts` and `session-inbox.ts` adapters; app ledger is canonical only in `APP_MANAGED` and host inbox/meta remain SQLite-first derived structures.
  - [ ] Add `api/src/routes/api/cluster-mesh.ts` session command/event/receipt/adopt/detach endpoints and register them in `api/src/routes/api/index.ts`.
  - [ ] Add `ui/src/lib/cluster-mesh/session-authority.ts` and `ui/src/lib/components/cluster-mesh/SessionAuthorityStatus.svelte`.
  - [ ] Update `ui/src/lib/chat/session-adapter.ts`, `ui/src/lib/stores/session.ts`, and `AppChatPanel.svelte` to present canonical/reconstructible versus explicitly ephemeral data truthfully.
  - [ ] Add `packages/cluster-mesh/tests/session-authority.spec.ts` and `session-recovery.spec.ts` for writer fencing, duplicate delivery, stale epochs, crash windows, high-water recovery, and detach/adopt.
  - [ ] Add `api/tests/api/cluster-mesh-session-authority.test.ts` for ledger atomicity, restart, ordered/duplicate/out-of-order events, local-only no-mirror, and app-managed command-before-effect.
  - [ ] Add `ui/tests/cluster-mesh/session-authority.test.ts` and update `ui/tests/chat/session-adapter.test.ts`, `ui/tests/stores/session.test.ts`, and `ui/tests/components/chat/AppChatPanel-session-state.test.ts`.
  - [ ] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-api lint-api test-api-api SCOPE=cluster-mesh-session-authority.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-ui lint-ui test-ui SCOPE=tests/cluster-mesh/session-authority.test.ts ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 5 — D4 domain persistence, PostgreSQL ledger, SQLite-first host stores, and migration**
  - [ ] Declare `CMCP-EX1`, generate exactly `api/drizzle/0042_cluster_mesh_control_plane.sql` plus required metadata, and do not add a second migration.
  - [ ] Evolve `api/src/db/control-schema.ts` and `schema.ts` for workspace bindings, policy revisions, invocation/outbox/receipts, app-managed session ledger, enrollment bindings, custody epochs, and security verifier status.
  - [ ] Add `packages/cluster-mesh/src/persistence/sqlite.ts` for host-local runtime, inbox/meta, replay, and local binding stores through an injected SQLite driver boundary.
  - [ ] Add `api/src/services/cluster-mesh/postgres.ts` for app-managed transactional stores and recovery queries.
  - [ ] Add `packages/cluster-mesh/src/persistence/mode-guard.ts` that rejects app mirroring for every `LOCAL_ONLY` domain.
  - [ ] Add `packages/cluster-mesh/tests/persistence-contract.spec.ts`, `sqlite-persistence.spec.ts`, and `mode-guard.spec.ts`.
  - [ ] Add `api/tests/unit/cluster-mesh-postgres.test.ts` and `api/tests/api/cluster-mesh-control-plane.test.ts` for commit/outbox/effect crash windows, restart, replay, retention boundaries, one writer, and local-only no-mirror.
  - [ ] Add migration forward/backward/empty/existing-data coverage to `api/tests/api/cluster-mesh-control-plane.test.ts` using the repository's migration harness.
  - [ ] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-api lint-api test-api-unit SCOPE=cluster-mesh-postgres.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-api SCOPE=cluster-mesh-control-plane.test.ts ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 6 — D8 existing h2a↔Graphify memory contract reuse**
  - [ ] Pin the published Graphify memory contract version and fixture digest; if absent, keep activation blocked and record the missing L0–L7 evidence.
  - [ ] Add `packages/cluster-mesh/src/providers/graphify-memory.ts` that maps neutral workspace/grant/activity inputs to the published Graphify port and returns provider-opaque receipt/cursor references.
  - [ ] Add `packages/cluster-mesh/tests/fixtures/graphify-memory-contract.json` from the published contract only; do not derive a substitute from internal Graphify source.
  - [ ] Add `packages/cluster-mesh/tests/graphify-memory-provider.spec.ts` for authorization mapping, activity-evidence boundary, final revalidation refusal, cursor/receipt persistence, unavailable provider, and contract digest mismatch.
  - [ ] Prove Cluster Mesh stores no canonical episode, graph/vector projection, ranking score, or Graphify rebuild state.
  - [ ] Prove `LOCAL_ONLY` Graphify SQLite has no app mirror and managed PostgreSQL is selected only by the Graphify provider mode.
  - [ ] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: activation remains fail closed if the external release gate is unmet; fixture-only compatibility is an acceptable branch outcome and must be reported as such, not called production memory.

- [ ] **Lot 7 — D11/D12 shared connector and LLM enrollments**
  - [ ] Add `packages/cluster-mesh/src/enrollment/binding-registry.ts` with non-secret descriptor bindings, global-then-workspace policy, singular custodian, reachability, revision, and epoch.
  - [ ] Evolve `packages/mcp-platform/src/runtime.ts`, `stores.ts`, and `durable.ts` for per-host and shared connector instances under explicit workspace consent/grant/revocation bindings.
  - [ ] Evolve `packages/llm-mesh/src/enrollment/contracts.ts`, `routing-policy.ts`, `account-transports.ts`, and `service/facade.ts` so LLM Mesh is the single enrollment authority with global then workspace policy.
  - [ ] Evolve `packages/llm-gateway/src/ports/caller-auth.ts` and `authz.ts` to require the verified runtime context for shared-account dispatch.
  - [ ] Convert `api/src/services/llm-account-transports.ts` to a persistence/custody adapter and remove parallel provider enrollment/routing semantics.
  - [ ] Add enrollment endpoints to `api/src/routes/api/cluster-mesh.ts` without exposing raw secrets.
  - [ ] Add `packages/cluster-mesh/tests/enrollment-binding-registry.spec.ts` for reachability, revision, epoch, global/workspace precedence, and fenced custody transfer.
  - [ ] Update `packages/mcp-platform/tests/durable.test.ts`, `authz.test.ts`, and `secrets.test.ts` for both instance modes, PoP, revocation, and no token copying.
  - [ ] Update `packages/llm-mesh/tests/enrollment/contracts.test.ts`, `routing-policy.test.ts`, `account-transports.test.ts`, and `service/facade.test.ts` for one authority and one custodian.
  - [ ] Update `packages/llm-gateway/tests/caller-ownership.test.ts` and `passthrough.test.ts` for verified binding/custody context and alternate-path refusal.
  - [ ] Update `api/tests/unit/llm-account-transports.test.ts` and add `api/tests/api/cluster-mesh-enrollment.test.ts` for metadata migration, reauthentication, reachability truth, revocation, and fenced transfer.
  - [ ] Lot gate: `make typecheck-mcp-platform test-mcp-platform build-mcp-platform ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-llm-mesh test-llm-mesh build-llm-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-llm-gateway test-llm-gateway build-llm-gateway ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-unit SCOPE=llm-account-transports.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-api SCOPE=cluster-mesh-enrollment.test.ts ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 8 — D5/D10 linked-principal security and deny-before-profile gates**
  - [ ] Add `packages/cluster-mesh/src/security/linked-principal.ts` to join already verified product identity, NHI, mandate, workspace binding, custody, policy revision, and reachability references.
  - [ ] Add `packages/cluster-mesh/src/security/message-verifier.ts` as a profile-neutral verifier/replay/revocation port; adapt the current h2a Ed25519 fixture without blessing it as the normative profile.
  - [ ] Add durable replay and revocation adapters to `packages/cluster-mesh/src/persistence/sqlite.ts` and `api/src/services/cluster-mesh/postgres.ts`.
  - [ ] Require verify-before-act in `invocation-supervisor.ts` for audience, workspace, action/scope, mandate time/depth, policy/binding revision, epoch, replay, revocation, custody, and reachability.
  - [ ] Keep remote actionable capabilities disabled behind an explicit fail-closed capability gate until the separate D10 wire-profile decision and vectors are accepted.
  - [ ] Add `packages/cluster-mesh/tests/linked-principal.spec.ts`, `message-verifier.spec.ts`, and `security-negative-vectors.spec.ts`.
  - [ ] Add negative vectors for wrong audience/workspace, over-broad action, expired/revoked mandate, replay, stale epoch/revision, ambiguous custody, unreachable custodian, unknown verifier status, and courier-only proof.
  - [ ] Update `packages/mcp-auth/tests/core.test.ts` and `service-auth.test.ts` for the OAuth/MCP half of the normative join without adding NHI semantics to MCP Auth.
  - [ ] Add `api/tests/unit/cluster-mesh-security.test.ts` for durable restart/replay/revocation and zero-effect rejection.
  - [ ] Lot gate: `make typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make typecheck-mcp-auth test-mcp-auth build-mcp-auth ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-api-unit SCOPE=cluster-mesh-security.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Lot gate: `make test-security-sast ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 9 — D9 reverse ArchitectureView and components into Focus/design system**
  - [ ] Add `packages/focus/src/architecture/model.ts` with renderer-neutral scene/node/edge/port/status/overlap contracts.
  - [ ] Add `packages/focus/src/architecture/routing.ts` by capitalizing the accepted deterministic orthogonal router and removing decision-specific scene knowledge.
  - [ ] Add `packages/focus/src/architecture/verify.ts` for deterministic overlap and manifest evidence.
  - [ ] Add `packages/focus/src/svelte/ArchitectureView.svelte`, `ArchitectureNode.svelte`, and `ArchitectureEdge.svelte` using published design-system primitives/tokens and XYFlow as optional peer UI dependencies.
  - [ ] Update `packages/focus/src/index.ts`, package subpath exports, README, peer dependencies, build/typecheck/test scripts, and semver.
  - [ ] Add `packages/focus/tests/architecture-model.spec.ts`, `architecture-routing.spec.ts`, `architecture-manifest.spec.ts`, and `architecture-view.dom.spec.ts`.
  - [ ] Use neutral/golden fixtures only; do not copy r8 decision prose/options/scenes into the public package.
  - [ ] Prove deterministic output, all accepted golden edge/label overlap counters at zero, keyboard/ARIA semantics, square-card DS styling, and stable server-side import without optional UI peers.
  - [ ] Prove the canonical Sentropic Focus package can replace the duplicate h2a package through a packed-artifact compatibility check without editing h2a.
  - [ ] Lot gate: `make typecheck-focus test-focus build-focus ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 10 — Integrated API/UI/E2E validation and owner UAT**
  - [ ] Add `e2e/tests/13-cluster-mesh-control-plane.spec.ts` with independent scenarios for minimum h2a capability, MCP first hop, app-managed session adopt/restart/detach, local-only no-mirror, connector enrollment, LLM custody, and security denial.
  - [ ] Add `ui/tests/cluster-mesh/control-plane.test.ts` for authority/custody/reachability state presentation and command disabling when verification is incomplete.
  - [ ] API scoped gate: `make test-api-api SCOPE=cluster-mesh-control-plane.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] API scoped gate: `make test-api-api SCOPE=cluster-mesh-session-authority.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] API scoped gate: `make test-api-api SCOPE=cluster-mesh-enrollment.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] UI scoped gate: `make test-ui SCOPE=tests/cluster-mesh/control-plane.test.ts ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Prepare E2E: `make build-api build-ui-image API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-cluster-mesh-central-control-plane`.
  - [ ] E2E scoped gate: `make test-e2e E2E_SPEC=tests/13-cluster-mesh-control-plane.spec.ts API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 ENV=e2e-cluster-mesh-central-control-plane`.
  - [ ] Push the exact candidate SHA and record it before UAT.
  - [ ] Owner UAT — minimum h2a: invoke the declared read-only capability and verify the UI/API evidence shows workspace binding, policy revision, provider, correlation, and receipt.
  - [ ] Owner UAT — MCP: use an MCP client through runtime HTTP, revoke its grant, and confirm the next call is refused before connector execution.
  - [ ] Owner UAT — `LOCAL_ONLY`: create and use a local session, inspect the app, and confirm no transcript/journal/payload projection or remote-control affordance exists.
  - [ ] Owner UAT — `APP_MANAGED`: adopt a session, issue an app and terminal command, restart the host delivery process, verify recovery/no duplicate effect, then detach and verify stale app commands are fenced.
  - [ ] Owner UAT — enrollment: exercise one per-host connector, one shared connector, and one local-custody LLM account; verify scope, reachability, custody, revocation, and no secret-copy prompt/path.
  - [ ] Owner UAT — memory: verify the Graphify capability is active only when the pinned release gate passes; otherwise verify the explicit fail-closed unavailable state.
  - [ ] Owner UAT — ArchitectureView: inspect representative current/target/transition scenes for deterministic layout, no node/label overlap, DS visual consistency, keyboard navigation, and readable narrow viewport behavior.
  - [ ] Record owner UAT result and exact candidate SHA; any fix invalidates sign-off and requires a new push/UAT cycle.

- [ ] **Lot 11 — Documentation and package consolidation**
  - [ ] Update package READMEs with current versus target/shipped truth, authority modes, integration examples, removal notes, and security gates.
  - [ ] Update `spec/SPEC_EVOL_CLUSTER_MESH_CENTRAL_CONTROL_PLANE.md` only for implementation evidence and accepted clarifications; do not silently change owner decisions.
  - [ ] Record package versions, packed artifact digests, Graphify contract status, h2a compatibility result, migration identifier, and all legacy path removals in this file.
  - [ ] Verify each changed `packages/*/src/**` package has the required semver bump and publication dependency ordering.
  - [ ] Verify no temporary compatibility package, fallback route, copied secret, dossier-specific Focus API, or application mirror of local-only data remains.
  - [ ] Lot gate: `make scope-check ENV=test-cluster-mesh-central-control-plane`.

- [ ] **Lot 12 — Independent Gemini review, final validation, and owner GO**
  - [ ] Run independent Gemini 3.7 max review after implementation; reviewer must not be the Codex 5.6 Sol max builder.
  - [ ] Require Gemini to inspect the accepted r8 evidence, spec, plan, complete diff, schema/migration, current-path deletions, and test evidence.
  - [ ] Require Gemini to challenge the D1/D3 stopping rule, D4 no-mirror proof, D6 single ingress, D7 writer fencing, D8 external gate truth, D10 no-profile boundary, D11/D12 singular custody, and D9 Focus packaging.
  - [ ] Reconcile every Gemini finding in this file as fixed, rejected with evidence, deferred by owner, or blocking.
  - [ ] Final type/lint gate: `make typecheck lint ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final package gate: `make typecheck-contracts build-contracts typecheck-events build-events typecheck-cluster-mesh test-cluster-mesh build-cluster-mesh ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final MCP gate: `make typecheck-mcp-auth test-mcp-auth build-mcp-auth typecheck-mcp-platform test-mcp-platform build-mcp-platform typecheck-connector-host test-connector-host build-connector-host ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final LLM gate: `make typecheck-llm-mesh test-llm-mesh build-llm-mesh typecheck-llm-gateway test-llm-gateway build-llm-gateway ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final Focus gate: `make typecheck-focus test-focus build-focus ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final API gate: `make test-api ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final UI gate: `make test-ui ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Final E2E matrix gate: `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 E2E_GROUP=00,01,02 ENV=e2e-cluster-mesh-central-control-plane`.
  - [ ] Final E2E matrix gate: `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 E2E_GROUP=03,04,05 ENV=e2e-cluster-mesh-central-control-plane`.
  - [ ] Final E2E matrix gate: `make clean test-e2e API_PORT=8788 UI_PORT=5174 MAILDEV_UI_PORT=1084 E2E_GROUP=06 ENV=e2e-cluster-mesh-central-control-plane`.
  - [ ] Final security gate: `make test-security ENV=test-cluster-mesh-central-control-plane`.
  - [ ] Record any AI-flaky signatures and obtain explicit owner sign-off for each accepted case.
  - [ ] Run `make scope-check ENV=test-cluster-mesh-central-control-plane` and `harness check scope` on the final diff.
  - [ ] Create or update the PR using this `BRANCH.md` as its source-of-truth body; push and verify branch CI.
  - [ ] Present the reconciled review, CI, UAT, external gates, and exact HEAD SHA to the owner.
  - [ ] Obtain explicit owner GO; nothing is merged before this checkbox is complete.
  - [ ] Only after owner GO, commit removal of `BRANCH.md`, push, and execute the separately authorized merge lifecycle.

## Questions / Notes

- [ ] Gemini review point: does the D1 stopping rule keep provider protocol/domain semantics out of the core while still eliminating every effectful bypass?
- [ ] Gemini review point: are h2a and Graphify publication/consumer gates truthful enough to prevent this one Sentropic branch from claiming external cutover?
- [ ] Gemini review point: does every D4 domain have exactly one writer and does every `LOCAL_ONLY` path prove absence of an app mirror?
- [ ] Gemini review point: is the D7 app-ledger/host-inbox split sufficient for transcript, journal, payload, raw PTY, crash-window, and adopt/detach semantics?
- [ ] Gemini review point: does D6 fully internalize MCP Platform/Auth while retaining MCP authorship and deleting direct API/broker dispatch?
- [ ] Gemini review point: does the one-migration schema avoid duplicating current chat, connector, and LLM account authority?
- [ ] Gemini review point: do D11/D12 preserve one custodian per account/epoch and prohibit secret copying during transfer?
- [ ] Gemini review point: does D10 implement all deny gates without implicitly selecting or standardizing the current h2a Ed25519 wire format?
- [ ] Gemini review point: is the Focus extraction genuinely renderer-neutral, reusable, design-system based, and free of dossier-specific public API?
- [ ] Owner gate: review acceptance does not authorize merge; explicit owner GO remains mandatory.
