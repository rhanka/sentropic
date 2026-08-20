# Feature: owner-scoped llm-mesh account administration

## Objective
- [x] Expose public owner-scoped account inventory and removal through `LlmMeshFacade`.
- [x] Keep credentials and keyring layout private to llm-mesh.

## Scope / Guardrails
- [x] Scope is limited to the local account service, facade contract, package metadata, tests, and spec.
- [x] Worktree is `tmp/worktrees/llm-mesh-account-admin` on `fix/llm-mesh-account-admin`.
- [x] Tests use `ENV=test-llm-mesh-account-admin`; no dev environment or live credentials.
- [x] All commands use Make targets and all new text is English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_ADMINISTRATION.md`
  - `packages/llm-mesh/src/account-transports.ts`
  - `packages/llm-mesh/src/service/facade.ts`
  - `packages/llm-mesh/src/service/local-account-transport-service.ts`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `PLAN.md`
  - `plan/**`
- **Conditional Paths (allowed only with an explicit exception)**:
  - `.github/workflows/**`
  - `api/drizzle/*.sql`

## Feedback Loop
- [x] H2A consumer evidence: `@sentropic/llm-mesh@0.16.1` has enrollment but no inventory/removal seam.
- [x] Consumer acceptance: list public metadata by owner and remove one owned account without keyring access.

## AI Flaky tests
- [x] None; all tests are deterministic and use an in-memory keyring.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; one small package contract and one consumer.
- [ ] Multi-branch.

## UAT Management (in orchestration context)
- [x] Package UAT uses a temporary in-memory keyring; no web, extension, or live OAuth UAT applies.

## Plan / Todo (lot-based)
- [x] Lot 0 — prove the missing public seam and define the owner/security contract.
- [x] Lot 1 — add and observe failing facade account lifecycle tests.
- [ ] Lot 2 — implement the smallest facade/service/coordinator change and bump the package patch.
- [ ] Lot 3 — run `make test-llm-mesh ENV=test-llm-mesh-account-admin`.
- [ ] Lot 3 — run `make typecheck-llm-mesh ENV=test-llm-mesh-account-admin`.
- [ ] Lot 3 — run `make build-llm-mesh ENV=test-llm-mesh-account-admin`.
- [ ] Lot 3 — run `make pack-llm-mesh ENV=test-llm-mesh-account-admin`.
- [ ] Lot 4 — scope-check, review, PR, CI, merge, tag, and CI publication.
