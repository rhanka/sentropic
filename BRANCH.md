# Feature: MCP-L5 Lot 1 frozen contracts, trusted dispatch and P1 pre-candidate

## Objective
- [x] Deliver P1 immutable pre-candidate: L4-consumed types and schemas, broker seam, L5-MEMORY-V1 checkpoint definition, pre-candidate-manifest.json plus SHA-256 sidecar.
- [x] Entry gate per owner decision 2026-10-18: #685 merged and published, L0 co-accepted, Lot 0 #697 merged, writer handoff, environment reserved. No wait for BR3 or R2/R7a/R3.

## Scope / Guardrails
- [x] Branch feat/memory-mcp-l5-lot1 in tmp/worktrees/memory-mcp-l5-lot1, base 9ed96eb83 verified via git branch --show-current.
- [x] Slot BR-125: API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725, ENV=test-feat-memory-mcp-l5 for tests, ENV last in every make command, never ENV=dev.
- [x] Make-only Docker execution, one Docker build at a time, no host install, no Python in host or jobs.
- [x] P1 carries only L4-consumed types and schemas, pure broker seam and L5-MEMORY-V1 definition via public @sentropic/mcp-platform/memory and @sentropic/mcp-broker/memory entries, never a cluster-mesh source path.
- [x] Atomic commits via make commit, max 150 lines each, make scope-check before each commit, no AI attribution.
- [x] All new text in English.

## Branch Scope Boundaries (MANDATORY)
- [x] **Allowed Paths (implementation scope)**:
  - [x] `BRANCH.md` in this worktree only.
  - [x] `tools/memory-mcp-l5/**` (Lot 0 runner, schemas, catalog, provenance-bound fixtures, packed tests, manifests).
  - [x] `spec/SPEC_MCP_MEMORY_L5.md`, `spec/evidence/memory-mcp-l5/**`.
  - [x] L5-EX1 packaging: `packages/mcp-platform/package.json`, `packages/mcp-platform/tsconfig.json`, `packages/mcp-platform/api-extractor.json`, `packages/mcp-platform/api-extractor.memory.json`, `packages/mcp-platform/etc/mcp-platform.api.md`, `packages/mcp-platform/etc/mcp-platform-memory.api.md`, `packages/mcp-platform/README.md`, `packages/mcp-platform/CHANGELOG.md`.
  - [x] L5-EX1 contracts and transport: `packages/mcp-platform/src/index.ts`, `packages/mcp-platform/src/manifest.ts`, `packages/mcp-platform/src/runtime.ts`, `packages/mcp-platform/src/transport/bridge.ts`, `packages/mcp-platform/src/transport/result-codec.ts`, `packages/mcp-platform/src/transport/dispatch.ts`.
  - [x] L5-EX1 new platform memory sources and tests: `packages/mcp-platform/src/memory/**`, `packages/mcp-platform/tests/memory/**`.
  - [x] L5-EX1 existing platform tests: `packages/mcp-platform/tests/request-identity.test.ts`, `packages/mcp-platform/tests/wire-parity.test.ts`, `packages/mcp-platform/tests/registry-dispatch.test.ts`.
  - [x] L5-EX1 broker: `packages/mcp-broker/package.json`, `packages/mcp-broker/tsconfig.json`, `packages/mcp-broker/src/index.ts`, `packages/mcp-broker/src/context.ts`, `packages/mcp-broker/src/registry.ts`, `packages/mcp-broker/src/broker.ts`, `packages/mcp-broker/src/memory/**`, `packages/mcp-broker/src/memory-reference/**`, `packages/mcp-broker/tests/broker.test.ts`, `packages/mcp-broker/tests/memory/**`, `packages/mcp-broker/README.md`, `packages/mcp-broker/CHANGELOG.md`.
  - [x] L5-EX1 mesh: `packages/cluster-mesh/src/compose/mcp.ts`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/README.md`, `packages/cluster-mesh/CHANGELOG.md`, `packages/cluster-mesh/tests/mcp-composition.spec.ts`, `packages/cluster-mesh/tests/verified-invocation-context.spec.ts`, `packages/cluster-mesh/tests/memory-context.spec.ts`.
  - [x] L5-EX1 shared tooling: root `Makefile`, `package-lock.json`, `.github/workflows/ci.yml` only.
- [x] **Forbidden Paths (must not change in this branch)**:
  - [x] `docker-compose*.yml`, `.cursor/rules/**`, `rules/**`, `PLAN.md`, `plan/**`, `.track/**`, `.security/**`, `scripts/**`, root `package.json`.
  - [x] `api/**`, `ui/**`, `apps/**`, `deploy/**`, `packages/llm-mesh/**`, `packages/llm-gateway/**`, `packages/auth-hono/**`, `packages/auth-ui/**`, `packages/mcp-auth/**`, `packages/artifacts/**`, `packages/connector-host/**`, `packages/skills/**`, `packages/harness/**`.
  - [x] `packages/mcp-platform/src/registry*.ts`, `packages/mcp-platform/src/tool-configuration.ts`, `packages/mcp-platform/src/authz.ts`, `packages/mcp-platform/src/hono.ts`, `packages/mcp-platform/src/durable.ts`, `packages/mcp-platform/src/elicitation.ts`, `packages/mcp-platform/src/persistence.ts`, `packages/mcp-platform/src/stores.ts`, `packages/mcp-platform/src/audit.ts`, `packages/mcp-platform/src/experimental/**`, `packages/mcp-platform/src/mock/**`, `packages/mcp-platform/src/testing.ts`.
  - [x] `tools/gateway-evolution/**`, `.h2a/**`, `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`, frozen memory v3.1 file, Graphify and h2a repositories, every predecessor worktree and BRANCH.md.
  - [x] Every unlisted path is default-denied, including other .github files, other mesh files and other platform transport and tests.
- [x] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None beyond the enumerated L5-EX1 inventory.
- [x] **Exception process**:
  - [x] L5-EX1 declared in L5-preparation-plan-v2.1.md with rationale, impact and rollback, activation pending entry gate only, no second approval invented.
  - [x] Verify actual path inventory and run make scope-check before authorized commits.

## Feedback Loop
- [x] L5-LOT1-GATE closed 2026-10-18: #685 publications verified on npm (@sentropic/llm-mesh@0.27.0, @sentropic/llm-gateway@0.21.0, @sentropic/cluster-mesh@0.19.1), CI run 39154603798 on 9ed96eb83 green.
- [x] L5-F1 closed for Lot 1 implementation contract acceptance: amended co-signed L0 commit 60a8bfa828b5eabd360232ea5865391c23f99f48 bound in spec/evidence/memory-mcp-l5/l0-freeze.json and tools/memory-mcp-l5/fixtures/l0/60a8bfa828b5eabd360232ea5865391c23f99f48/index.json, independently derived vectors and fixtures, exact context/assurance/public declarations, policy mappings, and provenance-bound fixture bundle verified.
- [x] L5-F3 attention closed for environment: make ps-all shows zero running containers, slot BR-125 ports free, ENV=test-feat-memory-mcp-l5 reserved.
- [ ] L5-F7 blocked before Lot 2: needs immutable P1 handoff with exact manifest digest plus owner ACK naming that digest and Node-matrix alignment plus pinned E2 and L0 closure.
- [x] L5-EX1 enacted after entry gate closure with rationale, impact and rollback in L5-preparation-plan-v2.1.md.

## AI Flaky tests
- [x] All L5 identity and storage and SDK and crash proofs are deterministic and blocking, no AI or provider waiver, no skipped or todo required cases, no increased timeouts.
- [x] Any later AI test needs its exact command and file and signature, same-commit success and explicit owner acceptance, it cannot waive a mandatory L5 proof.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** with harness-using-harness rebase override: rebase, never cherry-pick, one integrated branch and one final release cycle, no orthogonal child branches.
- [x] Rationale: L5 remains one branch in the existing multi-repository sequence, single P1 deliverable, no parallel sub-workstreams.

## UAT Management (in orchestration context)
- [x] Mono-branch: Lot 1 has no web app and no Chrome plugin and no VSCode plugin changes, no product browser test is substituted for package routes.
- [x] Owner browser authentication and SDK UAT belong to Lot 4 with the exact qualified preprod IdP profile and disposable memory data, recorded as redacted pass receipt or dated owner deferral to L6 or L8.

## Plan / Todo (lot-based)
- [x] **Lot 0 entry gate verification DONE 2026-10-18, verdict PASS**
  - [x] Branch feat/memory-mcp-l5-lot1 verified, base 9ed96eb83 equals #685 merge commit, #697 merge 8c3a44c17 present in ancestry, Lot 0 tooling present under tools/memory-mcp-l5.
  - [x] L0 co-acceptance recorded: engram 60a8bfa8 co-signed in .tmp/engram-mcp/cofreeze-L0b-recheck.md, verdict CO-SIGN with notes, one non-blocking minor diagnostic note R1.
  - [x] #685 publication receipts verified on npm: @sentropic/llm-mesh@0.27.0, @sentropic/llm-gateway@0.21.0, @sentropic/cluster-mesh@0.19.1 published, CI run 39154603798 on 9ed96eb83 green.
  - [x] make ps-all run first: zero running containers, slot BR-125 free.
- [x] **Lot 1 frozen contracts, trusted dispatch and pre-candidate DONE 2026-10-18**
  - [x] Enact L5-EX1 after gate closure; implement root memory-l5-lint, memory-l5-tooling, memory-l5-pack, memory-l5-test, memory-l5-packed, memory-l5-receipt and memory-l5-gate targets.
  - [x] Update root typecheck-mcp-platform, test-mcp-platform, typecheck-mcp-broker, test-mcp-broker, build-mcp-broker and api-extract-mcp-platform recipes for the public dependency, exports, and SCOPE.
  - [x] Wire .github/workflows/ci.yml pull_request changes filter (memory_l5) and required memory-l5-qualification job running the root gate, no continue-on-error, keeping unrelated jobs and filters intact.
  - [x] Add platform src/memory/contracts.ts, invocation-context.ts, mutation-guard.ts, confirmation.ts, index.ts and broker src/memory/context-projection.ts, compiled-dispatch.ts, contracts.ts, index.ts.
  - [x] Add public platform ./memory export and broker dependency on @sentropic/mcp-platform (^0.3.0), update package-lock.json under EX1, no better-sqlite3 dependency or peer.
  - [x] Replace broker sibling-source imports with public package contracts, require verified context and audit in broker.ts and context.ts, derive registry.ts only from compiled plan, remove public ConnectorRegistry/DuplicateConnectorError/createInMemoryContext/InMemoryContextOptions with no fallback.
  - [x] Freeze broker root runtime exports as McpProviderBroker, McpBrokerError, UnknownConnectorError plus type exports InvokeOptions, SecretResolver, record all export keys in exports-v1.json with exact equality tests.
  - [x] Apply the seven module dispositions individually from the preparation plan, use new production memory ports and reference only, no dual memory path.
  - [x] Preserve full verified context provenance fields listed in the preparation plan Lot 1, refuse missing or substituted context before reservation or provider or effect.
  - [x] New platform tests: packages/mcp-platform/tests/memory/invocation-context.test.ts, mutation-guard.test.ts, confirmation.test.ts, mutation-digest-vectors.test.ts.
  - [x] New broker tests: packages/mcp-broker/tests/memory/invocation-context.test.ts, source-binding.test.ts, forged-call.test.ts, literal-true.test.ts, audit-refusal.test.ts, plus update packages/mcp-broker/tests/broker.test.ts for required trusted context.
  - [x] API tests: existing packages/mcp-platform/tests/request-identity.test.ts and wire-parity.test.ts and registry-dispatch.test.ts verified green, no api/** application tests.
  - [x] UI tests: none.
  - [x] E2E tests: none in Lot 1.
  - [x] Scoped broker command: make test-mcp-broker SCOPE=tests/memory/source-binding.test.ts API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5, repeat per named broker file.
  - [x] Scoped platform command: make test-mcp-platform SCOPE=tests/memory/mutation-digest-vectors.test.ts API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5, repeat per named platform file.
  - [x] Lot gate: make typecheck-mcp-platform typecheck-mcp-broker memory-l5-lint memory-l5-tooling memory-l5-test LOT=1 API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5.
  - [x] Exit pack: make memory-l5-pack STAGE=pre-candidate ARTIFACT_MANIFEST=tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json API_PORT=9625 UI_PORT=5825 MAILDEV_UI_PORT=1725 ENV=test-feat-memory-mcp-l5 (sha256 e789412a5df3efee15359494c561ae9f0f7add68969dcf46fa31de16a429ac2a).
  - [ ] Hand immutable P1 plus manifest SHA-256 and per-artifact versions and hashes and consumed-contract inventory and fixture and export digests to gr-conductor with the exact handoff text, record receiving owner ACK and Node-matrix alignment and E2 request.
