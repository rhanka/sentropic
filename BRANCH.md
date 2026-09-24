# Feature: LLM gateway Lot 2 implementation

## Objective
- [x] Specify concrete caller authentication, cost-context resolution, and mesh dispatch with exact consumer compatibility and an executable build plan.

## Scope / Guardrails
- [x] Planning only on `spec/llm-gateway-lot2`, worktree `tmp/llm-gateway-lot2`, base `origin/main` at `75032fc85`.
- [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, and `plan/BRANCH_TEMPLATE.md`.
- [x] Make-only checks and commits; `ENV=test-llm-gateway-lot2` last; no services required.
- [x] No code, migrations, package bumps, push, PR, merge, or publication in this branch.
- [x] English text; selective staging; separate `make commit`; approximately 150 changed lines per commit.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md`
  - [x] `BRANCH.md`
  - [x] `packages/llm-gateway/**`
  - [x] `Makefile` (BRLG2-EX1 targets only)
  - [x] `package-lock.json` (BRLG2-EX2 gateway entry only)
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `api/**`
  - [x] `ui/**`
  - [x] `docker-compose*.yml`
  - [x] `.github/workflows/**`
  - [x] `.cursor/rules/**`
  - [x] `.track/**`
  - [x] All paths other than the explicit allowed files; the h2a checkout is read-only.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] Root `package.json` only if I0 requires it; no change currently needed.
- [x] **Exception process**:
  - [x] BRLG2-EX1/EX2 authorized by the implementation brief; record other irreversible out-of-brief decisions as `blocked` and stop.

## Feedback Loop
- [x] BRLG2-FIXTURE | attention | Reversible | Standalone declaration qualification uses TypeScript 5.9.3 with skipLibCheck disabled, exact hono 4.10.7/mesh 0.21.2 and Node types 22.20.1. Evidence: consumer Hono declarations use generic Uint8Array unsupported by repository compiler 5.4.5. Repository build compiler unchanged; fixture-only qualification pins avoid suppressing declaration failures. Rollback: git revert.
- [x] BRLG2-EX1 | acknowledge | Owner: conductor | Approved before edits: Makefile `typecheck-llm-gateway`, `build-llm-gateway`, `test-llm-gateway` gain oauth-verify/mcp-auth/auth-hono build prerequisites and peer links; `package-llm-routing-candidates` adds auth tarballs; new `wait-llm-gateway-auth-dependencies` and `publish-llm-gateway` enforce recursive registry visibility. Reason: compile/qualify isolated optional auth subpaths. Impact: isolated toolset dependencies and publication ordering only. Rollback: git revert. No other Makefile, compose or workflow changes.
- [x] BRLG2-EX2 | acknowledge | Owner: conductor | I0 requires root `package-lock.json` gateway metadata alignment with 0.18.0, mesh floor and optional auth peers. Root package.json unchanged unless required. Impact: gateway dependency metadata only. Rollback: git revert.
- [ ] BRLG2-I0 | attention | Owner: auth lane / conductor | Registry latest is mcp-auth 0.2.0 on 2026-09-24; 0.2.1 clean service-only install remains pending. Develop against workspace without pinning 0.2.0; proceed with I1+ per conductor.
- [x] BRLG2-SCOPE | acknowledge | Implementation brief supersedes historical planning-only guardrails below. Single writer; no Track writes, push, PR, merge or publish. ENV=test-llm-gateway-lot2; API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480; ports verified free. Independent review/consumer qualification remain conductor gates.
- [x] C-FL1 | attention | Owner: conductor | Reversible | Use the EVOL rung directly: the brief fixes the three adapters and authorizes the Lot 2 type migration.
- [x] C-FL2 | attention | Owner: conductor | Reversible | Keep planning and review evidence in these two files; harness recorder/Track writes and separate review artifacts exceed the explicit scope. Independent review remains the conductor's handoff gate.
- [x] C-FL3 | attention | Owner: conductor | Reversible | Measured h2a origin/main `75c1dc61`: both inline verifiers remain assignable, affinity and ledger identity are unchanged, and `^0.17.0` requires a manual 0.18.0 range bump. Its lockfile already resolves mesh 0.21.2; lazy-surface E8 qualifies duplicate mesh resolution when gateway 0.18.0 and cluster-mesh are installed together.
- [x] C-FL4 | attention | Owner: implementation conductor | Reversible | Preserve native dispatch types; use RouteAttemptDispatch names to avoid chat-core's different MeshDispatchPort; qualify AuthResolver refresh as native-only, keeping BR-73 credentials/refresh inside mesh.
- [x] C-FL5 | attention | Owner: implementation conductor | Reversible | Require Lot F mcp-auth 0.2.1 `/hono` plus jose `^5.10.0` for service and auth-hono 0.15.0 `/middleware` for session, behind separate optional gateway subpaths; avoid eager root imports and the retiring wrapper. Service context still requires trusted tenant/OBO mapping.
- [x] C-FL6 | attention | Owner: implementation conductor | Reversible future scope exception | I0 names typecheck/build/test-llm-gateway, package-llm-routing-candidates, publish-llm-gateway and the new auth registry wait; use oauth-verify/mcp-auth plus session-only auth-hono peers. Rollback is git revert; mcp-auth reduces service wiring. This branch grants no Makefile exception.
- [x] C-FL7 | attention | Owner: implementation conductor | Reversible | Production uses request-generated cost correlation and a separately supplied stable affinity; existing custom verifiers retain their published options.
- [x] C-FL8 | attention | Owner: conductor | Reversible | Registry reads confirm gateway 0.17.1 and mesh 0.21.2; independent review, implementation tests and h2a UAT remain future gates, not claimed results.
- [x] C-FL9 | attention | Owner: implementation conductor | Reversible design | Add trusted `publicUrl` and the enumerated `caller-auth-unavailable` union member; private Hono onError preserves store outages as 503, while the deliberate RFC 6750 403-to-401 provider mapping gets separate tests.
- [x] C-FL10 | attention | Owner: implementation conductor | Reversible scope clarification | No quota admission hook exists; budgetScope is carried and over-budget is never emitted in Lot 2. Admission remains with BR-47 / deployable-process Lot D.
- [x] C-FL11 | attention | Owner: release owner | Irreversible future publication gate | Publishing gateway 0.18.0 freezes D1/D7's breaks publicly; O8 requires Lot F publication, registry-only auth dependencies, service-only clean installation with jose, independent review, h2a evidence and owner approval. CD order: mcp-auth 0.2.1 → mesh only if changed → gateway 0.18.0. No publication is authorized here.
- [x] C-FL12 | attention | Owner: auth lane; executor: mesh lane; qualification: implementation conductor | Hard prerequisite | Lot F `fix/mcp-auth-oauth-verify-dep` in `tmp/mcp-auth-dep-fix` supplies mcp-auth 0.2.1 with oauth-verify `^0.1.0` and a package-local regression test; auth owner GO/range confirmed, CI publication at merge. Registry measurement 2026-09-24 disqualifies 0.2.0's `file:` dependency unconditionally. I0 rejects non-registry specs at any auth-graph depth and qualifies service alone with required jose, without auth-hono or preinstalled oauth-verify; no auth package edits here.
- [x] C-FL13 | attention | Owner: cluster-mesh / lazy-surface conductor | Mirror contract | D7 requires both gateway auth subpaths: service `/auth` with mcp-auth/jose and session `/auth-hono` with auth-hono; separate mirrors preserve mode and peer isolation. The lazy-surface spec amendment remains in its own lane.

## AI Flaky tests
- [x] Not applicable: design-only branch; no provider calls or test execution required.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, single writer; no delegated implementation or integration.
- [x] Rationale: one specification and its execution checklist, with external consumer reads only.

## UAT Management (in orchestration context)
- [x] Web app, Chrome plugin, and VSCode plugin UAT not applicable: no runtime behavior changes.
- [x] No services or port reservation required for this planning task.

## Plan / Todo (lot-based)
- [ ] **I0 — Dependency and harness readiness**
  - [x] Verify branch, clean worktree, reviewed spec, rules, target discovery and ports; record approved exceptions.
  - [x] Update package.json and lockfile; wire only approved Makefile targets; recursive registry validation in scripts/auth-registry.mjs and tests/auth-registry.test.ts (bounded helper added within package scope).
  - [x] I0 workspace gate passed: make typecheck-llm-gateway lint-llm-gateway test-llm-gateway API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2 (132 tests). Initial missing-semver-link failure corrected and rerun green.
  - [x] Registry wait exercised: make wait-llm-gateway-auth-dependencies LLM_MESH_REGISTRY_WAIT_ATTEMPTS=1 API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2 fails closed on mcp-auth 0.2.1 E404, as required. Clean fixtures remain I2/I5 gates.
  - [ ] Qualify published mcp-auth 0.2.1 service-only install and auth-hono 0.15.0 session-only install (pending BRLG2-I0).
- [x] **I1 — Request-bound auth contracts**
  - [x] Implement request context, discriminated auth result, generic unavailable mapping and trusted router URL projection; internal/caller-auth.ts shares validation across boundaries (private helper within package scope).
  - [x] Add caller-auth/lot2-types tests; update contract-snapshot exhaustive error map in I1 because its Record correctly rejects the new union member until mapped. Test undefined publicUrl callback results fail closed.
  - [x] Update caller-auth/pool ports, personal auth, flow, route core, router/errors and stubs; gateway is 0.18.0. Existing harness needs no change: router supplies context.
  - [x] Update router, models, route-flow-core, route-json-flow, route-stream-flow and exhaustive contract-snapshot tests; add caller-auth and lot2-types tests. Existing errors tests remain unchanged and green.
  - [x] Verify public URL/default/invalid/spoofed forwarded headers, both wires/models, auth rejection/outage and compile-time invalid contracts. Full lot gate passed (146 tests): make typecheck-llm-gateway lint-llm-gateway test-llm-gateway API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2.
- [ ] **I2 — Concrete verification and cost**
  - [x] I2 workspace and isolated root/session gates passed: make typecheck-llm-gateway lint-llm-gateway test-llm-gateway API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2 (189 passed, one service clean-install pending under BRLG2-I0). Scoped service-auth test target also passed (17 tests).
  - [x] Add trusted cost resolver and explicit-resolver correlation exclusivity; retain legacy custom-verifier projection only when no resolver is selected.
  - [x] Add private auth-bridge helper for strict case-insensitive explicit credentials and bodyless Hono probes with per-request error/identity capture; no optional peer imports in shared helpers.
  - [x] Implement service /auth and session /auth-hono with separately cached lazy imports, trusted principal projection, required service configuration and unbound-DPoP rejection.
  - [x] Add fixtures/auth-hono.ts with real signed access/session tokens and DPoP proofs, deterministic clock, JWKS, replay and session stores.
  - [x] Add service-auth tests for signature/claims, DPoP bindings/replay, configuration, concurrent identity projection and public-router scope-denial/store-outage isolation.
  - [x] Add auth-hono tests for signed sessions, explicit-token aliases, DPoP/cookie denial, revocation/expiry/accountPolicy 403-to-401, and session/user/policy store 503 isolation.
  - [x] Add Docker-run clean npm consumer fixtures in auth-subpaths.test.ts: root without auth, published session-only, and service-only with jose and transitive oauth-verify. Only mcp-auth 0.2.1 E404 marks service qualification pending; network/metadata failures fail.
  - [x] Add enrolled-owner projection and malformed/ambiguous credential regressions. Initial I2 typecheck/lint and 180 runtime tests passed; standalone root/session declaration checks failed and diagnostics are being investigated; service clean install remains pending.
  - [ ] Implement separate caller-auth/service-auth and auth-hono subpaths, cost-context resolver, ports/barrels and exports.
  - [ ] Add service-auth, auth-hono, auth-subpaths, cost-context tests and fixtures/auth-hono; update caller-ownership tests; cover the full section 4 authentication matrix and isolated optional peers.
- [x] **I3 — Opaque mesh adapter**
  - [x] Full lot gate passed: make typecheck-llm-gateway lint-llm-gateway test-llm-gateway API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2 (197 passed, one approved pending service-install gate).
  - [x] Correct adapter fixture metadata to the published mesh correlationId field after typecheck rejected an invented field; no mesh contract change.
  - [x] Implement route-attempt-dispatch, dispatch port, root export, routed flow/router integration with no native fallback; reject own auth fields and incomplete routeDispatch configuration.
  - [x] Add route-attempt-dispatch tests; update route-json-flow and route-stream-flow for injected exact-attempt dispatch and single terminal outcome; constructor test covers incomplete router wiring. Existing routed-router tests retain native-stub exclusion.
- [ ] **I4 — Lifecycle and wire integration**
  - [x] Isolate JSON completion/settlement hooks from retry handling; settle empty plans; check cancellation before provider calls; estimate missing usage without replacing reported zeros.
  - [x] Add JSON regressions for empty plans, missing versus genuine zero usage, and settlement rejection without redispatch or duplicate operational outcomes.
  - [x] Add private trackedExecution helper in route-stream-flow.ts to claim terminal outcomes before async work, preserve reported zero usage, estimate missing usage, sanitize stream errors and handle unstarted consumer return. Wiring follows in the next atomic commit.
  - [ ] Update routed flows/router only as required; canonical ingress/egress/stream only for evidenced defects.
  - [ ] Add lot2-router-integration tests; update route-flow-core, route-json-flow, route-stream-flow and contract-snapshot for cross-wire, cleanup, settlement, missing usage and redaction.
- [ ] **I5 — Release and consumer qualification**
  - [ ] Update README, spec build evidence and candidate package metadata; pack exact candidates; run auth and six specified mesh regression scopes.
  - [ ] Consumer owner: exact-candidate h2a compilation/UAT at both entrypoints and independent review; no external repository edits authorized here.
  - [ ] Final scope/diff/log and cleanup: make down API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2.
- [ ] **Build lot gates (I0–I5)**
  - [ ] Each lot: make typecheck-llm-gateway lint-llm-gateway test-llm-gateway API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2.
  - [ ] Before each atomic commit: make scope-check ENV=test-llm-gateway-lot2; selective staging and separate make commit; update checklist in each commit.
- [x] **Review round 2 — Prescribed corrections N1–N5**
  - [x] N1/N3/N4 — Record one registry measurement date; require Lot F mcp-auth 0.2.1, transitive registry-only auth manifests, and service-only installation with required jose.
  - [x] N2/N5 — Specify both cluster-mesh auth mirrors and the measured h2a mesh lockfile resolution, with duplicate resolution covered by lazy-surface E8.
  - [x] Validate scope, whitespace and spec consistency; commit both allowed files through make; confirm isolated cleanup and final log.
  - [x] Round 2 checks: harness C1/C2, `make scope-check ENV=test-llm-gateway-lot2` and whitespace checks passed; the exact Lot 4 cleanup/ps commands below passed again with an empty service list. Runtime and consumer qualification remain implementation gates.
- [x] **Review round 1 — Focused fix groups**
  - [x] R1 — Re-inventory h2a origin/main, correct C-FL3 and document gateway/mesh range effects (findings 1, 11).
  - [x] R2 — Use published canonical service auth and isolate optional auth peers behind subpaths; require npm visibility for all auth dependency floors (findings 2, 3).
  - [x] R3 — Complete public URL/error contracts, Hono failure classification and RFC 6750 deviation tests (findings 4, 5, 12).
  - [x] R4 — Correct quota boundary, dispatch naming and native-only refresh comment (findings 6, 7, 8).
  - [x] R5 — Enumerate future Makefile wiring and publish order; classify reversible changes versus owner-gated publication (findings 9, 10).
  - [x] Run scope/whitespace checks per fix group; commit both files; verify final scope, cleanup and log.
  - [x] Resume preserved committed R1-R3 and the uncommitted R4 patch; completed R4-R5 only. Branch/full-file scope checks passed; cleanup and empty service list reconfirmed on 2026-09-24. Independent review and runtime/consumer qualification remain future gates.
- [x] **Lot 0 — Evidence and baseline**
  - [x] Verify branch with `git branch --show-current` and `harness check branch` (PASS C1).
  - [x] Discover Makefile targets and confirm clean initial worktree.
  - [x] Read gateway/BR-73 specs, all three ports, implementations/tests, auth-hono, pool AuthResolver, and both h2a import sites.
  - [x] Inventory exported contracts and distinguish caller credentials from provider credentials.
- [x] **Lot 1 — Caller authentication and cost context**
  - [x] Write Status / Branch / Extends and numbered decisions in `spec/SPEC_EVOL_LLM_GATEWAY_LOT2.md`.
  - [x] Define verifier wiring, claim trust, failure semantics, and cost-context interfaces.
- [x] **Lot 2 — Mesh dispatch**
  - [x] Define the adapter, payload/wire contract, cancellation, errors, and settlement behavior.
  - [x] Identify any required llm-mesh changes and release consequences: no mesh source change required.
- [x] **Lot 3 — Compatibility and implementation handoff**
  - [x] Enumerate existing-type changes and additive root/subpath exports in decision D7; round 1 isolates optional auth types.
  - [x] Enumerate every proposed public type change and impact at each h2a import site.
  - [x] Specify gateway `0.17.1` to `0.18.0`, conditional mesh bump, and migration sequence.
  - [x] Provide ordered implementation lots with existing/new test paths and Make gates.
  - [x] Classify open decisions as reversible or irreversible and record conservative defaults.
- [x] **Lot 4 — Final validation**
  - [x] Review spec consistency against code and both consumer sites; record limitations.
  - [x] Run `make scope-check ENV=test-llm-gateway-lot2` before each commit; PASS C2. Explicit full-file harness scope check also passed.
  - [x] Check whitespace, exact file scope and English commit messages; final clean-status/log verification accompanies handoff.
  - [x] Commit both allowed files through `make commit`; hand off without pushing.
  - [x] Cleanup passed: `make down COMPOSE_PROJECT_NAME=test-llm-gateway-lot2 API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2`; no application services were started.
  - [x] Cleanup confirmed: `make ps COMPOSE_PROJECT_NAME=test-llm-gateway-lot2 API_PORT=9380 UI_PORT=5580 MAILDEV_UI_PORT=1480 ENV=test-llm-gateway-lot2` passed with an empty service list.
