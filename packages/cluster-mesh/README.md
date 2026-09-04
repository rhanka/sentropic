# @sentropic/cluster-mesh

Injectable Cluster Mesh control-plane contracts and a functional single-instance
runtime.

Version 0.7 adds the central generation, namespace, registration, admission,
receipt, persistence-port, MCP-supervisor, and Hono plugin contracts used by the
Sentropic product and standalone IdP composition roots. It retains the degenerate
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
