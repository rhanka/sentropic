# Feature: BR-72 DEPTH Lot 2 — minimal connector-agnostic broker package

## Objective
Generalize the Lot-1 mount+invoke seam into a private `@sentropic/mcp-broker` proof package: a connector-agnostic `ConnectorRegistry` + `McpProviderBroker.invoke(connectorId, capabilityRef, input)` over any `AppConnectorProviderAdapter`, with an injectable in-memory `StpConnectorContext` (the seam a real EnrollmentStore PORT replaces). Proven live by mounting the github live adapter and invoking it through the generic broker against real api.github.com.

## Scope / Guardrails
- Scope limited to `packages/mcp-broker/**` + its Makefile targets.
- Connector-AGNOSTIC: no connector-specific logic in registry/broker/context; the github adapter is imported ONLY by the live smoke.
- In-memory context is an injection point; does NOT pre-empt architect's authz.ts EnrollmentStore/TenantResolver PORT.
- Private package (`"private": true`), NOT published. Production residence (architect D4) deferred.
- Make-only / Docker. English. Never log secrets.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**:
  - `packages/mcp-broker/**`
  - `Makefile`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/mcp-platform/**`
  - `api/**`
  - `ui/**`
  - `.github/workflows/**`
- **Conditional Paths**:
  - (none)
- **Exception**: `BR72-EX1` — Makefile targets `typecheck-mcp-broker` / `test-mcp-broker` / `smoke-mcp-broker-github` (new package needs Docker Make targets). Rollback: remove targets + package.

## Feedback Loop
- (none)

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: single proof package; built by Sonnet 5, finished + reviewed by the Opus conductor after a Claude session-limit interruption.

## Plan / Todo (lot-based)
- [x] **Lot 1 — broker package**
  - [x] `make typecheck-mcp-broker` exit 0
  - [x] `make test-mcp-broker` exit 0 (14 hermetic tests)
  - [x] `make smoke-mcp-broker-github` exit 0 — real api.github.com data (octocat/Hello-World, 3727 stars) THROUGH the generic broker
  - [x] Inline Opus review: connector-agnostic, secret-safe, typed errors, generic dispatch.
