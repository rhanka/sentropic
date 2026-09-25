# @sentropic/cluster-mesh

Injectable Cluster Mesh control-plane contracts and a functional single-instance
runtime.

## Compatibility and releases

Sentropic owns this package and its releases in `rhanka/sentropic`. Starting with
0.11.0, releases follow SemVer: patches fix defects without changing contracts,
minor releases add backward-compatible functionality, and incompatible changes
require a major release. This compatibility commitment also applies during 0.x;
the historical breaking 0.9/0.10 changes predate this policy.

The supported compatibility window is N and N-1: the current and immediately
preceding minor release lines within the current major (initially 0.11.x and
0.10.x). Existing N-1 consumer inputs, ports and signed references remain valid
on N; new optional features require capability detection. This is an API and
contract compatibility promise, not an automatic upgrade or indefinite security
maintenance promise. Consumers should pin exact versions and lock integrity;
an older peer need not understand new optional features.

Before any major bump or field removal, Sentropic and h2a must pass cross-consumer
conformance CI against both supported lines, document migration and deprecation,
and coordinate the release. The CI gate is a release requirement; this additive
release does not claim to install that cross-repository CI. Deprecated fields
remain throughout the supported window and cannot be removed in a minor release.

Reusable public-contract fixtures live in `tests/conformance/h2a-contract.json`,
with the executable runner `tests/conformance/h2a-contract.spec.ts`. They cover
the h2a-facing boundaries, capabilities, projections, devices, NHI mapping and
federal gates through public exports. For h2a EX-12, copy both files, redirect the
runner's package import to the pinned release, and run the `N/N-1 baseline` suite
on both supported lines; run `since 0.11` only on 0.11+. JSON fixtures have an
explicit format version and contain no private keys. This supplies Sentropic's
fixtures; cross-repository CI wiring remains a separate release gate.

## Upstream bindings in 0.11

`LocalDeviceAttachmentPort` and `LocalProjectionPort` accept optional readonly
`availability: 'available' | 'gated'`, including a getter for live binding state.
Omission retains the existing available behavior. `mesh.capabilities` reads the
current values; local operations reject gated bindings with `CapabilityGatedError`
before delegation. Federal capabilities remain gated. Hosts must report whether
their concrete bindings are usable; the mesh cannot probe opaque port internals.

Projection ports may provide `supportedKinds?: readonly ProjectionKind[]`; omission
supports all three kinds and an empty list supports none. Unsupported kinds fail
with `CapabilityGatedError('local_projection')` before creation or resolution.
`mesh.capabilities.localProjectionKinds` exposes the current effective kinds
(empty when the whole binding is gated). The field is optional in the public
capability type for older providers; this adapter always supplies it.

`createDegenerateClusterMesh` accepts `nhi?: NhiLifecyclePort`. It takes precedence
over `nhiRunner`; without injection, the runner retains its existing mapping.
At least one is required. Construction checks that an injected port's `attest`,
`offboard` and `exportBundle` methods are functions; malformed ports throw
`TypeError`, even when a runner is also supplied. An injected port is trusted by
design: the host owns its authorization, input validation and effects. Shape
validation does not establish behavioral equivalence to the command adapter.
`attest` accepts optional string `role` and `scope`,
forwarded as separate `--role` and `--scope` arguments before `--root`; h2a remains
the validation authority and its errors/results pass through unchanged.
The runner adapter rejects empty/whitespace-only or leading-hyphen `instance`,
`role` and `scope` values before building a command, with `InvalidNhiArgumentError`
(`code: 'invalid_nhi_argument'`, `argument` identifies the field).

Devices may implement `denyDeviceCode(userCode)`, returning `DeviceApprovalResult`.
The adapter delegates denial with the port as receiver. Hosts own the state
transition to `denied` and subsequent poll outcomes. Legacy ports remain valid;
calling denial without a binding throws `CapabilityGatedError('device_denial')`.
The method stays optional on the public domain interface for compatibility.

`SignedProjectionReference` accepts optional Unix-millisecond `expiresAt` and
`issuedAt`. Hosts must sign and verify `canonicalProjectionReferenceBytes(ref)`:
UTF-8 JSON in the fixed order `kind`, `reference`, `homeNodeId`, `issuer`, `keyId`,
`expiresAt`, `issuedAt`, omitting undefined timestamps and excluding `signature`.
Both project and resolve validate timestamps after verification and before delegation.
Legacy mode still accepts references without timestamps. `createLocalProjectionDomain`
accepts `requireExpiry: true` for strict mode, `maxTtlMs` to bound expiry minus
issued time (or current time when issued time is absent), and `clockSkewMs`
(default zero) to tolerate clock differences at expiry and issuance boundaries.
TTL must be positive; skew must be nonnegative; both are safe integer milliseconds.
`now?: () => number` defaults to `Date.now`; strict mode rejects non-finite clocks.
With zero skew, expiry equal to now is rejected; issuance after now is rejected.

Expiry is advisory unless strict mode AND an authenticating verifier are used.
It bounds the replay window (plus allowed clock skew), but does not prevent replay
inside it. Full G3 closure per D13 also requires a server challenge on the h2a side,
outside this package. Signing ownership (F5) remains unchanged.

`verifyCustodySignature` is exported from the package root for standalone Ed25519
verification; it returns false for malformed keys, signatures, or verification
failure. It does not enforce custody authorization, lifetime, or replay policy.

Package checks from the repository root:
`make typecheck-cluster-mesh ENV=<slug>` and
`make test-cluster-mesh ENV=<slug>` (use an isolated test environment).

Version 0.9 makes verified custody mandatory and adds action-aware authorization,
required instruction-resolution and target-liveness ports, and explicit actuation
outcomes to the existing central control-plane contracts. It retains the degenerate
topology introduced in 0.1: one Sentropic server, its attached local workstations,
local signed projections, and the existing device-code lifecycle. It does not
implement server-to-server federation.

## Lazy integration surface (0.12+, tuple of 0.13)

Cluster Mesh is the single integration surface for llm-mesh and llm-gateway. Those
providers stay independent packages and never depend on cluster-mesh. They are
**optional peers**: a bare install pulls none of them, and the root entry
(`@sentropic/cluster-mesh`) has no static JS or declaration edge to any of them.

| Entry | Provider | Selected optional peers |
|---|---|---|
| `/llm-mesh`, `/llm-mesh/facade`, `/llm-mesh/enrollment`, `/llm-mesh/node`, `/llm-mesh/transport/cloud-code` | matching `@sentropic/llm-mesh` entry | `@sentropic/llm-mesh >=0.22.0 <0.23.0` |
| `/gateway` | `@sentropic/llm-gateway` root (neither auth mode) | llm-mesh + `@sentropic/llm-gateway >=0.19.0 <0.20.0` |
| `/gateway/auth` (service mode) | `@sentropic/llm-gateway/auth` | gateway + `@sentropic/mcp-auth >=0.2.1 <0.3.0`, `jose ^5.10.0` |
| `/gateway/auth-hono` (session mode) | `@sentropic/llm-gateway/auth-hono` | gateway + `@sentropic/auth-hono ^0.15.0` |
| `/loaders/<leaf>` | async typed loader (`loadLlmMesh`, `loadGateway`, `loadGatewayAuth`, ...) | as its leaf, resolved on call |
| `/compose/llm-mesh`, `/compose/gateway` | `createLlmMeshNamespaceModule`, `createGatewayNamespaceModule` | as the loaders they call |

Static leaves are `export *` re-exports of the provider namespace: same values,
types, overloads and class identity. Importing a leaf selects that provider; a
missing provider fails native ESM linking of the importing module. Loaders take a
registry from `createClusterMeshModules({ disabled? })` (one per composition root) and
reject with `ClusterMeshModuleUnavailableError` (`code: 'cluster_mesh_module_unavailable'`,
reasons `disabled | not_installed | incompatible_version | export_unavailable |
load_failed | source_unavailable`). Recognize it with `isClusterMeshModuleUnavailableError`
or by `code`, never by `instanceof` (duplicate copies have distinct constructors).
`modules.probe()` reports metadata-only availability without evaluating providers;
pass `modules` to `createDegenerateClusterMesh` to expose `capabilities.modules`.
MCP and other catalogued capabilities are listed as `source_unavailable` until a
later minor delivers them.

**Startup preflight (fail closed before bind).** llm-gateway imports its auth peers
only at verification time, so importing an auth leaf proves nothing. Await
`loadGatewayAuth(modules)` (service) or `loadGatewayAuthHono(modules)` (session)
before binding any listener; they resolve and evaluate the selected peer graph
**from the installed gateway's location**. `createGatewayNamespaceModule(modules,
{ enabled, authMode: 'service' | 'session' | 'host', createRouter })` does this for
you; `host` selects no gateway auth peer (host-injected `CallerAuthPort`).

**Topology guard.** Every leaf, loader and compose entry first runs the guard, once
per set of evaluated copies: more than one evaluated cluster-mesh copy, an llm-mesh
resolved from cluster-mesh that differs from the gateway's, or (since 0.13.0) an
installed provider outside its accepted range makes the import throw
`ClusterMeshTopologyError` (`code: 'cluster_mesh_topology_invalid'`, reason
`duplicate_instance`, `divergent_llm_mesh` or `incompatible_version`, message naming
the paths, or the installed version and the required range). llm-mesh entries check
the llm-mesh range; gateway entries check the llm-gateway and llm-mesh ranges. Ranges
are checked on the copies cluster-mesh actually resolves (llm-mesh and llm-gateway from
its own physical location, the gateway's llm-mesh from the gateway's location), release
versions only: a prerelease or build-metadata version never satisfies. An absent
provider is left to the leaf import itself.
Copies are keyed by module URL without `?query`/`#hash`: a copy loaded from another
path (nested install, `npm link`, a `--preserve-symlinks` link path) is a duplicate,
while re-evaluating the same file (Vite dev/HMR, `vi.resetModules`, cache-busting
query imports in test runners) replaces its entry and is not reported.
`verifyClusterMeshTopology({ require })` from the root is an optional, earlier check
of both providers' ranges plus the `require` list. Guard state lives on
`globalThis`, so it is per thread (each `worker_threads` worker checks its own
copies); cross-process consistency stays with install/qualification gates. Limits:
under `--preserve-symlinks`, two llm-mesh instances sharing one realpath are not
detectable without importing both; and the automatic guard also refuses an
llm-mesh-only consumer when a stray gateway with a private llm-mesh copy is installed
next to it (remove that gateway copy or align its llm-mesh).

**Consumer rules.** Every manifest that declares cluster-mesh and imports a leaf
also declares that leaf's selected peers at the qualified versions; the installed
tree must hold exactly one cluster-mesh and one llm-mesh shared with the gateway.
0.13.0 is qualified with **npm only** (flat project installs, `npm ci` from a lockfile,
and a global consumer beside a separately installed runtime); other package managers
are not qualified. The tested bundler is esbuild with `@sentropic/cluster-mesh` **and**
`@sentropic/cluster-mesh/*` (and the peer packages) externalized, which keeps the
resolution anchor at the installed package; bundling the root inline (as the API
build does) embeds no provider code. TypeScript >= 5.7 is required with
`skipLibCheck: false` (hono's declarations); with `skipLibCheck: true`, a missing
peer surfaces as TS2305 on the named import. Frozen tuple (committed lockfile):
cluster-mesh 0.13.0, llm-mesh 0.22.0, llm-gateway 0.19.0, mcp-auth 0.2.1,
oauth-verify 0.1.0, jose 5.10.0, hono 4.10.7; session mode with auth-hono 0.15.0
(llm-gateway 0.19.0's declared peer range `^0.15.0`); the latest versions inside
every declared range are re-qualified on each release run. The previous tuple
(llm-mesh 0.21.x, llm-gateway 0.18.x) is refused, see "Upgrading to 0.13" below.
Release-train runs qualify the unpublished llm-mesh and llm-gateway candidates from
same-PR sibling archives validated by the CI `loadSiblings` rules (sha256, packed
identity and manifest guard, receipts packed from the current commit, no unlisted
archive) (`make -f packages/cluster-mesh/packaging.mk test-lazy-package
SIBLING_ARCHIVES_FILE=tmp/ci-manifest-guard/siblings/cluster-mesh/receipts.json`); a
receipt for cluster-mesh itself replaces the local pack as the qualified candidate. The
committed `selected` lockfile carries their registry URL and the sha512 of those bytes.

**Upgrading to 0.13.** Bump cluster-mesh 0.13, llm-mesh 0.22 and llm-gateway 0.19 in
the same commit; npm may not error on a partial bump. Measured with npm 11.19: a
consumer keeping its own `^0.21.2`/`^0.18.0` pins fails with `ERESOLVE`, while
`npm install <candidate> @sentropic/llm-mesh@0.21.2 @sentropic/llm-gateway@0.18.0`
exits 0 after "ERESOLVE overriding peer dependency" and silently drops the old pair.
What is automatic: the topology guard runs when a leaf, loader or compose module is
first evaluated, so a skewed tree (for example built with `--legacy-peer-deps`) fails
there with `incompatible_version`, naming the installed version and the required
range, before any provider module evaluates; nothing has to be called. The registry
loaders (`modules.load('gateway')`) refuse with `cluster_mesh_module_unavailable` /
`incompatible_version` as well. `verifyClusterMeshTopology()` is an optional earlier
check for hosts that mount routes before importing any leaf.

**Namespace remap.** `createClusterMeshPlugin({ mounts })` mounts each enabled module
once at `mounts[namespace] ?? namespace`. A standalone gateway host passes
`mounts: { '/gw': '/' }` and serves exactly `/healthz`, `/readyz`, `/v1/messages`,
`/v1/chat/completions` and `/v1/models` (nothing under `/gw`); the product keeps
`/gw` under its own prefix.

## Available in v1

- A directory containing the local server and its attached workstations.
- Device-code issue, poll, and approve delegation through an injected application port.
- Human identity, agent identity, and memory snapshot projections that remain on their
  declared home server and are consumed by signed reference.
- Exact local mapping of attest, offboard, and SPIFFE-bundle export to injected `h2a nhi`
  command execution.
- Tenant residence resolved only through an approved-membership port.
- Deterministic workspace references in the form `ws:sha256:<digest>`.
- One active generation and one selected author per registered namespace.
- Durable registration, capacity-lease, lifecycle, and acted-receipt ports whose
  concrete storage remains host-owned.
- A reusable Hono plugin plus injectable `/session`, `/cli`, `/health`, and
  `/workspaces` namespace transports.
- One logical MCP supervisor authority per generation, expressed through an
  injected runtime port rather than a per-session server.

Tenant identity and workspace identity are intentionally distinct. `tid` is returned by
the authoritative membership resolver; it is never copied from a request workspace id.
An unresolved membership throws `TenantBoundaryError`.

## Central control plane

`createClusterMeshPlugin` mounts independently constructed namespace modules.
The package owns selection and fail-closed author checks; product domains,
databases, provider credentials, and concrete transports stay behind injected
ports. A host may disable a module without importing its provider implementation.

The public runtime contracts model real terminal actuation and external MCP
qualification, but this package does not fabricate those integrations. A host
must provide and qualify them before claiming PTY wake/relaunch, LOST detection,
or multi-session MCP acceptance.

Production invocation verification uses a dedicated Ed25519 key ring configured
through `CLUSTER_MESH_ED25519_PUBLIC_KEYS_JSON`. Its JSON shape is
`[{"kid":"...","alg":"EdDSA","crv":"Ed25519","publicKeyBase64Url":"..."}]`,
where `publicKeyBase64Url` is base64url-encoded SPKI DER. Malformed JSON or keys
abort startup; an absent or empty ring remains fail-closed. The audience defaults
to the local session-control URL, can be set with `CLUSTER_MESH_EVIDENCE_AUDIENCE`,
and accepts only explicit comma-separated additions from
`CLUSTER_MESH_LEGACY_AUDIENCES`. Signed evidence has a maximum lifetime of 300
seconds. Shared-secret A1 evidence is restricted to explicit non-production
qualification and is rejected in production.

## Gated seams

The public surface already defines the future federal ports, but the v1 runtime fails
closed for all of them:

- inter-server discovery and member revocation;
- RFC 8693 token exchange;
- remote signed-projection resolution;
- memory snapshot replication and purge.

Invoking one of these seams throws `CapabilityGatedError`. The package exposes no broker
HTTP route, trusted-issuer store, inter-server directory, or replication runtime.

## Construction

`createDegenerateClusterMesh` composes the membership, trust, wrap, device, and
tenant-boundary domains. `createClusterMeshPlugin` composes the central namespace
surface. Every effectful operation is supplied through a typed port, so the
package owns no application persistence or provider transport.

```ts
import { createDegenerateClusterMesh } from '@sentropic/cluster-mesh';

const mesh = createDegenerateClusterMesh({
  self,
  workstations,
  memberships,
  projections,
  nhiRunner,
  devices,
});

console.log(mesh.capabilities.mode); // single-node
```

## Publication

Manual publication is forbidden. For the first release, merge the validated package,
run the `ci.yml` workflow with `bootstrap_publish_target=cluster-mesh`, then attach the
npm OIDC trusted publisher to `rhanka/sentropic` and `ci.yml`. Later releases use the
repository CI publication path.
