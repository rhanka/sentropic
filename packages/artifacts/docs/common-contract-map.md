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

## Normative rules (spec r2 section 1.2)

Adopted subset and declared deviations against the normative common rule.
Future common-rule admission requires a separate complete qualification
and resolution of these deviations.

| Normative rule | r2 adoption or declared deviation |
| --- | --- |
| **CR-1 — immutable objects** | Adopt byte ownership, create-or-verify length/digest, nonvisible preparation and shared-reference protection. A4 requires lifecycle/ACL serialization and a deletion claim protecting external purge against reference creation. No new purge-service or restore profile is claimed. L4/L8 prove publication and collection safety. |
| **CR-2 — versioned checksum manifest** | Adopt order-sensitive command identity, immutable content commitments, version-first refusal and no silent digest migration (C6). Artifacts' existing manifest is not the common envelope: incarnation, surface/source-boundary and terminal-inventory conformance are **not claimed**. |
| **CR-3 — one atomic publication** | Adopt one visibility decision, rights revalidation, atomic durable receipt, same-key conflict/replay and unknown-COMMIT recovery. **Deviation:** each distinct publish captures the newest head under the finalization lock and rebases onto it; two preparations started on the same old head may both succeed in serialization order. This preserves existing latest-wins artifact publishing; it does not satisfy the CR-3 ban on a stale writer acquiring authority by rereading a newer head. There is no caller-supplied expected predecessor in Radar's profile. |
| **CR-4 — bounded listing/traversal** | **Deviation:** the HTTP layer loads all artifact IDs, filters visibility then slices; `listArtifactIds` is not backend scope-bounded. Radar's trusted ACL wrapper remains mandatory for foreign-scope hiding. Tool limit/offset bounds do not bound backend work or implement common cursors. This delivery records the limitation rather than expanding into a storage pagination redesign. |
| **CR-5 — separated rights** | Adopt distinct rights at the mesh boundary, current durable admission, post-wait guard, guarded retry and no authority from a receipt. **Deviation:** no universal zero-storage-call local denial stage is provided; current host admission may query SQL before denying. Selection/input refusal still makes zero provider calls. A local-first/durable-second admission pipeline and deployment-level common-rule qualification are not claimed. |

The structural bridge MUST refuse any common-rule admission or conformance claim. Selecting the four MCP tools registers no common storage module and waives none of CR-1…CR-5.

## Boundaries

- Artifacts is not a registered common storage module (`storage/contracts.ts`
  accepts only `comments` and `engram-live`); L0 claims no common-manifest
  conformance for it and migrates no artifact persistence into the common engine.
- Artifacts scope is an opaque `storageScopeId`; common scope is
  `{tenantId, workspaceId}`. A trusted host mapping connects them; string
  equality or a caller-provided tenant is insufficient.
- Tool selection is a composition constraint and confers no storage rights.
