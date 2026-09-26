# Changelog

## 0.13.0

- Move the optional peers to the Lot D release tuple: llm-mesh `>=0.22.0 <0.23.0`
  (route quote API) and llm-gateway `>=0.19.0 <0.20.0` (opt-in budget admission).
  mcp-auth `>=0.2.1 <0.3.0`, auth-hono `^0.15.0` and jose `^5.10.0` are unchanged.
  The previous tuple (llm-mesh 0.21.x, llm-gateway 0.18.x) is refused at install
  (npm peer resolution: `ERESOLVE`, or the old pair dropped) and at runtime.
- **Behavior change:** the automatic topology guard of every leaf, loader and compose
  entry now also enforces the accepted peer ranges (llm-mesh entries: llm-mesh;
  gateway entries: llm-gateway and llm-mesh), on the copies cluster-mesh resolves.
  A static-leaf consumer with an out-of-range peer (partial bump, forced tree) now
  fails at first leaf evaluation with `ClusterMeshTopologyError`
  (`cluster_mesh_topology_invalid`, reason `incompatible_version`, message naming the
  installed version and the required range) instead of later. Previously only
  `verifyClusterMeshTopology` and the loaders checked ranges; it remains an optional
  earlier check. `sideEffects` lists the two new family guard modules. Range checks
  accept release versions only: prereleases never satisfy, `+build` metadata is
  ignored (npm parity).
- **Public union change:** the gated module ids `focus`, `cli` and `build-cli` are
  removed from `CLUSTER_MESH_GATED_MODULE_IDS`, `ClusterMeshGatedModuleId` and
  `ClusterMeshModuleId` (and from the module catalog and `probe()`/`snapshot()` maps).
  Reason: the owner removes cli, build-cli and focus from sentropic; focus is
  reintroduced only after an owner decision on who carries it. The `/cli` transport
  namespace of the Hono plugin is a separate contract and is unchanged.
- Lazy surface otherwise identical to 0.12.0: same leaves, loaders, compose entries
  and `cluster_mesh_topology_invalid` code. A standalone gateway host can project
  `/gw` at the root with `mounts: { '/gw': '/' }` (no source change).
- Packed qualification (`packaging.mk`): optional `SIBLING_ARCHIVES_FILE` (exactly
  `tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json`) resolves the train
  fixtures from sibling archives validated by the CI `loadSiblings` (receipts packed at
  the current commit) with registry fallback; a cluster-mesh receipt is the qualified
  candidate; the `selected` lockfile pins the registry URL and the sibling bytes'
  sha512; `check-train-lock-integrity` compares it with the published `dist.tarball`
  and `dist.integrity`. New packed cases: missing-jose refusal, old-tuple and partial-
  bump refusal at install (recorded npm outcome) and runtime, every leaf importing in
  single-tree and global topologies.

## 0.12.0

- Add the lazy LLM/gateway integration surface: static `export *` leaves
  `/llm-mesh`, `/llm-mesh/facade`, `/llm-mesh/enrollment`, `/llm-mesh/node`,
  `/llm-mesh/transport/cloud-code`, `/gateway`, `/gateway/auth` (service mode) and
  `/gateway/auth-hono` (session mode); typed loaders under `/loaders/*`; namespace
  wrappers `/compose/llm-mesh` and `/compose/gateway` on the existing synchronous plugin.
- Declare llm-mesh `>=0.21.2 <0.22.0`, llm-gateway `>=0.18.0 <0.19.0`, mcp-auth
  `>=0.2.1 <0.3.0`, auth-hono `^0.15.0` and jose `^5.10.0` as optional peers. The root
  keeps no JS or declaration edge to any of them; llm-mesh and llm-gateway gain no
  dependency on cluster-mesh. gateway 0.17.x is rejected.
- Add `createClusterMeshModules`, `ClusterMeshModuleUnavailableError`
  (`code: 'cluster_mesh_module_unavailable'`, recognize by code),
  `isClusterMeshModuleUnavailableError`, metadata-only `probe()` and optional
  `capabilities.modules` via `createDegenerateClusterMesh({ modules })`. F1 binding
  getters and all 0.11 exports are unchanged.
- Gateway auth loaders are startup preflights resolving mcp-auth/jose or auth-hono
  from the installed gateway location, so a missing or incompatible peer fails
  before bind instead of on the first authenticated request.
- Add a per-thread topology guard evaluated by every leaf/loader/compose entry and
  the explicit `verifyClusterMeshTopology()` preflight (`ClusterMeshTopologyError`,
  `code: 'cluster_mesh_topology_invalid'`). `sideEffects` now lists those entries.
  Re-evaluating the same file (HMR, test-runner module resets) is not a duplicate.
- The registry imports the metadata-resolved provider file; the root graph has no
  provider specifier, so bundling the root embeds no provider, auth or jose code.
- Qualified with npm only; esbuild is the tested bundler.
- Catalogue MCP, Track, memory and other capabilities as `source_unavailable`;
  their adapters ship in a later minor.
- Migration (h2a and other consumers):
  - Complete 0.9 → 0.10 (`commandRef`, strict keys, verified custody), 0.10.1 and
    0.11 adaptations first; move a 0.9 pin to 0.12.0 in the same artifact.
  - Adapt to gateway 0.18 `CallerAuthPort`/auth types, then replace specifiers only:
    `@sentropic/llm-mesh[/x]` → `@sentropic/cluster-mesh/llm-mesh[/x]`,
    `@sentropic/llm-gateway` → `@sentropic/cluster-mesh/gateway`; calls and
    `import type` stay unchanged.
  - Declare the selected peers in every manifest that imports a leaf; keep exactly
    one cluster-mesh and one llm-mesh shared with the gateway in the installed tree.
  - Await `loadGatewayAuth(modules)` or `loadGatewayAuthHono(modules)` and
    `verifyClusterMeshTopology()` before binding; catch native link failures at the
    existing dynamic runtime import.
  - Externalize `@sentropic/cluster-mesh` and `@sentropic/cluster-mesh/*` in tsup/esbuild.

## 0.11.0

- Add runtime binding availability reporting and gating for local devices and projections,
  including optional per-kind projection support and effective `localProjectionKinds`.
- Intentional type widenings: `capabilities.localDevices` and `localProjection` now
  return `'available' | 'gated'`; `GatedCapability` adds `local_devices`,
  `local_projection` and `device_denial`. Update exhaustive type checks accordingly.
- Accept a shape-checked, trusted injected NHI lifecycle, retaining the command-runner default.
- Forward optional attestation role/scope; reject empty and option-like role/scope/instance
  arguments with `InvalidNhiArgumentError` before command execution.
- Delegate optional device denial. The adapter now always exposes `denyDeviceCode`,
  although the interface remains optional; legacy ports throw
  `CapabilityGatedError('device_denial')`. Feature detection by method presence flips:
  presence no longer proves support; track the host binding or handle the gated error.
- Validate optional signed-projection timestamps on creation and resolution; add
  canonical signing bytes and opt-in strict expiry, maximum TTL and clock skew.
- Export `verifyCustodySignature` from the package root. This does not close F8,
  which requires a separate h2a-internal verify-only module.
- Document SemVer, the N/N-1 compatibility window and major/removal conformance gates.
- Preserve 0.10.1 inputs and port implementations; client-signed projections (F5) remain open.
- Add reusable h2a-facing conformance fixtures for the N/N-1 release gate.
- Migration: 0.9 → 0.11 requires the 0.10.0 adaptations (`commandId` → `commandRef`
  on the session-router wire, strict keys, mandatory custody).

## 0.10.1

- Add the signed message client with send, receive and acknowledgement helpers
  (PR #590; `85c207a2d`, `bdb0e644f`, version `cced28636`).
- Skip malformed or invalid-signature poison messages during client drain so
  valid later messages remain consumable (`056a5ec75`).

## 0.10.0

- Add bounded-local custody issuance, verification, lifecycle and trust-root ports
  (PR #586; `accf70c89`).
- Integrate M05 launch context and custody/gateway authorization into registration
  and the session router (`6fa1e2dcc`).
- Add M01 bounded-local messaging: authorization, delivery, acknowledgements,
  subscriptions, capacity/expiry handling, native drain and actuation handoff
  (`777c11f44`; version `c80a810ca`).
- Reject deferred custody actuation at the messaging handoff (`aafa965c8`).
- These historical runtime contract changes require consumer adaptation from 0.9;
  they predate the compatibility policy introduced in 0.11.0.

## 0.9.0

### Changed

- Breaking: verified invocation contexts now require custody; missing custody is
  denied with `custody_required`.
- Breaking: actuator ports require `probeState`, actuation results require
  `outcome`, and session control ports require `instructions`.
- Breaking: registration authorization now uses the `authorize(context, action)`
  signature.
- Breaking: actuation adds the contract-level `deferred` outcome. The current API
  consumer cannot store it until a future owner-gated control migration.
- Breaking: `/auth/session/control/*` bodies now require `commandRef`. A body with
  both `commandId` and `commandRef` is accepted and `commandId` is ignored; a body
  with `commandId` alone returns HTTP 400.
