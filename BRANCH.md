# Fix: Cloud Code Pro enrollment and quota fallback

## Objective
Correct Cloud Code onboarding so an eligible Google AI Pro identity selects its paid Cloud Code tier, expose the resolved tier during enrollment, and classify quota failures as replayable provider errors.

## Scope / Guardrails
- Build on the supplied measured diagnosis; do not repeat live network probing.
- Never read, print, or modify keyring, credential, or secret material.
- Do not change `@sentropic/contracts`.
- Keep the `@sentropic/llm-mesh` public contract backward-compatible and bump `0.19.0` to `0.19.1`.
- Make-only gates on `ENV=test-llm-mesh-gemini`; never use `ENV=dev`.
- Do not push, open a pull request, publish, or add attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/llm-mesh/src/enrollment/cloud-code.ts`
  - `packages/llm-mesh/src/enrollment/contracts.ts`
  - `packages/llm-mesh/src/errors.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/enrollment/cloud-code.test.ts`
  - `packages/llm-mesh/tests/errors.test.ts`
  - `packages/llm-mesh/tests/service/local-account-transport-service.test.ts`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `packages/contracts/**`
  - `packages/llm-gateway/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `api/drizzle/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - None.
- **Exception process**:
  - Declare a `BRGEM-EXn` item in `## Feedback Loop` before touching a forbidden path.

## Feedback Loop
- [x] No exception is required for the scoped package correction.

## AI Flaky tests
- [x] N/A; all scoped tests use mocked provider responses.

## Orchestration Mode
- [x] **Mono-branch**
- [ ] **Multi-branch**
- [x] The enrollment, visibility, quota, and version lots are sequential and independently committed.

## Plan / Todo
- [x] **Lot 0 — Evidence and scope**
  - [x] Verify branch `fix/llm-mesh-gemini-enrollment` mechanically.
  - [x] Verify the requested worktree is writable with a create/delete probe.
  - [x] Read the execution brief and measured diagnosis without repeating network probing.
  - [x] Trace OAuth client source, scopes, project discovery, tier selection, onboarding, runtime, gateway linkage, and ProviderId status.
- [x] **Lot 1 — Pro-tier onboarding correction**
  - [x] Parse current and allowed Cloud Code tiers from `loadCodeAssist`.
  - [x] Select and confirm `standard-tier` when the identity is eligible.
  - [x] Add focused regression coverage.
  - [x] Pass focused enrollment tests and scope-check, then commit atomically.
- [x] **Lot 2 — Enrollment-time tier visibility**
  - [x] Return the resolved Cloud Code tier and a free-tier warning from enrollment.
  - [x] Add service-level regression coverage.
  - [x] Pass focused tests and scope-check, then commit atomically.
- [ ] **Lot 3 — Quota classification**
  - [ ] Classify HTTP 403, `insufficient_quota`, and `RESOURCE_EXHAUSTED` as replayable quota errors.
  - [ ] Add focused normalization tests.
  - [ ] Pass focused tests and scope-check, then commit atomically.
- [ ] **Lot 4 — Patch version and final gates**
  - [ ] Bump `@sentropic/llm-mesh` from `0.19.0` to `0.19.1`.
  - [ ] Pass `make typecheck-llm-mesh`, `make build-llm-mesh`, and `make test-llm-mesh`.
  - [ ] Pass final scope and diff review.
  - [ ] Commit the version bump atomically and confirm no push, PR, or publish occurred.
