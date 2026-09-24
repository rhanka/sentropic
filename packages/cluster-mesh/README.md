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
At least one is required. `attest` accepts optional string `role` and `scope`,
forwarded as separate `--role` and `--scope` arguments before `--root`; h2a remains
the validation authority and its errors/results pass through unchanged.

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
