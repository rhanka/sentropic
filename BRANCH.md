# Feature: MCP-L5 generic memory transport and durable mutation qualification

## Objective
- [ ] Deliver the frozen production memory contracts, real SqliteMemoryWorkflowStoreV1 reference and mechanically verified/co-accepted L5-MEMORY-V1 against the exact packed L4 candidate.
- [ ] Preserve M14 B's independent Engram 0.20.0 release, L2 canonical authority, and later L6/L8 production bindings.

## Scope / Guardrails
- [ ] One feat/memory-mcp-l5 branch in tmp/feat-memory-mcp-l5; one PR/final release cycle, atomic internal commits; no types/store/tests/version-only branches.
- [ ] Source of truth: frozen v3.1 SHA-256 f90c927964b44fdf6ad712eee9b894762250239384643a3790931c142d3aeeca; L5-preparation-plan-v2.1.md defines the base table, L5-EX1, module dispositions, handoff and closed checkpoint contract. Transcribe those bindings into the implementation records; do not amend v3.1.
- [ ] Lot 0 permits paper/new tooling preparation only. Every shared edit waits for #679 → #685 → R2/R7a/R3 merge/publication receipts, BR3 ancestry and sole-writer handoff; do not stack on an OPEN predecessor.
- [ ] Make-only Docker execution; ENV last; no host install, no Python in host/jobs/images/toolchain, no node-gyp, no timeout inflation, no secrets or sibling-source imports in qualified artifacts.
- [ ] Node built-in node:sqlite only; unflagged minimum 22.13.0+ / 23.4.0+ on those lines. L4-against-L5 qualification runs on Node ≥22.13 only, excluding 23.0–23.3 and flag-dependent SQLite; align Engram's job matrix. Freeze exact Node 24 image digest and SQLite runtime in the receipt; no better-sqlite3 dependency/peer, install hook or addon fallback.
- [ ] P1 is immutable and identified by its manifest SHA-256, with version/SHA-256 per artifact and a closed consumed-contract inventory. E4 records that exact pre-candidate digest; qualification proves byte identity, including the broker seam and checkpoint definition. Any contract change creates a new pre-candidate and rebuilt E4; nothing qualifies across two digests. P1 carries only L4-consumed types/schemas, broker seam and L5-MEMORY-V1 definition; no runtime cluster-mesh source import or dependency for Engram 0.20.0, which excludes L4.
- [ ] Proposed BR-125 slot 0 requires conductor reservation: API_PORT=9625, UI_PORT=5825, MAILDEV_UI_PORT=1725; ENV=dev-feat-memory-mcp-l5, test-feat-memory-mcp-l5 or e2e-feat-memory-mcp-l5. Automated tests never use dev.
- [ ] Root ENV=dev remains the owner's workspace. Owner identity UAT uses disposable memory fixtures in the qualified host/preprod profile; no mutation against root production/dev memory data.
- [ ] Serialize package builds sharing output directories; record identical source/UAT HEAD and exact candidate digests; clean only owned branch environments after each lot.
- [ ] No API migration, catalog persistence/opt-in, deployed enrollment change, Graphify code change, mesh memory leaf/legacy retirement, h2a migration or second registration authority.
- [ ] English docs/code; no commit/push without the later packet's authorization. Selective staging, make commit only, fewer than 150 changed lines and at most 10–15 files per commit; use 10 as the default ceiling, never a minimum.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
  - [ ] `BRANCH.md` in this worktree only; phase-gated inventory below becomes writable at the Lot 1 L5-EX1 transfer, except new Lot 0 tooling.
  - [ ] `tools/memory-mcp-l5/**` (runner, schemas/catalog, policies, provenance-bound fixtures, packed tests and manifests; no secrets).
  - [ ] `spec/SPEC_MCP_MEMORY_L5.md`; `spec/evidence/memory-mcp-l5/**` (durable sanitized evidence tracked in git).
  - [ ] `packages/mcp-broker/src/broker.ts`, `packages/mcp-broker/src/context.ts`, `packages/mcp-broker/src/registry.ts`, `packages/mcp-broker/src/index.ts`, `packages/mcp-broker/src/memory/**`, `packages/mcp-broker/src/memory-reference/**`.
  - [ ] `packages/mcp-broker/tests/broker.test.ts`, `packages/mcp-broker/tests/memory/**`, `packages/mcp-broker/package.json`, `packages/mcp-broker/tsconfig.json`, `packages/mcp-broker/README.md`, `packages/mcp-broker/CHANGELOG.md`.
  - [ ] `packages/mcp-platform/src/memory/**`, `packages/mcp-platform/tests/memory/**`.
  - [ ] L5-EX1 packaging: `packages/mcp-platform/package.json`, `packages/mcp-platform/tsconfig.json`, `packages/mcp-platform/api-extractor.json`, `packages/mcp-platform/api-extractor.memory.json`, `packages/mcp-platform/etc/mcp-platform.api.md`, `packages/mcp-platform/etc/mcp-platform-memory.api.md`, `packages/mcp-platform/README.md`, `packages/mcp-platform/CHANGELOG.md`.
  - [ ] L5-EX1 contracts/transport: `packages/mcp-platform/src/index.ts`, `packages/mcp-platform/src/manifest.ts`, `packages/mcp-platform/src/runtime.ts`, `packages/mcp-platform/src/transport/bridge.ts`, `packages/mcp-platform/src/transport/result-codec.ts`, `packages/mcp-platform/src/transport/dispatch.ts`.
  - [ ] L5-EX1 existing platform tests: `packages/mcp-platform/tests/request-identity.test.ts`, `packages/mcp-platform/tests/wire-parity.test.ts`, `packages/mcp-platform/tests/registry-dispatch.test.ts`; all other predecessor tests are run read-only unless separately authorized.
  - [ ] L5-EX1 mesh: `packages/cluster-mesh/src/compose/mcp.ts`, `packages/cluster-mesh/package.json`, `packages/cluster-mesh/README.md`, `packages/cluster-mesh/CHANGELOG.md`, `packages/cluster-mesh/tests/mcp-composition.spec.ts`, `packages/cluster-mesh/tests/verified-invocation-context.spec.ts`, `packages/cluster-mesh/tests/memory-context.spec.ts`.
  - [ ] L5-EX1 shared tooling: root `Makefile`, `package-lock.json`, `.github/workflows/ci.yml` only.
- [ ] **Forbidden Paths (must not change in this branch)**:
  - [ ] `docker-compose*.yml`, `.cursor/rules/**`, `rules/**`, `PLAN.md`, `plan/**`, `.track/**`, `.security/**`, `scripts/**`, root `package.json`.
  - [ ] `api/**`, `ui/**`, `apps/**`, `deploy/**`, `packages/llm-mesh/**`, `packages/llm-gateway/**`, `packages/auth-hono/**`, `packages/auth-ui/**`, `packages/mcp-auth/**`, `packages/artifacts/**`, `packages/connector-host/**`, `packages/skills/**`, `packages/harness/**`.
  - [ ] `packages/mcp-platform/src/registry*.ts`, `packages/mcp-platform/src/tool-configuration.ts`, `packages/mcp-platform/src/authz.ts`, `packages/mcp-platform/src/hono.ts`, `packages/mcp-platform/src/durable.ts`, `packages/mcp-platform/src/elicitation.ts`, `packages/mcp-platform/src/persistence.ts`, `packages/mcp-platform/src/stores.ts`, `packages/mcp-platform/src/audit.ts`, `packages/mcp-platform/src/experimental/**`, `packages/mcp-platform/src/mock/**`, `packages/mcp-platform/src/testing.ts`; no unrelated mock cleanup.
  - [ ] `tools/gateway-evolution/**`, `.h2a/**`, `spec/SPEC_EVOL_LLM_MESH_GATEWAY_ROUTING.md`, the frozen memory v3.1 file, Graphify/h2a repositories and every predecessor worktree/BRANCH.md.
  - [ ] Every unlisted path is default-denied, including other .github files, mesh files and platform transport/tests; no broad Forbidden glob overlaps a listed Allowed file.
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [ ] None beyond the enumerated phase-gated L5-EX1 inventory. A needed additional predecessor-renamed path requires an exact amendment before edits.
- [ ] **Exception process**:
  - [ ] L5-EX1 is requested by the planning packet, effective only on recorded BR3/writer transfer; rationale, impact and rollback are in the preparation plan's path table and must be copied to the execution record before editing.
  - [ ] Verify actual path inventory and mechanically run harness scope checks at transfer and before authorized commits. Preserve every incoming peer/export/topology change; further scope is L5-EXn with reason/impact/rollback.

## Feedback Loop
- [ ] L5-F1 — blocked for implementation contract acceptance; owners Engram L0 + Sentropic platform/broker/mesh + h-cond. Need amended co-signed L0 commit, independently derived A05 vectors/A10 fixtures, exact context/assurance/public declarations, policy mappings and provenance-bound fixture bundle. Paper co-freeze is insufficient; do not invent ScopeRefV1/PrincipalRefV1 or verifier semantics.
- [ ] L5-F2 / SM-02 — blocked for shared writes; owner Sentropic conductor. Record B679, B685, BR3 exact merge/publication tuples, ancestry, file inventories and L5 writer transfer. Lot 1 needs #679's compiled registry/transport/SDK ^1.31.0 but starts only on BR3; Lots 2–6 remain on that ancestry. No extra memory gate for predecessors.
- [ ] L5-F3 — attention before implementation; owner Sentropic conductor. Reserve actual branch ID/slot/ports, record ENV mapping and schedule ownership; proposed BR-125 is not reserved. Reassigned ports must replace every command before execution.
- [ ] L5-F4 — attention at release windows; release/mesh + h-cond + Engram owners. Audit main/npm/reservations and both peer intervals after each rebase. L7 owns a major for legacy removal; 1.0.0 is only a candidate if still applicable/available. No L5 assignment of h2a memory train, Engram adapter version or #679's 0.18.0.
- [ ] L5-F5 — blocked only for later h2a consumer evidence; owners h-cond + existing GWRC tooling. Jointly admit memory mapping in the same closed schema/helper/verifier, retaining gateway+registry union; no unsupported program:memory, parallel consumer pipeline or extra local L5 prerequisite.
- [ ] L5-F6 / SM-03 — blocked for deployed activation; owners L6/L8 identity/storage/policy + owner. Production pins sent-tech.ca enrolled OIDC/2FA and rejects qualification tokens. Owner real-identity UAT must pass or have an explicit dated owner deferral with destination L6/L8; never self-defer. A deferral leaves deployed activation blocked.
- [ ] L5-F7 — blocked before Lot 2; owners L5 + gr-conductor/Engram. Deliver immutable P1 contracts/checkpoint definition/manifest and receive owner ACK naming its exact digest and Node-matrix alignment plus pinned E2/L0 closure. Before Lot 4, receive E4 with its exact builtAgainstPreCandidateSha256 and prove L5 contract byte identity; any contract change requires a new pre-candidate and rebuilt E4, never cross-digest qualification. Missing real E2 never permits mock substitution.
- [ ] L5-EX1 — declared with rationale/impact/rollback; activation waits only for the named writer/base gates, not an invented second approval of this requested planning scope.
