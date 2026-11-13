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
- [x] Track single writer: conductor imports this plan and lane report; this lane does not mutate the shared journal.
- [ ] Verify delivered agent wire format against freeze; document discrepancies and bounded consumer handoffs.

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
- [ ] Lot 2: Ed25519 tickets, ownership/devScope, identity/provenance pin and idempotent lifecycle.
  - [x] Add mTLS configuration/transport, canonical Ed25519 tickets and pinned identity/export verification.
- [ ] Lot 3: one-node heartbeat, bounded tenant WFQ, stateless sources and custody issuer/revocation.
  - [x] Dedicated Postgres advisory-lock heartbeat leadership and S1-C1 EdDSA custody issuing/revocation functions.
  - [x] Bounded quantum-one tenant queue, concurrent head-read coalescing and retained-export-upload-delete client cycle.
- [ ] Lot 4: hermetic fake agent tests in api/tests/unit/execution-node*.test.ts; backend rollback regression.
- [ ] Lot 5: targeted make tests, API typecheck/lint, independent review and fixes.
- [ ] Lot 6: push, PR body from BRANCH.md, green exact-head CI; write .tmp/rv/s1-b0a-adapter.md and .done.
- [ ] Cleanup: make down-volumes ENV=feat-s1-b0a; no merge or deployment.
