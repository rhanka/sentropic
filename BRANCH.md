# Feature: BR-44 LLM Mesh Account Transports

## Objective
Implement the first executable slice of BR-44: make `@sentropic/llm-mesh`
own account-transport contracts, add Sentropic DB-backed account transport
coordination, migrate the current Codex singleton into account rows, and route
OpenAI/Codex calls through stable per-session account leases.

## Scope / Guardrails
- Branch development happens in `tmp/feat-llm-mesh-account-transports`.
- Root workspace `/home/antoinefa/src/sentropic` remains reserved for user UAT.
- All commands go through `make`; concrete `ENV=...` stays the last argument.
- Automated tests use `ENV=test-feat-llm-mesh-account-transports` or
  `ENV=e2e-feat-llm-mesh-account-transports`, never `ENV=dev`.
- Branch ports: `API_PORT=9220`, `UI_PORT=5420`, `MAILDEV_UI_PORT=1320`.
- Package version bump is mandatory for `packages/llm-mesh/src/**` changes.
- No database lock may be held during an LLM stream.
- Cross-user subscription pooling remains disabled.
- Existing Codex settings endpoints remain a compatibility facade.
- Claude Code is exposed in the mesh contract/catalogue in this slice; full
  OAuth UI and Anthropic runtime cutover are deferred unless the Codex slice
  lands cleanly within the same branch.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/44-BRANCH_feat-llm-mesh-account-transports.md`
  - `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/chat-core/package.json`
  - `packages/chat-core/src/mesh-port.ts`
  - `packages/chat-core/src/runtime.ts`
  - `packages/chat-core/src/runtime-tool-dispatch.ts`
  - `packages/chat-core/src/runtime-finalization.ts`
  - `package-lock.json`
  - `api/drizzle/*.sql`
  - `api/drizzle/meta/_journal.json`
  - `api/drizzle/meta/*.json`
  - `api/src/db/schema.ts`
  - `api/src/services/codex-provider-auth.ts`
  - `api/src/services/provider-connections.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/services/llm-account-transports.ts`
  - `api/src/services/chat/mesh-dispatch-adapter.ts`
  - `api/src/services/llm-runtime/index.ts`
  - `api/src/services/llm-runtime/mesh-dispatch.ts`
  - `api/src/services/providers/openai-provider.ts`
  - `api/src/routes/api/settings.ts`
  - `api/tests/unit/**`
  - `api/tests/api/settings*.test.ts`
  - `ui/src/lib/utils/provider-connections-api.ts`
  - `ui/src/routes/settings/+page.svelte`
  - `e2e/tests/06-settings-codex-provider.spec.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` except `plan/44-BRANCH_feat-llm-mesh-account-transports.md`
- **Conditional Paths**:
  - New API service files under `api/src/services/**` only if they are narrow
    helpers for account transport coordination.
  - New API route files only if `/provider-connections/v2` cannot stay cleanly
    in `api/src/routes/api/settings.ts`.

## Lots
- [x] Lot 0 - Baseline and scope:
  - [x] Create branch metadata.
  - [x] Run `harness check branch`.
  - [x] Run `make scope-check API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-feat-llm-mesh-account-transports`.
- [x] Lot 1 - Mesh contract:
  - [x] Add coordinator and acquisition types.
  - [x] Add in-memory coordinator tests for sticky affinity and balancing.
  - [x] Make `account-transport` auth material executable.
  - [x] Add `claude-code` to the Anthropic account transport catalogue.
  - [x] Run `make typecheck-llm-mesh ENV=test-feat-llm-mesh-account-transports`.
  - [x] Run `make test-llm-mesh ENV=test-feat-llm-mesh-account-transports`.
- [x] Lot 2 - DB and API coordinator:
  - [x] Add account, lease, reservation, and quota tables.
  - [x] Add Drizzle schema entries.
  - [x] Implement Codex account import/enrollment storage.
  - [x] Implement DB-backed Codex acquire/release with stable session id.
  - [x] Add focused API tests.
- [x] Lot 3 - Runtime cutover:
  - [x] Route OpenAI/Codex dispatch through the coordinator.
  - [x] Preserve the existing settings API response shape.
  - [x] Ensure request overrides still bypass account transports.
- [ ] Lot 4 - Verification and publish:
  - [x] Run focused package/API tests.
  - [x] Run `make typecheck-api API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 REGISTRY=local ENV=test-feat-llm-mesh-account-transports`.
  - [x] Run `make typecheck-chat-core ENV=test-feat-llm-mesh-account-transports`.
  - [x] Run `make test-api-unit SCOPE=tests/unit/llm-account-transports.test.ts API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 REGISTRY=local ENV=test-feat-llm-mesh-account-transports`.
  - [x] Run `make test-pkg-chat-core ENV=test-feat-llm-mesh-account-transports`.
  - [x] Run `make scope-check API_PORT=9220 UI_PORT=5420 MAILDEV_UI_PORT=1320 ENV=test-feat-llm-mesh-account-transports`.
  - [ ] Commit, push, and open PR.

## Feedback Loop
- `BR44-SCOPE1`
  - Branch: BR-44 `feat/llm-mesh-account-transports`
  - Owner: implementation agent
  - Severity: scope clarification
  - Status: active
  - Decision: first implementation slice prioritizes executable Codex
    account transports with DB-backed leases and the package contract. Full
    Claude Code OAuth/UI v2 remains in the plan but is not required for the
    first quick implementation push unless time permits after Codex gates pass.
