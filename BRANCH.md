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
  - `apps/sandbox-node/src/api.ts` (BRB0A-EX2)
  - `apps/sandbox-node/src/service.ts` (BRB0A-EX2)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `apps/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Record BRB0A-EXn rationale, impact and rollback before an exception.

## Feedback Loop
- [x] BRB0A-EX1: copy sandbox-node into the API tooling source stage so API type imports and hermetic contract tests use the actual normative agent code. Impact: one source COPY, no runtime activation or dependency change. Rollback: remove this COPY with the adapter tests/types.
- [x] BRB0A-EX2: deliver the already-frozen sandbox GET needed to resume natural-stop/export/upload failures without mutating state blindly. Impact: authenticated control-plane tenant status only; k8s must deploy a new agent artifact before use. Rollback: revert these two agent-file changes and keep node backend disabled.
- [x] Track single writer: conductor imports this plan and lane report; this lane does not mutate the shared journal.
- [ ] Verify delivered agent wire format against freeze; document discrepancies and bounded consumer handoffs.
  - [x] Fix explicit Content-Length for DELETE JSON; hermetic listener accepts both loopback families; sanitize synchronous TLS failures.

## AI Flaky tests
- [x] No AI provider tests needed for the hermetic contract.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent code review after local validation.

## UAT Management (in orchestration context)
- [x] Hermetic qualification only; Focus live/publish is S1-B1 and warm claim/L4 is S1-B2.

## Plan / Todo (lot-based)
- [x] Lot 0: read packet/addendum/rules/frozen contract; check existing branch, disk and ports.
- [ ] Lot 1: SandboxBackend seam, execution-node configuration and authenticated HTTPS transport.
  - [x] Select backend explicitly, preserve default Kubernetes composition, inject selected ports into existing controller.
  - [x] Do not initialize the Kubernetes client when execution-node is selected.
  - [x] Concrete node backend implements lifecycle pods/renew/quiesce, persisted identities and deterministic command ids; B1 supplies sealed-base/W3 inputs.
  - [x] Compose the concrete node backend by default; missing B1 hydration inputs refuse allocation without disabling the authenticated route mount.
- [ ] Lot 2: Ed25519 tickets, ownership/devScope, identity/provenance pin and idempotent lifecycle.
  - [x] Add mTLS configuration/transport, canonical Ed25519 tickets and pinned identity/export verification.
  - [x] Refuse incomplete ownership and verify configured node identity before the first heartbeat or tenant command.
- [ ] Lot 3: one-node heartbeat, bounded tenant WFQ, stateless sources and custody issuer/revocation.
  - [x] Dedicated Postgres advisory-lock heartbeat leadership and S1-C1 EdDSA custody issuing/revocation functions.
  - [x] Product scheduler starts/stops selected-node leadership; identity mismatch latches an alarm and stops the loop.
  - [x] Bounded quantum-one tenant queue, concurrent head-read coalescing and retained-export-upload-delete client cycle.
  - [x] Tenant-specific BHS SigV4 presigned URLs; credentials remain in the API closure.
- [ ] Lot 4: hermetic fake agent tests in api/tests/unit/execution-node*.test.ts; backend rollback regression.
  - [x] Native in-memory X.509 fixture and hermetic HTTPS server wrapping real agent dispatch/ticket/custody code.
  - [x] Contract tests cover heartbeat expiry, replay, ownership, lifecycle, tenant/scope refusal, admission and custody.
  - [x] Policy tests cover bounded alternation, fresh head coalescing, lazy rollback, BHS prefixes and heartbeat leadership.
- [ ] Lot 5: targeted make tests, API typecheck/lint, independent review and fixes.
  - [x] 17 hermetic tests pass; full API typecheck and scoped lint pass with workspace declarations built in an ephemeral container.
  - [x] Document preprod Secret names, heartbeat leadership, S1-C1 issuer and explicit S1-B1/agent handoffs in execution-node.md.
- [ ] Lot 6: push, PR body from BRANCH.md, green exact-head CI; write .tmp/rv/s1-b0a-adapter.md and .done.
- [ ] Cleanup: make down-volumes ENV=feat-s1-b0a; no merge or deployment.
