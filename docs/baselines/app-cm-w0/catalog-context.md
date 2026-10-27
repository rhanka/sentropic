# W4 request context handoff

## 26 October receiving freeze

Current workspace base is `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6`; [published/source tuple and exact trees](published-tuple-2026-10-26.json), [APP-P1/internal ports and loaded Comments/gateway fit](host-fit.md). This supersedes the old unrestricted artifacts catalogue assumed by the 18 October prototype; the context signatures/authorization rules below remain required. Original line-number citations are historical seam locators, not assertions about current line positions.

W4 consumes W2's **same compiled four-name map**: `artifacts_ensure`, `artifacts_publish`, `artifacts_list`, `artifacts_get`. Filter that map with freshly resolved subject/session/tenant/workspace/membership/consent/policy/read-only authority before discovery/ranking/counts. Public HTTP and chat execution both carry the trusted invocation context to W1's same coordinator/service; no identity or authority is deserialized from tool args. Immutable profile, selected-capability and manifest digests bind the same input; W2/W4 qualify that binding at the accepted integration head.

The legacy Google Drive/Gmail catalogue/reader surfaces retain their own current scopes and verified account selectors. Four-tool APP-P1 selection applies to the artifacts provider, not a replacement for connector authorization. Reader activation/content access and host cleanup/GC are the separately frozen internal ports: never include them as catalogue tools or use them to dispatch an unselected public mutation. Extra artifacts capabilities require upstream qualification before catalogue exposure.

[Current legacy disposition](legacy-inventory-2026-10-26.md) leaves each source in place. Four unscoped historical chat messages supply no tenant/workspace authority for import, even though their users exist. W4 may expose new private artifacts only through the required fresh context; it does not relabel old documents/jobs/conversations into artifacts or retire their readers. UP-T durable activation remains an upstream W1.c dependency as recorded in host-fit; W4 neither implements that adapter nor bypasses it.

T4 implements this contract; W0 freezes its shape and callers only. The current seams omit context: `routes/namespaces/catalog.ts:36,78`, `services/skills/catalog.ts:254`, `foundation-executor.ts:199,583`, `catalog/execution-seam.ts:145`. Existing auth middleware on some routes does not make the global projection safe for private entries.

## Server-only type and resolver

New `api/src/services/catalog/request-context.ts` defines:

```ts
type CatalogRequestContext = Readonly<{
  subjectId: string; sessionId: string;
  tenantId: string; workspaceId: string;
  membershipRef: string; consentRef: string;
  policyVersion: string; readOnly: boolean;
  allowedTools: readonly string[];
}>;
type CatalogInvocationContext = CatalogRequestContext;
// Inputs below are server-owned values, never deserialized model claims.
resolveHttpCatalogContext(authenticatedRequest): Promise<CatalogRequestContext>;
resolveTurnCatalogContext(verifiedTurn): Promise<CatalogRequestContext>;
revalidateCatalogInvocation(context, tool, resourceSelectors): Promise<CatalogInvocationContext>;
```

`authenticatedRequest` is the existing `requireAuth`-validated session/user and an untrusted requested workspace selector. `verifiedTurn` comes from `options.userId/sessionId`, server-owned `sessionWorkspaceId`, `readOnly` and the effective server turn tool allowlist. Exact transport input types remain host-local; neither resolver accepts a context-shaped JSON payload. Construct frozen objects/arrays; TypeScript `Readonly` alone is insufficient runtime isolation. Policy references identify server-owned snapshots, carry no tokens and grant no authority by themselves.

Both resolvers verify current session validity, workspace membership/non-deletion, consent and policy. Resolve tenant with **`resolveTenantAuthoritatively({workspaceId,userId})`**, checking its discriminated result. Use `getWorkspaceRole`/`requireWorkspaceAccess` and `isWorkspaceDeleted` as applicable. Do not reuse `reconcileTenantId`: alias/shadow modes return the workspace ID (`services/tenancy/resolve-tenant.ts:168`). Missing/ambiguous tenant, session or membership fails closed for private host operations. Session-level MFA follows existing owner policy.

## Required signature/caller changes

| Owner file(s), relative to `api/src/` | Frozen handoff |
|---|---|
| `routes/namespaces/catalog.ts`, `catalog-product-ports.ts` | Inject `resolveContext`; require trusted context on **all** `CatalogDiscoveryPort.list(filter,context)`, `get(name,context)`, `search(input,context)`, `sources(context)` calls; authenticate every mounted path |
| `services/skills/catalog.ts` | `executeFoundationSearchCatalog({payload,context})`; `resolveFoundationChatTools` selects from the same permitted request-local view |
| `services/skills/foundation-executor.ts`, bounded `services/chat-service.ts` | Build/pass context from verified turn inputs through model discovery and invocation; refresh live authority at dispatch, rather than trusting the previously advertised model tool list |
| `services/catalog/{types,source,composite-registry,execution-seam}.ts` | `execute(name,args,context)` authorizes freshly, then calls `handler(args,invocationContext)`; denied/missing-context host calls return handled denial and zero effects |
| `services/catalog/sources/{standalone-tool-source,mcp-source,host-registry-source}.ts` | Thread context separately from args through `StandaloneToolHandler`/`ToolHandlerSource`; host registry source uses exact compiled names and the W2 service adapter |

Filter metadata, source IDs, counts and search corpus **before** ranking, limiting or serialization. Unauthorized names return the absent-name behavior. Synchronous `CatalogSource.snapshot()` and projection remain I/O-free: async policy lookup happens upstream, then filters immutable descriptors/binding references per request. No singleton retains subject/workspace, mutable request state or credentials; the initial implementation has no shared filtered-view cache.

Revalidate session/membership/consent/provider/resource permissions immediately before dispatch, intersect with the server-owned turn allowlist/read-only policy, and guard mutation with policy/version checks so revocation cannot race authorization into a later write. Reject reserved subject/session/tenant/client/workspace identity claims in model args; ordinary resource selectors remain allowed but independently authorized. Denial cannot fall through to an older dispatcher. Exactly one successful create/publish effect is persisted.

## File-level acceptance scope

- Extend `api/tests/services/catalog/{composite-registry,execution-seam,search-catalog-tool,standalone-tool-source,mcp-source}.spec.ts`, `api/tests/api/cluster-mesh-catalog.test.ts`, `api/tests/unit/foundation-executor.test.ts`.
- Add `api/tests/api/catalog-auth-context.test.ts` and `api/tests/services/catalog/chat-context.integration.test.ts`: mounted HTTP and chat-service → real executor → seam → host service, rather than source-only unit calls.
- Interleave two subjects across tenants/workspaces in one shared source/process; same workspace with unequal permissions; list/get/search/sources; model search/selection; forged identity; missing context; disallowed tool; read-only mutation; revoke after discovery; zero metadata leakage/unauthorized effects; one successful persisted effect.
- Add `ui/tests/artifacts/host-flow.test.ts`, `ui/tests/catalog/access.test.ts`; W5 browser/chat E2E exercises the same composition. Five existing kinds do not claim the later sixth `app` projection.
- T4 owns these caller/security changes and the normal catalogue/artifact navigation within one 13.3 h cycle assumption. A required split adds a train slot and cycle explicitly; storage proofs do not replace this work.
