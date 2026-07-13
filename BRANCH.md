# Feature: ARCH-11 G1b — resolveTenant seam + SHADOW mode

## Objective
Ship the `resolveTenant` product-side seam (§3), the `TENANT_RESOLUTION_MODE` flag (default `shadow`), and shadow instrumentation at the in-repo alias sites (§4.3), with ZERO behavior change at the default mode. CODE-only (no migration; G1a shipped the columns). No prod action, no `strict` default.

## Scope / Guardrails
- Scope limited to `api/src` alias sites + a new `api/src/services/tenancy/*` seam + `api/src/config/env.ts` + one new test file.
- No migration (G1a added `workspaces.tenant_id`, `service_clients.tenant_id`). CODE only.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development in isolated worktree `tmp/arch11-g1b`.
- Automated test campaigns on `ENV=arch11-g1b`, never on root `dev`.
- `ENV=<env>` passed LAST in every `make` command.
- Env/ports: `ENV=arch11-g1b API_PORT=9215 UI_PORT=5415 MAILDEV_UI_PORT=1215` (slot owner: g1b).
- All new text in English.
- Default mode = `shadow`; `strict` is CODE-complete but flag-gated (owner-signed cutover, not this branch).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/tenancy/**` (new)
  - `api/src/config/env.ts`
  - `api/src/routes/api/comments.ts`
  - `api/src/services/queue-manager.ts`
  - `api/src/services/tool-service.ts`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/skills/foundation-executor.ts`
  - `api/src/services/chat-service.ts`
  - `api/tests/api/tenancy/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `ui/**`
  - `packages/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed only with explicit exception)**:
  - none
- **Exception process**: declare `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path (reason, impact, rollback).

## Feedback Loop
- `BR-G1b-EX1` (`attention`, cross-package, NOT edited): the 7th alias site `packages/llm-gateway/src/personal-passthrough/caller-auth.ts:134` (`CostContext.tenantId = principal.tenantId`, workspace-derived on the cookie path) is package-side. FORBIDDEN by scope. Impact: the cost/quota ledger still rides the alias; no shadow instrumentation there. Rollback: n/a (untouched). Owner/architect must schedule a llm-gateway PR (minor bump) to add the same reconcile seam. Recorded 2026-07-12.
- `BR-G1b-EX2` (`attention`, cross-package, NOT edited): §4.2.4 `tenantOfDomainHint('workspaceId', wsId) → resolveTenant({workspaceId})` cross-check lives entirely in `packages/mcp-platform/src/authz.ts` (`TenantResolver.tenantOfDomainHint`, `resolveAuthorizedTenant`, `InMemoryTenantRegistry`). `grep @sentropic/mcp-platform api/` = ZERO api consumer: there is no in-repo instantiation point to inject the hook into. FORBIDDEN by scope + no wiring site exists. Impact: token-path `workspaceId`↔`tid` cross-check not yet wired. Rollback: n/a. Owner/architect must wire this inside mcp-platform (or its future host) — belongs to G1c (token path). Recorded 2026-07-12.
- `BR-G1b-N1` (`attention`, design note for architect): shadow divergence semantics. `tenantId := workspaceId` (a UUID) vs the resolved real tenant (a slug e.g. `sentropic`) are structurally never equal, so a literal value-mismatch counter would be a permanent ~100% and could NEVER reach the §4.3 "divergence = 0" gate. On the product/cookie path (all G1b sites) there is NO token `tid` to cross-check. Therefore the divergence COUNTER increments when `resolveTenant` returns an error (`unknown`/`ambiguous_tenant`) — i.e. when strict mode WOULD fail-close on live traffic. This is the achievable-0 signal proving backfill completeness before cutover. The structured log additionally records the legacy-vs-resolved value for observability. Requesting architect confirmation of this gate definition. Recorded 2026-07-12.

## AI Flaky tests
- No AI tests touched. N/A.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single final test cycle; orthogonal CODE-only change)
- [ ] **Multi-branch**
- Rationale: one cohesive seam + instrumentation, single API test cycle, no independent CI needed.

## UAT Management (in orchestration context)
- No UI change (backend seam + metric only). No UAT surface. Architect review before PR/merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, spec §3/§4.2/§4.3/§5.
  - [x] Confirm worktree `tmp/arch11-g1b` on `feat/arch11-g1b-resolvetenant-shadow`.
  - [x] Ground alias sites against real code (comments/queue-manager/tool-service/catalog); locate schema G1a columns.
  - [x] Env mapping + ports: `ENV=arch11-g1b API_PORT=9215 UI_PORT=5415 MAILDEV_UI_PORT=1215`; `make ps-all` = free.
  - [x] Validate scope boundaries; declare cross-package exceptions `BR-G1b-EX1/EX2`.

- [x] **Lot 1 — resolveTenant seam + flag + metrics**
  - [x] `api/src/config/env.ts`: add `TENANT_RESOLUTION_MODE = alias|shadow|strict`, default `shadow`.
  - [x] `api/src/services/tenancy/resolve-tenant.ts`: `resolveTenant(input)` (§3), fail-closed, in-process cache; `reconcileTenantId({workspaceId,userId?,path})` mode helper; `TenantResolutionError`.
  - [x] `api/src/services/tenancy/tenant-resolution-metrics.ts`: in-process counters (`total`, `divergence`) mirroring `comment-metrics.ts`.

- [x] **Lot 2 — Instrument in-repo alias sites (shadow-preserving)**
  - [x] `comments.ts`: `tenantOf` → async via `reconcileTenantId`; await at 6 call sites.
  - [x] `queue-manager.ts:1450`: reconcile before building `TenantContext`.
  - [x] `tool-service.ts:1288/1412/1662`: reconcile at all three.
  - [x] `catalog.ts`: `ResolveFoundationChatToolsInput.tenantId?` + builder `tenantId ?? workspaceId` (sync kept, §4.2.2).
  - [x] `chat-service.ts:2771` + `foundation-executor.ts` `buildSearchAuthz`: resolve upstream, thread `tenantId` in.

- [x] **Lot 3 — Tests (behavior-preserving proof + 3 modes + ≥2-org)**
  - [x] Add `api/tests/api/tenancy/arch11-resolve-tenant.test.ts`:
    - [x] resolveTenant correctness per input (`{workspaceId}`, `{workspaceId,userId}` cross-check, `{clientId}`, `{userId}`), fail-closed on miss.
    - [x] NON-VACUOUS ≥2-org: org-B never resolves org-A workspace/tenant/client.
    - [x] `alias` mode = legacy (`tenantId := workspaceId`), no divergence recorded.
    - [x] `shadow` mode = ZERO behavior change (returns legacy), divergence recorded on error only.
    - [x] `strict` mode = resolveTenant authoritative + fail-closed (throws on miss).
  - [x] Lot gate:
    - [x] `make typecheck-api ENV=arch11-g1b` + `make lint-api ENV=arch11-g1b`
    - [x] Scoped: `make test-api-endpoints SCOPE=tests/api/tenancy/arch11-resolve-tenant.test.ts ENV=arch11-g1b`
    - [x] Suite: `make test-api ENV=arch11-g1b`

- [x] **Lot N — Final validation**
  - [x] Typecheck & Lint (api)
  - [x] Retest API suite
  - [ ] No `packages/**` touched → no version bump owed.
  - [ ] Architect review (no PR/merge in this branch — handoff).
  - [x] Teardown: `make down ENV=arch11-g1b`.
</content>
</invoke>
