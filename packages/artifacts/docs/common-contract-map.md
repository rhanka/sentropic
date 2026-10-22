# Common-contract map (L0, immo #861)

Data-only reuse map between `@sentropic/artifacts` (0.2.0 line) and the
mesh common storage contract
(`packages/cluster-mesh/src/storage/common-contract.ts`, version `1`).
No runtime dependency: artifacts core keeps host-neutral ports and the
platform-free `/mcp-core` runtime, and must never import
`@sentropic/cluster-mesh`. The data-only barrel export lives in the mesh
lot (L7). This file freezes the mapping rules L7 implements.

## Reuse table

| Common contract | Reuse rule for the mesh artifacts boundary |
| --- | --- |
| `CommonCapability`, `CommonRight`, `hasCommonRight` | Reuse principal, explicit rights, scope and policy revision. A read capability must never confer prepare, publish or maintain. An empty grant gives no rights; denial is never encoded as a valid empty capability. |
| `CommonPublicationCondition` | Reuse publication identity, expected predecessor, scope, incarnation, writer fence and operation identity. The actual predecessor/fence is validated at finalization; a type validator alone never proves the fence is current. |
| `CommonObjectCommitment` | Mesh-side evidence keeps byte length and lowercase 64-hex SHA-256. Artifacts `sha256:<hex>` blob references convert by stripping the prefix; the prefixed string is never passed as the common digest. |
| `CommonManifestBody` | Preserve version-first refusal, source boundary, schema/descriptor/encoding identities, predecessor and complete terminal inventory. Count is a decimal string equal to the object count; the digest excludes its own field. No artifacts manifest codec replaces these rules. |
| `CommonBoundedPage` | Bounded in item count and encoded bytes with opaque continuation. Radar tool-level offset/limit is a separate API and never claims the common cursor contract. |

## Boundaries

- Artifacts is not a registered common storage module (`storage/contracts.ts`
  accepts only `comments` and `engram-live`); L0 claims no common-manifest
  conformance for it and migrates no artifact persistence into the common engine.
- Artifacts scope is an opaque `storageScopeId`; common scope is
  `{tenantId, workspaceId}`. A trusted host mapping connects them; string
  equality or a caller-provided tenant is insufficient.
- Tool selection is a composition constraint and confers no storage rights.
