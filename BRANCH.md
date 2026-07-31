# Feature: Connector Host L1

## Objective
Build the pure, provider-agnostic `@sentropic/connector-host` mount that exposes injected connector adapters through one per-workspace, deny-by-default boundary.

## Scope / Guardrails
- Scope limited to `packages/connector-host/**`, the root `Makefile` targets required to test it, and this branch plan.
- No API coupling, DB, KMS, network, OAuth, or provider-specific adapter imports.
- Make-only workflow; automated tests run only on `ENV=test-connector-host`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/connector-host/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-connector-google/**`
  - `packages/**` except `packages/connector-host/**`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile`
  - `.github/workflows/**`
- **Exception process**:
  - `BR478-EX1` is declared below before changing the root `Makefile`.

## Feedback Loop
- [x] `BR478-EX1` — Root `Makefile` needs additive `typecheck-connector-host` and `test-connector-host` targets. Impact: only the new private package has an executable containerized gate. Rollback: remove those two targets.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: one bounded pure-package implementation with hermetic tests.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm `feat/connector-host` mechanically with `harness check branch`.
  - [x] Read the platform runtime, context, testing, manifest, visibility, specification, and package/Makefile templates.
  - [x] Define `ENV=test-connector-host` for hermetic tests.
  - [x] Declare `BR478-EX1` for the two additive root Make targets.

- [x] **Lot 1 — Pure host package and denial boundary**
  - [x] Add package metadata and strict TypeScript configuration.
  - [x] Define injected secret, account, tenant/workspace, and audit ports.
  - [x] Implement the single mount ordering: resolve → explicit principal guard → allowlist → account → context/secret port → narrow-only tenant → visible capability → adapter dispatch.
  - [x] Reject adapter tenant broadening and upstream principal hints.
  - [x] Add hermetic fake-adapter tests for secret codes, no-leak behavior, unknown-error propagation, denials, principal guard, and tenant narrowing.
  - [x] Add `typecheck-connector-host` and `test-connector-host` Make targets.
  - [ ] Lot gate:
    - [x] `make typecheck-connector-host`
    - [x] `make test-connector-host ENV=test-connector-host`
    - [ ] Verify scope with `make scope-check`.

- [ ] **Lot 2 — Final validation**
  - [x] Inspect the final diff for forbidden imports, DB/KMS/network coupling, secret value logging, and `SecretEnvelopeError` class definitions.
  - [x] Re-run `make typecheck-connector-host`.
  - [x] Re-run `make test-connector-host ENV=test-connector-host`.
  - [x] Commit the package, mount, tests, Make targets, and completed plan checks atomically via `make commit`.
