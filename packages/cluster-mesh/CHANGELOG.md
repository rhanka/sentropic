# Changelog

## 0.26.0-dev.25

- T4a storage CMF-S1 structural blob bridge contract (`storage/artifact-blob.ts`):
  `ArtifactBlobPort` with buffer clone and SHA-256 pre-I/O check, conditional
  create-only puts, digest-verified reads, `CommonBoundedPage` keyset listing
  with opaque scope-bound integrity-protected continuations (CR-1/CR-2/CR-4),
  composite `db+s3` routing with union paging, maintain-right deletes (CR-5).

## 0.26.0-dev.24

- T5a CM providers, code only (flag-gated, no state move, no migration): CMP-L1
  gateway `pool`/`authResolver`/`dispatch` wiring with the app workload principal
  (GD-14), CMP-L3 in-process internal gateway wrapper, CMP-P1 versioned prompt
  registry (GD-7) with settings-seeded API adapter, CMP-E1 multi-app email port
  with allowlist/rate/audit, and CODE move of the object-type registry
  validation into `@sentropic/ubo-contracts` (private, no bump).

## 0.26.0-dev.22

- Merge `origin/main` (llm-mesh 0.35.0, llm-gateway 0.22.6, `<0.36.0` range) and refresh the
  `selected` packaging fixture lock for the merged tree. No functional change to the
  notifications module; version bump keeps the package above `origin/main` (`dev.21`).

## 0.26.0-dev.21

- Ops job-failure notifications (`notifications` module): frozen `OpsJobFailureV1` event
  contract (product `targetKey`, closed reason taxonomy, 1 KiB detail cap), pure incident
  state machine (dedup, 24 h digest, escalation at 3 consecutive failures or 24 h firing,
  1 h anti-flap, 10 mails/h/target cap, dead-man `stale`) and a `RecipientsPort` v1 backed
  by a validated platform declaration (target to account ids, never hardcoded emails).

## 0.26.0-dev.19

- Identity replica sync (`mapA4IdentitySource` provenance): legacy WebAuthn credentials carry
  no RP column while the app and the IdP registered into the same table, so the import stamps
  them only on a single-RP tier and fails closed otherwise (`CM_IDENTITY_CUTOVER_IDP_RP_ID`
  declared by the operator, compared against the tier `rpId`). Unknown or split provenance
  refuses the import instead of guessing.

## 0.26.0-dev.18

- GitHub App router (`createGitHubAppRouter`): responses carry `referrer-policy: same-origin`
  (was `no-referrer`). Under `no-referrer` a browser sends `Origin: null` on a non-CORS form POST,
  so the router's own enroll and rotation forms always failed the strict `csrf()` Origin check
  (`access_denied`). `csrf()` is unchanged: only the exact public origin passes, never `"null"`.
  Cross-origin requests (the manifest form to github.com) still carry no referrer.
- GitHub App manifest (`createGitHubAppEnrollment().prompt`): no `default_events` key. GitHub
  rejected the manifest listing `installation` and `installation_repositories` (it delivers both
  to every App webhook without a subscription); `hook_attributes` and the webhook handler are
  unchanged.
- GitHub App enrollment (`prompt`, `GET /github-app/:ref`): an `install` record with an App is
  re-prompted with a fresh one-time state (the previous one is overwritten, 10 minute expiry) and a
  link to `https://github.com/apps/<slug>/installations/new?state=<state>`, so a lost installation
  redirect is resumable. `prompt` now returns a `phase` discriminant (`manifest` | `install`).

## 0.26.0-dev.17

- Heavy-phase queue pod slots: `createHeavyPhaseQueue` requires `maxPods`; a `pod` ticket
  (`HeavyPhaseSlotKind`) is admitted while fewer than `maxPods` pods are present and then becomes
  the subject's pod hold (its pod base) until `hold(pod: false)`. A waiting pod slot reports
  `blockedBy: 'pods'` and holds back later pod slots only, never the phases of present pods; a
  memory phase that does not fit still holds back a later pod slot (strict FIFO on the budget).
- `PROVISIONAL_HEAVY_PHASE_COSTS_MIB.build` is 1370 MiB (was 1261): the measured clean-build peak at the
  1536Mi builder pod limit (1388.6 MiB) minus the 19 MiB pod base.

## 0.26.0-dev.16

- Heavy-phase queue: the provisional live reservation (`PROVISIONAL_HEAVY_PHASE_COSTS_MIB.dev`) is
  390 MiB (was 418), measured in one live pod cgroup with `MALLOC_ARENA_MAX=2` and
  `GOMEMLIMIT=256MiB`. The documented d2-4 budget is 1641 MiB with a 19 MiB pod base, so four
  lives fit one node and a pre-bundle still fits beside one live only. Admission rules unchanged.

## 0.26.0-dev.15

- Add a durable strict-FIFO heavy-phase queue per node (`runtime/heavy-phase-queue`, root export)
  with an injectable memory or Postgres store: admission when pod bases, live reservations,
  admitted phases and the phase cost fit the node memory budget, a build only with no other live,
  ticket TTL, `seed` after a restart and `status` with queue positions.

## 0.26.0-dev.14

- Add GitHub App enrollment with owner/scope/repository-bound callbacks,
  encrypted credential custody, selected-repository installation and a
  short-lived installation-lease broker for artifacts Git operations.
- Add App-key and webhook-secret rotation, bounded verification overlap,
  revocation fencing and host invalidation callbacks. Keys and webhook
  secrets remain in cluster-mesh custody; hosts compose their durable store
  and authenticated routes before enrollment and real-forge qualification.
- Invalidation identifies the superseded lease epoch, including retry after a
  notification or token-revocation failure. App-key rotation advances to a new
  epoch only after invalidation and revocation succeed, preserving both fresh
  leases and the immediate local fence on outstanding operations.

## 0.26.0-dev.5

- Add the A2.0b identity custody extension bundle (contract 1.1.0, atomic
  deletion 2.0.0): WebAuthn custody, unbound single-use proofs, digest-only
  invitations, bound login sessions with hash rotation, stable social
  subjects, id-preserving verification-material-preserving import and
  all-or-rollback atomic person deletion on both durable profiles.

## 0.23.0

- Allow STT-only dictation, TTS-only synthesis and independent stages alongside
  duplex. Guard the speech peer at 0.28 before import, and pin canonical content
  digests in profile selections, projections, reload history checks and consent.
- Add versioned `speechProfiles` to cluster configuration and the `./speech`
  subpath for exact catalogue projection and explicit quiescent rebind.
  Independent STT/TTS or native-duplex bindings support every declared
  provider/model/adapter and the five placements, with both microphone modes.
- Profiles carry opaque policy/account/resource/budget references; projection
  checks tenant, workspace, capabilities, media and egress without credentials,
  implicit fallback, microphone activation or gateway admission.
- Root exports the provider-free schema/decoder; importing `./speech` needs
  the optional `@sentropic/llm-mesh` peer with the L1 speech contract (0.28).
- Extend the unchanged comments leaf's self-version range to admit this
  additive minor. The next minor remains refused until qualified.

## 0.22.0

- Align manifest and runtime admission with spec r2 R4:
  `@sentropic/llm-mesh 0.19.2 || >=0.22.0 <0.28.0`. The exact Radar
  0.19.2 release is admitted; 0.20/0.21 remain excluded.
- Add the `engram-memory` module registration increment (contract
  `memory-binding-v1`): pinned semantic manifest, JCS/NFC codecs, fixed
  work limits, K7/K8/P3 first-proof validators and the public
  `@sentropic/cluster-mesh/engram-memory` leaf. Registry already holds
  0.21.0, so this additive feature ships as 0.22.0.
- Admit `engram-memory` in the shared storage module union with Postgres
  registration/storage factories and explicit host SQLite driver injection.
  Composition refuses with typed errors while G1b tables, the G1d provider
  seam and qualified durable profiles are unavailable; no fallback driver.

## 0.19.1

- Widen optional peer ranges to the PR1 durable/exact routing union:
  `@sentropic/llm-mesh >=0.22.0 <0.28.0` and `@sentropic/llm-gateway >=0.19.0 <0.22.0`
  in `package.json` and `src/modules/catalog.ts`. Retain the previously qualified
  `0.22.x`–`0.26.x` / `0.19.x`–`0.20.x` tuples while admitting `0.27.0` / `0.21.0`.

## 0.19.0

- Add the generic K1–K4 storage port and injected-driver PostgreSQL backend,
  with immutable boundaries, staged publication, retained receipts, visibility
  barriers, fenced writers, outbox and qualified purge profiles.
- Add comments M2 storage, import transport, complete typed receipt recovery,
  retained export/readback and canonical HTTP composition. Frozen comments M1
  remains unchanged; `@sentropic/comments@^0.3.0` is an optional peer.
- Export `./storage`, `./storage/postgres`, `./comments`, `./comments/hono`,
  `./loaders/comments` and `./compose/comments`; ship `assets/storage`.
- Pin runtime `@stablelib/sha256@2.0.1` for portable restartable digest state.
- Require a host-managed stable PostgreSQL cursor key. Verify asset-owned DDL
  with typed drift errors and explicit operator re-attestation. Core and module
  migrations have independent local version chains and explicit dependencies.
- Merge PR #679 first, then rebase this candidate and recheck/re-bump above
  main and npm before publication.

## 0.18.0

- Widen optional peer ranges to the #662 union: llm-mesh `>=0.22.0 <0.27.0`, llm-gateway `>=0.19.0 <0.21.0` (V7-M1). The strict published-tuple install test (`tests/packaging/tuple-strict.spec.ts`) proves a plain `npm install` with no `--legacy-peer-deps` escape.
- Add the production RFC 8693 exchange binding (`src/trust/token-exchange-http.ts`):
  authenticated form POST with `client_secret_basic` to the configured issuer,
  bounded timeout/body, no redirects, redacted errors, and full validation of the
  returned token (signature, issuer, exact audience, subject, workload `client_id`,
  mandatory `act`, scope subset, 300-second and subject-expiry TTL ceilings).
- Harden the exchange client: caller-supplied actors refused, empty requested
  scopes refused, exact target-audience allowlist and single subject-audience
  equality required at construction, workload `act`/`client_id` always asserted,
  `maxTtlSec` hard-capped at 300 seconds.
- Harden the mandatory cache: identity key (subject fingerprint/`jti`, origin and
  workload clients, environment, tenant, policy revision), bounded entries with
  insertion-order eviction, single-flight, subject/tenant invalidation hooks,
  early-use safety margin, and recomputed `expiresIn` on hits.
- `createDegenerateClusterMesh({ tokenExchange })` replaces `tokenExchangeIssuer`:
  `capabilities.tokenExchange` is `'available'` only after the binding plus policy
  passes its local preflight, `'gated'` otherwise. `available` proves only this
  trust/egress port, not registry or module delivery.
- Expose the MCP leaf entries `./mcp/registry`, `./mcp/stdio`, `./compose/mcp`
  and `./loaders/mcp` (`createMcpNamespaceModule`, `loadMcpPlatform*` loaders)
  against the optional `@sentropic/mcp-platform >=0.3.0 <0.4.0` peer (plus
  `@modelcontextprotocol/sdk ^1.31.0` for stdio).
- Add `./mcp/artifacts` (`createArtifactsBuiltin`) for the `sentropic.artifacts`
  provider and `loadArtifactsMcp` through `./loaders/mcp`. The selected leaf needs
  the optional `@sentropic/artifacts >=0.1.0 <0.2.0` peer and the MCP platform
  peer above; importing the root does not load artifacts.

## 0.16.0

- Post-#664 version bump strictly greater than npm (0.15.0) and main
  (0.15.0) for the same native Anthropic relay release train:
  cluster-mesh 0.16.0, llm-mesh 0.26.0 and llm-gateway 0.20.0. No runtime
  change from main's 0.15.0 (the live-storage registration export is
  inherited): keeps the `>=0.22.0 <0.27.0` / `>=0.19.0 <0.21.0` peer
  ceilings and qualifies the same train.
- Retain the previously qualified llm-mesh 0.22.x / llm-gateway 0.19.x tuple.
  Prereleases remain outside the window.

## 0.14.0

- Widen the optional LLM peer ranges to llm-mesh `>=0.22.0 <0.27.0` and
  llm-gateway `>=0.19.0 <0.21.0` for the native Anthropic relay release train:
  cluster-mesh 0.14.0, llm-mesh 0.26.0 and llm-gateway 0.20.0. The 0.14.0 /
  0.26.0 / 0.20.0 tuple is reserved and still unpublished.
- Retain the previously qualified llm-mesh 0.22.x / llm-gateway 0.19.x tuple.
  Prereleases remain outside the window; the old 0.21.x / 0.18.x skew is still
  refused. Existing topology and lazy-load behavior is unchanged beyond the two
  accepted ranges.
- Gateway 0.20.0 requires llm-mesh `^0.26.0`; upgrade those providers together
  and retain one physical llm-mesh shared with the gateway. mcp-auth
  `>=0.2.1 <0.3.0`, auth-hono `^0.15.0` and jose `^5.10.0` remain unchanged.

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
