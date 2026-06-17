# Branch Plan: BR-44 LLM Mesh Account Transports

Current coordination source:

- `spec/SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`
- `spec/SPEC_EVOL_LLM_MESH.md`

Branch:

- BR-44 `feat/llm-mesh-account-transports`

Scope summary:

- Make Codex and Claude Code subscription accounts executable account transports
  for `@sentropic/llm-mesh`.
- Add DB-backed Sentropic coordination for multi-account routing, session
  affinity, in-flight reservations, refresh, and quota state.
- Migrate the current singleton Codex settings implementation without losing
  connected accounts.
- Add v2 provider-connections API and Settings UI for multi-account management.

Non-goals:

- Do not make Codex or Claude Code model providers.
- Do not add Postgres or Drizzle dependencies to `@sentropic/llm-mesh`.
- Do not enable cross-user subscription pooling by default.
- Do not hold database locks during LLM streams.

Lot outline:

- Lot 0 - Baseline and branch setup:
  - Read rules and account transport spec.
  - Verify branch and scope with harness.
  - Confirm target package version bump requirement for `packages/llm-mesh`.

- Lot 1 - Package contract:
  - Add account transport coordinator types.
  - Promote `claude-code` from planned hook to executable account transport type.
  - Add in-memory coordinator and package tests.
  - Gates: `make typecheck-llm-mesh`, `make test-llm-mesh`.

- Lot 2 - Sentropic DB model:
  - Add one migration for account tables, leases, reservations, and quota state.
  - Add Drizzle schema entries.
  - Add unit tests for constraints and cleanup semantics.
  - Gates: `make typecheck-api`, focused API unit tests.

- Lot 3 - Coordinator implementation:
  - Implement short-transaction acquire with lease reuse and `SKIP LOCKED`
    account selection.
  - Add reservation TTL and outcome recording.
  - Add refresh coalescing and `reauth_required` state.
  - Gates: concurrency unit tests and no-secret trace tests.

- Lot 4 - Codex migration and runtime cutover:
  - Migrate singleton Codex settings into `llm_provider_accounts`.
  - Keep old endpoints as a compatibility facade.
  - Replace `resolveConnectedCodexTransport` dispatch with coordinator acquire.
  - Make Codex session id stable per lease.
  - Gates: migration tests, Codex mocked runtime tests.

- Lot 5 - Claude Code transport:
  - Add Claude Code OAuth enrollment, import, refresh, and profile lookup.
  - Persist Claude Code accounts through the coordinator.
  - Record Anthropic unified quota headers.
  - Gates: mocked OAuth/refresh tests and quota tests.

- Lot 6 - API and Settings v2:
  - Add `/provider-connections/v2`.
  - Update Settings UI to manage transport accounts and scoped policies.
  - Keep current Codex E2E behavior through compatibility path until v2 tests
    replace it.
  - Gates: API endpoint tests, UI utility tests, focused E2E settings tests.

- Lot 7 - Product gates and audit:
  - Add kill switch and disabled-by-default policy.
  - Add explicit owner acceptance flag.
  - Add audit events for enrollment, routing, refresh, disconnect, and rebind.
  - Gates: RBAC and audit tests.

- Lot 8 - Final validation:
  - Full impacted package/API/UI test campaign.
  - Root UAT only after branch CI is green.
  - Remove branch `BRANCH.md`, push, and merge after CI/UAT approval.

Exit criteria:

- `@sentropic/llm-mesh` exposes stable account transport coordinator contracts.
- Sentropic API uses DB-backed account transport routing for Codex.
- Claude Code subscription accounts can be enrolled behind explicit gates.
- Multi-account routing preserves intra-session affinity and does not leak
  secrets to hooks, logs, traces, or UI.
