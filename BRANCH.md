# Feature: MCP provider platform scaffold (mock-only, slices 1+2)

## Objective
Deliver a PRIVATE, unpublished, reversible mock-only scaffold of the generic Sentropic/STP MCP provider platform: slice 1 (manifest/adapter closed schemas as concrete TypeScript) + slice 2 (mock OIDC + mock MCP harness + per-request authz middleware stub + contract/isolation tests). Source: `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` (track `01KW2MHER6QE9WRW3SAJCNH3T8`), §12 slices 1-2.

## Scope / Guardrails
- Scope limited to a new PRIVATE package `packages/mcp-platform/**` + the copied spec + this `BRANCH.md`.
- Package MUST be `"private": true`; NOT added to any publish filter, CI publish list, Makefile target, or trusted-publisher config. No npm publish.
- MUST NOT be added to the root `package-lock.json` / activated via root `npm install` (= P1 package activation, architect/owner-gated). Root `package.json` / `package-lock.json` untouched in this branch. Verify only via the package's own ephemeral toolchain. (Fix F9)
- MOCK-ONLY: mock OIDC issuer + mock MCP client/server; no real network, no prod credentials, no real Claude.ai dependency, no `mcp-wave` coupling, no immo special-casing.
- No production code paths, no DB, no secrets in code/tests/logs.
- Generic platform only (Wave/immo are consumers/examples, not baked in).
- Make-only workflow; `ENV=<env>` last in any `make` command (none needed — in-memory mocks only).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-platform/**`
  - `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - any other `packages/*/**`, `api/**`, `ui/**`, `e2e/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- F9 (doc-only): package intentionally NOT in root `package-lock.json`; root-install/activation is P1, architect/owner-gated. Owner: architect/owner. Status: parked (P1). No root lock/`package.json` change in this branch.
- F8 (parked): the FINAL canonical `ElicitationPolicy` shape is architect-gated; strengthened provisionally only (§5 typed request/response + §5.2(b) secret-safety). Owner: architect. Status: parked.

## AI Flaky tests
- Not applicable: all tests are deterministic in-memory mocks (no AI/provider/network calls).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch**
- Rationale: single orthogonal scaffold; one isolated package, one test cycle.

## UAT Management (in orchestration context)
- No UI/E2E surface. Real Claude.ai/MCP-client validation is UAT (spec §11), deferred to the owner; not a CI dependency.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, the spec, `plan/BRANCH_TEMPLATE.md`.
  - [x] Create isolated worktree `tmp/mcp-platform-scaffold` on `feat/mcp-platform-scaffold`.
  - [x] Confirm package conventions from existing `packages/*` (package.json/tsconfig/tests layout).
  - [x] Confirm scope and guardrails; copy spec into worktree.
  - [x] Scaffold private package (`package.json` private+unpublished, `tsconfig.json`, `README.md`, `LICENSE`).

- [x] **Lot 1 — Slice 1: manifest & adapter closed schemas**
  - [x] `src/manifest.ts` — `AppMcpProviderManifest`, capability schemas, gates, freshness, idempotency, secret requirement, tenant resolution/context.
  - [x] `src/runtime.ts` — `StpConnectorContext` (audited `getSecret`), `AppConnectorProviderAdapter`, envelopes, `DurableCallRef`, session/consent/enrollment/secret records, visibility states.
  - [x] `src/index.ts` — public re-exports.
  - [x] Lot gate:
    - [x] tests: `tests/manifest.test.ts` — closed read-only exceptions + sample manifest typecheck.

- [x] **Lot 2 — Slice 2: mock harness + middleware + tests**
  - [x] `src/mock/oidc.ts` — in-memory mock OIDC issuer (EdDSA JWT, JWKS, sub/aud/scope/auth_time/tid, revocation list).
  - [x] `src/mock/mcp-transport.ts` — in-memory mock MCP client/server transport with per-session client binding.
  - [x] `src/mock/fake-connector.ts` — app-neutral fake connector adapter fixture.
  - [x] `src/audit.ts` — in-memory audit sink + redaction.
  - [x] `src/context.ts` — `StpConnectorContext` factory with audited secret accessor.
  - [x] `src/elicitation.ts` — fail-closed elicitation state machine.
  - [x] `src/authz.ts` — per-request authz middleware: audience-bound token verify, principal+tenant from token only, per-capability scope + freshness, deny-as-missing discovery, mutation gating.
  - [x] Lot gate (tests):
    - [x] `tests/oidc.test.ts` — issue/verify, audience binding, issuer mismatch, revocation.
    - [x] `tests/authz.test.ts` — cross-tenant denial; deny-as-missing discovery; fail-closed ambiguous mapping; revoked/missing consent; max_age fresh/stale step-up; insufficient_scope; token no-passthrough.
    - [x] `tests/elicitation.test.ts` — resume/cancel/timeout/denied + NHI fail-closed + sub-match anti-phishing.
    - [x] `tests/secrets.test.ts` — no-secret-in-logs.
    - [x] `tests/writes.test.ts` — write-tool requires gate + idempotency + audit.

- [x] **Lot R — Double-consensus review fixes (Codex BLOCK + Opus SHIP-WITH-NITS)**
  - [x] F1 — tenant fail-closed on zero enrollment (`authz.ts`: empty authorized set → `no_enrollment`, no broad fallback) + test.
  - [x] F2 — required claims enforced at invocation (`authz.ts` `missing_claims`; mock OIDC mints custom claims) + test.
  - [x] F3 — elicitation client binding (`elicitation.ts`: completer.client MUST match actor.client) + test.
  - [x] F4 — NHI delegation never self-declared (`elicitation.ts`: trusted injected `DelegationResolver`; default fail-closed) + tests; fixed the prior insecure accept test.
  - [x] F5 — `advance()` cannot bypass §5.2 (only `requested→rendered`; later hops via `answer/validate/resume`) + test.
  - [x] F6 — mutation gate non-fungible (`guard.ts`: gate bound to capability + session + principal; replay denied) + tests.
  - [x] F7 — token no-passthrough structural (`mcp-transport.ts`: bearer consumed at boundary, handler gets `SanitizedMcpRequest`) + tests; strengthened authz structural test.
  - [x] F8 — `ElicitationPolicy` strengthened provisionally + `elicitationPolicyIsSecretSafe` + architect-gated park note + test.
  - [x] F9 — doc-only root-lock/activation note (README + BRANCH.md); root `package.json`/`package-lock.json` untouched.

- [x] **Lot N — Gates**
  - [x] `tsc --noEmit` for the package — PASS (no Makefile target for a private package; ran package's own tsc 5.4.5 in an ephemeral temp toolchain, nothing installed in repo/global).
  - [x] package vitest — PASS, 55/55 across 7 files (oidc 7, authz 14, elicitation 12, secrets 4, writes 9, transport 4, manifest 5); all deterministic in-memory.
  - [ ] DO NOT push, DO NOT open PR (conductor runs double-consensus review before any merge).
