# @sentropic/cluster-mesh

Federal-shaped cluster contracts with a functional single-instance runtime.

Version 0.1 ships the degenerate topology: one Sentropic server, its attached local
workstations, local signed projections, and the existing device-code lifecycle. It does
not implement server-to-server federation.

## Available in v1

- A directory containing the local server and its attached workstations.
- Device-code issue, poll, and approve delegation through an injected application port.
- Human identity, agent identity, and memory snapshot projections that remain on their
  declared home server and are consumed by signed reference.
- Exact local mapping of attest, offboard, and SPIFFE-bundle export to injected `h2a nhi`
  command execution.
- Tenant residence resolved only through an approved-membership port.
- Deterministic workspace references in the form `ws:sha256:<digest>`.

Tenant identity and workspace identity are intentionally distinct. `tid` is returned by
the authoritative membership resolver; it is never copied from a request workspace id.
An unresolved membership throws `TenantBoundaryError`.

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

`createDegenerateClusterMesh` composes the membership, trust, wrap, device, and tenant
boundary domains. Every effectful operation is supplied through a typed port, so the
package owns no application persistence or transport.

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
