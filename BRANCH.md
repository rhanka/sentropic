# Feature: W4.b authorized host registry catalog source

## Objective
- [x] Project the single compiled app registry into the existing catalog and delegate authorized calls to the existing artifact transport.

## Scope / Guardrails
- [x] Owner deliverable 2, plan-v2.md W4.b line 147 and sections 2–5; dependencies W2.a and W4.a merged in base `21bf636d9`.
- [x] Branch `feat/app-cm-w4b`, worktree `tmp/worktrees/app-w4b`, draft PR base `feat/app-cm-integration`; merge only, never rebase or force-push.
- [x] Tests first; selective staging, scope-check and make commit below 150 lines; no attribution trailers.
- [x] Dedicated ports API_PORT=8802 UI_PORT=5188 MAILDEV_UI_PORT=1095; ENV=test-app-w4b last on every make.
- [x] Build/start/test commands use shared Docker flock; down after each step; no production activation, ENV=dev, clean-all or Python.
- [x] Preserve package ownership, locks, migrations and APP-P1 selection; no second catalog, mutation dispatcher or MCP name sanitizer.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/catalog/sources/host-registry-source.ts`
  - `api/src/services/catalog/request-authority.ts`
  - `api/src/services/catalog/execution-seam.ts`
  - `api/src/services/catalog/sources/mcp-source.ts`
  - `api/src/services/catalog/sources/standalone-tool-source.ts`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/services/artifacts/credentials.ts`
  - `api/tests/services/catalog/host-registry-source.spec.ts`
  - `api/tests/services/catalog/mcp-source.spec.ts`
  - `api/tests/services/catalog/host-registry-turn.integration.test.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/api/artifacts-host-credentials.test.ts`
  - `.github/workflows/app-cm-w4b.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `api/drizzle/**`
  - `deploy/**`
  - `package*.json`
  - `api/package*.json`
  - `plan/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- [x] Record rationale, impact and rollback in Feedback Loop before expansion.

## Feedback Loop
- [x] BR-W4B-EX3: retire the unused sanitizing MCP source and its tests, move ToolHandlerSource to execution-seam.ts, remove runtime registration and correct standalone-source comments. Rationale: W4.b requires one compiled-registry MCP source and the owner forbids legacy fallback. Impact: removes dormant exports only; production uses host-registry. Rollback: revert this bounded retirement series, restoring the old files and wiring together.
- [x] P2-1: intended W4.a boundary: turn effects are bound to conversation + current account/tenant/workspace membership, not login-session liveness; logout or login-session expiry does not revoke a running turn. Conversation deletion/move, disabled account and membership revocation still deny effects. W3.a/W5.c may tighten this separately; no session policy change in W4.b.
- [ ] P1 revision: guard the sole MCP source and remove the legacy source/tests in atomic commits below 150 changed lines, then rerun exact-head qualification.
- [x] P1 wiring: ToolHandlerSource belongs to the execution seam; production registers host-registry as the sole MCP source and exposes no runtime MCP registration API.
- [x] P1 retirement step 1: removed legacy allow/deny, default-off and health tests; host-registry acceptance remains authoritative.
- [x] BR-W4B-EX1: integration PRs do not trigger ci.yml. Add branch-specific exact-head qualification using existing make targets and teardown, without publication/deployment. Rollback removes workflow.
- [x] Exact-head CI workflow authored with catalog, context, credential, registry, installation and HTTP/MCP regression suites, API types/lint and unconditional isolated-stack teardown.
- [x] Acceptance tests committed before implementation (`a91ca8139`, `02d74a6b3`); initial execution queued behind the machine-wide Docker lock. Implemented source and workspace-bound turn reader while awaiting the serialized test lane; no observed red result claimed.
- [x] Turn execution must retain conversation authority through the final host transaction. Extend only the existing credential reader with a workspace-bound turn credential; host authorization remains the sole effect guard. Rollback removes credential kind and source wiring.
- [x] BR-W4B-EX2: `chat-service.ts:2776` intersects turn authority with foundation-only names, excluding the host plan before real model selection. Add the existing compiled plan's names to that server-owned discovery allowlist and qualify real `runAssistantGeneration` in a unique catalog integration suite. No client/model-supplied names or effect changes; rollback removes this caller addition. This directly blocks W4.b model discovery and stays within section 5's W4 caller ownership.
- [x] Real-generation regression fails before caller correction (`/tmp/app-w4b-turn-red.log`, missing all four artifacts tools). Minimal caller change adds only compiled plan names; final green qualification required below.
- [x] Final local qualification: 380/380 tests across 22 suites, API typecheck passes, lint has 0 errors/220 warnings (`/tmp/app-w4b-final-qualification.log`). Includes source/search/execution, real generation, mounted HTTP, durable replay, moved/revoked turns and all selected catalog/transport regressions. Runtime log inspection shows healthy 200 probes (`/tmp/app-w4b-runtime.log`).
- [x] CI on earlier head `04bece0ed8e4266f759ad7dbc0c1f204abfc5627` passed: https://github.com/rhanka/sentropic/actions/runs/40619906074 . It does not qualify the later caller correction; the final pushed SHA must pass its own run before author delivery.
- [ ] Integration gate: independent final-head reviews remain conductor-owned after this code-author draft delivery; no merge clearance is claimed.

- [x] P1 retirement progress: 6 bounded removal commits; final deletion and qualification pending.

## AI Flaky tests
- [x] No AI-dependent acceptance or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch author; independent final reviews use read-only peers.

## UAT Management (in orchestration context)
- [x] Backend catalog only; automated HTTP discovery and model/executor acceptance; no root-dev or production UAT.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read rules, template, W4.b row and cited sections; create assigned worktree; mechanical branch check passes.
- [x] Lot 1 — Source acceptance passes: exact names/schema, denied contexts, read-only, interleaved views, filtering before ranking/serialization and one execution. Added same-workspace unequal-permission coverage for final qualification.
- [x] Lot 2 — Implement source; register once in `skills/catalog.ts`; await public compiled plan in `request-authority.ts`; no private cache.
- [x] Lot 3 — Workspace-bound turn, durable source/transport replay and revocation pass with the existing reader extended; first source/credential run 29/29. Added conversation-move-during-publication-wait regression for final qualification.
- [x] Lot 4 — Mounted discovery, model selection, chat-service/executor and revoked retry pass: `cluster-mesh-catalog.test.ts` 12/12; no transport effect after denial.
- [x] Lot 5 — Scoped catalog/registry/transport/credential suites and real generation pass 380/380; API typecheck/lint pass; runtime logs inspected. Shared-lock `make down ENV=test-app-w4b` is queued and its completed receipt is required before delivery.
- [x] Lot 6 — Scope-check passes for each selective commit; draft PR #807 targets `feat/app-cm-integration`, with this file as body and a four-step first comment. Push this receipt/caller head and require green CI on its exact SHA plus completed teardown in the final PR/owner report; no merge or activation.
