# Feature: Standalone LLM gateway host (Lot D B1)

## Objective
Deliver the private `apps/llm-gateway` Node host that composes the gateway through one cluster-mesh registry and the gateway namespace module mounted at `/`, with explicit 503 readiness while B2-B4 dependencies are absent and a bounded SIGTERM drain. No production readiness claim.

## Scope / Guardrails
- Scope limited to the new host app, its make checks, root workspace wiring and a narrow api route-plane extraction.
- Contract: `tmp/llm-deployable-process/spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` sections 1-3, 6, 10 (row B1) and 12 (B0 freeze).
- No migration, no package source change, no Dockerfile/deploy/CI change.
- Make-only workflow, no direct Docker commands.
- Branch development happens in isolated worktree `tmp/llm-gateway-host` on branch `feat/llm-gateway-host`.
- Test environment `ENV=test-llm-gateway-host`, ports `API_PORT=9461 UI_PORT=5661 MAILDEV_UI_PORT=1561`; never `ENV=dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/llm-gateway/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `deploy/**`
  - `plan/**`
  - `.track/**`
  - `packages/**`
  - `api/Dockerfile`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BRDP-EX1a)
  - `package.json` (BRDP-EX6)
  - `package-lock.json` (BRDP-EX6)
  - `api/src/services/llm-runtime/standalone-ports.ts` (BRDP-EX7)
  - `api/src/services/llm-runtime/gateway-route-plane.ts` (BRDP-EX7)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [x] BRDP-EX1a (scope-check alias BR900-EX1) | acknowledge | Owner: conductor | Branch: current | 2026-09-25 | `Makefile`: add only `typecheck-llm-gateway-process`, `lint-llm-gateway-process`, `test-llm-gateway-process` (per-file `SCOPE`), each running `npm run <script>` in `apps/llm-gateway` through the existing `api` Compose service after `prepare-node-workspace`. Reason: spec §10 host recipes. Impact: additive targets only. Rollback: remove the three targets.
- [x] BRDP-EX6 (scope-check alias BR900-EX6) | acknowledge | Owner: conductor | Branch: current | 2026-09-25 | Root `package.json`: append `apps/llm-gateway` to `workspaces`; root `package-lock.json` refreshed only through `make lock-root`. No dependency outside the host manifest, whose ranges reuse the api's resolved versions. Rollback: revert both hunks with the host.
- [x] BRDP-EX7 (scope-check alias BR900-EX7) | acknowledge | Owner: conductor | Branch: current | 2026-09-25 | New `api/src/services/llm-runtime/standalone-ports.ts` receives, from `gateway-route-plane.ts`: `GatewayRouteIntentEvidence`, the single-attempt routing `policy`, `subjectKey`, and the plan/prepare/affinity bookkeeping as `createGatewayRoutePlane(ports)`, plus the port types `GatewayRouteTargetPort`, `GatewayModelCatalogPort`, `GatewayRouteDispatchPort` (structural copy of `GatewayRuntimeDispatchPort`). Imports: `@sentropic/llm-mesh` types only. `gateway-route-plane.ts` keeps product bindings (`resolveRuntimeSelection`, `providerRegistry`, `applicationGatewayRuntime`) and `createApplicationGatewayRoutePlane` with identical refs, revision and messages. No other api file changes. Rollback: inline the factory back; product path unchanged.
- [x] BR900-A1 | attention | Owner: conductor | Branch: current | 2026-09-25 | Spec ids `BRDP-EX*` do not match the harness grammar `BR<n>-EX<n>`; placeholder aliases `BR900-EX*` let `make scope-check` recognise them until the conductor allocates the lane number.
- [x] BR900-A2 | attention | Owner: conductor | Branch: current | 2026-09-25 | Reversible: absent B2 identity, B3c settlement and B4 routing are explicit pending dependency slots. They keep `/readyz` at 503 and fail admission closed with the frozen provider-shaped 503. D3 startup refusal of missing adapters applies once B2-B4 deliver them.
- [x] BR900-A3 | attention | Owner: conductor | Branch: current | 2026-09-25 | Reversible: legacy `GatewayConfig` pool/authResolver/dispatch are host-owned refusing ports (native passthrough disabled); `stubGatewayConfig` and gateway stub ports are rejected at composition. A typed routed-host config remains a gateway-owned option.
- [x] BR900-A4 | attention | Owner: conductor | Branch: current | 2026-09-25 | Reversible: the host is a private workspace member `@sentropic/llm-gateway-host`; runtime values of the gateway come only from the cluster-mesh loader (type-only static imports). Compiling `dist/index.js` (bundling the api `standalone-ports.ts` import) is B5 scope.
- [x] BR900-A5 | attention | Owner: conductor | Branch: current | 2026-09-25 | Muse 12(a): the root lockfile change triggers every lockfile-filtered validate job; sequencing belongs to the conductor merge train.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- [x] Not applicable: host tests use fixture ports and no provider call.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: single builder lot B1 (Wave 1, parallel to B3a on disjoint paths).

## UAT Management (in orchestration context)
- [x] No UI surface; no UAT in this lot.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read MASTER/workflow/subagents/testing rules, template, spec sections and muse B0 findings 8, 11, 12(a).
  - [x] Verify branch `feat/llm-gateway-host` in `tmp/llm-gateway-host`.
  - [x] Declare BRDP-EX1a, BRDP-EX6, BRDP-EX7 with exact content before editing those paths.
- [ ] **Lot 1 — Extraction and workspace wiring**
  - [x] BRDP-EX7: extract `standalone-ports.ts`; rewire `gateway-route-plane.ts` imports only.
  - [x] Host manifest `apps/llm-gateway/{package.json,tsconfig.json,eslint.config.cjs,.gitignore}`.
  - [x] BRDP-EX6: root workspace entry and `make lock-root` refresh.
- [ ] **Lot 2 — Host sources**
  - [x] `src/config.ts`: validated listener configuration (mode, port, host).
  - [x] `src/readiness.ts`: dependency slots, 2 s bound, 5 s cache, not-ready latch.
  - [x] `src/app.ts`: one registry, one gateway namespace module mounted at `/`, injected ports, no listen on import.
  - [x] `src/lifecycle.ts`: listen, SIGTERM stop, admission close and bounded SSE drain.
  - [x] `src/index.ts`: entry with pending dependencies.
- [ ] **Lot 3 — Host tests and make checks**
  - [x] BRDP-EX1a: host make targets.
  - [x] `apps/llm-gateway/tests/fixtures.ts` (shared fixture ports) and `apps/llm-gateway/vitest.config.ts`
  - [x] `apps/llm-gateway/tests/config.test.ts`
  - [x] `apps/llm-gateway/tests/readiness.test.ts`
  - [ ] `apps/llm-gateway/tests/autonomy.test.ts`
  - [ ] `apps/llm-gateway/tests/lifecycle.test.ts`
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-gateway-process lint-llm-gateway-process test-llm-gateway-process API_PORT=9461 UI_PORT=5661 MAILDEV_UI_PORT=1561 ENV=test-llm-gateway-host`
    - [ ] `make typecheck-api lint-api API_PORT=9461 UI_PORT=5661 MAILDEV_UI_PORT=1561 ENV=test-llm-gateway-host`
    - [ ] Api tests touching the extraction: `tests/unit/provider-mesh-contract-proof.test.ts`, `tests/unit/llm-runtime-stream.test.ts`, `tests/api/cluster-mesh-gw.test.ts`
    - [ ] `make typecheck-llm-gateway test-llm-gateway ENV=test-llm-gateway-host` (router and contract-snapshot unchanged)
    - [ ] `make scope-check ENV=test-llm-gateway-host`
    - [ ] `make down API_PORT=9461 UI_PORT=5661 MAILDEV_UI_PORT=1561 ENV=test-llm-gateway-host`
