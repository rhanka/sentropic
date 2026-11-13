# Feature: S1-B0a ExecutionNodeV1 API adapter

## Objective
Implement S1-B0a and its heartbeat, custody and ownership addendum. Preserve the Kubernetes rollback backend; no deployment or VM access.

## Scope / Guardrails
- [x] Worktree tmp/worktrees/s1-b0a; branch feat/s1-b0a-execution-node-adapter mechanically checked with harness.
- [x] Approved design: .tmp/builder-dossier/dossier-consolide.md and spec/SPEC_EVOL_SANDBOX_NODE.md.
- [x] Make-only, Docker-first; ENV=feat-s1-b0a last; API_PORT=9085 UI_PORT=5285 MAILDEV_UI_PORT=1185 checked free.
- [x] No secrets printed; no VM, cluster, deployment or merge.
- [x] Atomic commits below 150 changed lines, specific staging, make commit only.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/**`
  - `api/tests/**`
  - `api/src/config*`
  - `api/Dockerfile` (BRB0A-EX1)
  - `Makefile` (BRB0A-EX4: API_VERSION inputs only)
  - `apps/sandbox-node/**` (BRB0A-EX5)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `apps/artifact-content/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record BRB0A-EXn rationale, impact and rollback before an exception.

## Feedback Loop
- [x] BRB0A-EX5: Round 2 explicitly authorizes agent data-plane, provenance and tests. Impact: new agent archive requires operator qualification/install before G-A. Rollback: keep execution-node disabled and use Kubernetes.
- [x] BRB0A-EX4: hash the sandbox-node source copied by BRB0A-EX1 into API_VERSION. CI run 43435868900 caught the omitted input. Impact: source changes now invalidate the API image tag; no workflow or runtime change. Rollback: remove this input together with the EX1 COPY.
- [x] BRB0A-EX1: copy sandbox-node into the API tooling source stage so API type imports and hermetic contract tests use the actual normative agent code. Impact: one source COPY, no runtime activation or dependency change. Rollback: remove this COPY with the adapter tests/types.
- [x] BRB0A-EX2: deliver the already-frozen sandbox GET needed to resume natural-stop/export/upload failures without mutating state blindly. Impact: authenticated control-plane tenant status only; k8s must deploy a new agent artifact before use. Rollback: revert these two agent-file changes and keep node backend disabled.
- [x] BRB0A-EX3: allow an identical stop command returning 202 to recheck cgroup quiescence. Impact: the same authenticated method/path/body can progress stopping; mismatched replay still refuses before side effects. Rollback: revert daemon stop changes and keep node backend disabled pending agent correction.
- [x] Track single writer: conductor imports this plan and lane report; this lane does not mutate the shared journal.
- [x] Verify delivered agent wire format against freeze; document discrepancies and bounded consumer handoffs.
  - [x] Fix explicit Content-Length for DELETE JSON; hermetic listener accepts both loopback families; sanitize synchronous TLS failures.

## AI Flaky tests
- [x] No AI provider tests needed for the hermetic contract.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent code review after local validation.

## UAT Management (in orchestration context)
- [x] Hermetic qualification only; Focus live/publish is S1-B1 and warm claim/L4 is S1-B2.

## Plan / Todo (lot-based)
- [ ] Round 2: publish Custody RPC contract, implement authoritative authenticated issue/watch-poll and agent HTTP/WS custody enforcement.
  - [x] Agent HTTP/WS proxy authenticates custody JWS, tenant, UID, principal, epoch and port; attaches revocable streams.
  - [x] Wire real listener and sandbox-private runsc UDS forwarding, preserving network=none confinement.
  - [x] Implement body-bound HMAC RPC and authoritative durable runtime/allocation resolution on issue and watch.
  - [x] Mount RPC in selected-node API composition and reject allocations with pending creation, revocation or removal.
- [ ] Round 2: fix review findings 2-7 with persisted controller export recovery and bounded heartbeat leadership.
  - [x] Capture ticket clock once; bind signed export to physical UID, attempt, source and command; restrict production agent copy to its type contract.
  - [x] Bound heartbeat pool acquisition/queries/node calls; destroy failed leadership connections and abort outstanding HTTPS requests on lock loss.
  - [x] Separate durable export destination from fresh upload authorization; checkpoint upload and reconcile lost DELETE responses.
  - [x] Persist export intent/progress/candidate in the backend; retain output and pending host job when export transport fails.
  - [x] Resume retained exports through controller reconcile after process replacement, preserving publication and source fences.
  - [x] Update lifecycle contracts/tests to durable destination and fresh control-plane upload authorization.
- [ ] Round 2: hermetic real-agent/RPC E2E, archive SHA256SUMS, exact-head green CI and report.
  - [x] Extend hermetic fixture with actual agent data-plane handlers and independent mTLS identities.
  - [x] Add real HTTP custody RPC harness using production mount/authenticator and durable allocation authority.
- [x] Lot 0: read packet/addendum/rules/frozen contract; check existing branch, disk and ports.
- [x] Lot 1: SandboxBackend seam, execution-node configuration and authenticated HTTPS transport.
  - [x] Select backend explicitly, preserve default Kubernetes composition, inject selected ports into existing controller.
  - [x] Do not initialize the Kubernetes client when execution-node is selected.
  - [x] Broad rollback regression identified relay validation precedence; retain the original relay refusal before Kubernetes client validation.
  - [x] Concrete node backend implements lifecycle pods/renew/quiesce, persisted identities and deterministic command ids; B1 supplies sealed-base/W3 inputs.
  - [x] Compose the concrete node backend by default; missing B1 hydration inputs refuse allocation without disabling the authenticated route mount.
  - [x] Connect stateless forge/head coalescing and verified retained export into the selected backend; node mode never uses the codeload staging provider.
  - [x] Preserve existing Kubernetes clean semantics while allowing a node clean to return a fresh physical UID, persisted with a new route fence before build/wake.
  - [x] Persist create intent before dispatch and replay it to reconcile uncertain creation; missing allocation rows are safe to remove. Replace stopped physical sandboxes on clean.
  - [x] Use explicit persisted closed tombstones (Postgres undefined means no write), and close definitive 4xx creation refusals; fake rows now match the real store semantics.
  - [x] Persist the attempted-dispatch boundary atomically before I/O; a later 4xx cannot discard an allocation with an earlier uncertain outcome.
  - [x] Preserve the narrowed immutable pending spec across the persisted dispatch-boundary write.
  - [x] Persist revocation intent before the remote mutation; reconcile only that exact custody epoch and preserve stable removal command ids after lost responses.
  - [x] Refuse provisioning whose tenant/principal/generation/session does not match authenticated runtime inputs.
- [x] Lot 2: Ed25519 tickets, ownership/devScope, identity/provenance pin and idempotent lifecycle.
  - [x] Add mTLS configuration/transport, canonical Ed25519 tickets and pinned identity/export verification.
  - [x] Refuse incomplete ownership and verify configured node identity before the first heartbeat or tenant command.
  - [x] Add tenant-checked presigned base import; transport deadlines cover frozen base/stop/admission operations without changing test timeouts.
  - [x] Verify the supplied public provenance key's SPKI DER fingerprint against the operator handoff for instance 7c710995-cfa9-4e2f-8cad-61706f83d933.
- [x] Lot 3: one-node heartbeat, bounded tenant WFQ, stateless sources and custody issuer/revocation.
  - [x] Dedicated Postgres advisory-lock heartbeat leadership and S1-C1 EdDSA custody issuing/revocation functions.
  - [x] Product scheduler starts/stops selected-node leadership; identity mismatch latches an alarm and stops the loop.
  - [x] Bounded quantum-one tenant queue, concurrent head-read coalescing and retained-export-upload-delete client cycle.
  - [x] Tenant-specific BHS SigV4 presigned URLs; credentials remain in the API closure.
- [x] Lot 4: hermetic fake agent tests in api/tests/unit/execution-node*.test.ts; backend rollback regression.
  - [x] Native in-memory X.509 fixture and hermetic HTTPS server wrapping real agent dispatch/ticket/custody code.
  - [x] Contract tests cover heartbeat expiry, replay, ownership, lifecycle, tenant/scope refusal, admission and custody.
  - [x] Policy tests cover bounded alternation, fresh head coalescing, lazy rollback, BHS prefixes and heartbeat leadership.
  - [x] Add regressions for natural build exit, retry after failed S3 upload, invalid ticket signatures, both tenants and failed lock acquisition.
  - [x] Extend artifacts-live/product-builder.test.ts to assert configured-node composition does not initialize Kubernetes or query DB at boot.
  - [x] Concrete backend tests cover persisted physical identity, real agent lifecycle, tenant-bound provisioning and connected observeHead coalescing.
  - [x] Controller regression asserts replacement UID and route fence are durable before worker preparation and live exposure.
  - [x] Regress fresh wake replacement, absent-allocation cleanup, lost creation/revocation responses and 202 stop progression.
  - [x] Keep fault-injection clients on the fake node's explicit clock so custody freshness is exercised deterministically.
- [x] Lot 5: targeted make tests, API typecheck/lint, independent review and fixes.
  - [x] Independent owner-routed Astra review findings reconciled in .tmp/rv/s1-b0a-review.md; no multi-host h2a consensus claimed.
  - [x] Final local gates: 60 files / 512 live+rollback+adapter tests pass, including 31 hermetic adapter tests; 30 targeted agent tests pass. Full API typecheck and scoped lint pass in ephemeral containers.
  - [x] Document preprod Secret names, heartbeat leadership, S1-C1 issuer and explicit S1-B1/agent handoffs in execution-node.md.
- [ ] Lot 6: push, PR body from BRANCH.md, green exact-head CI; write .tmp/rv/s1-b0a-adapter.md and .done.
- [x] Cleanup: down-volumes refused the packet's feat-* ENV by its test-only guard; make down succeeded. No Compose stack/volume was created; ephemeral --rm runners only. disk-hygiene reclaimed 0B. No merge/deployment.
