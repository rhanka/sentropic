# W0 baseline — 18 October 2026

Source authority: `9ed96eb83cd77da710f1adeb83a19e425d6c4910` (initial HEAD = origin/main). Approved plan SHA-256: `166e9bbf2c580ee61b3decc9c3a4c758db579a38783eb212cf80f0a3a43c816a`; section 3 is the execution contract. Owner request: “Comment avance app sentropic stp il faut vraiment migrer au long cours et faire le switch dans la semaine”. W0 launch GO is the 2026-10-18 task packet, `AGENT_SIG:7f3a9c2e1b`; no candidate merge or production action is authorized.

## Evidence boundary

Initial observations began at 23:26 UTC with registry/GitHub GETs, unauthenticated HTTPS GETs and pinned source reads. The 19 October follow-up collected [read-only cluster metadata and precise access denials](cluster-readings.md), plus [existing archive/CI recovery evidence and historical counts](recovery-readings.md). The accessible Scaleway namespaces have zero replicas/pods; OVH's local scoped account cannot list either app namespace. Their observations cannot identify the serving deployment. Current tenant DB/object inventories remain **pending**, not empty. This record does not qualify W0 for downstream dispatch until [authorization.md](authorization.md) closes.

| Required runtime fact | Frozen value / receipt |
|---|---|
| Production API, UI and IdP `imageID` digests; pod UID/start time | **Pending B01**; source HEAD and `:main` are not running-image evidence |
| Preprod API, UI and IdP digests | **Pending B01**; health 200 alone does not identify an image |
| Content role digest | No content Deployment in pinned source; live absence not verified; pending B01 |
| Live config revision and rendered config hash | **Pending B01**; source config hashes are in `published-tuple.json` |
| Applied product/control/package migration frontier | **Pending live B02**; archived SQL checksums identify product `0041`/control `0007`; source maxima remain product `0043`, control `0011` |
| Active author, generation, cutover and lease records | **Pending B02**; no source constant is promoted to live authority |
| Verified backup/object checkpoint and isolated restore | **Partial B03**; existing CI-reported SQL backup/restore/smoke receipt collected; current object checkpoint, data/deny-state recovery and ownership still pending |
| Existing generated-content counts and mapping decision | **Partial B04**; dated local archive: 15 documents, 0 versions, 258 jobs, 141 messages; current inventory, objects/ACLs and disposition pending |

## Existing authorities and endpoint parity

Paths are relative to the pinned repository. The product mounts 28 namespaces with one module author each (`api/tests/api/cluster-mesh-namespace-inventory.test.ts:14`); W2 must retain this inventory and separate product/IdP OAuth projections.

| Surface | Current source authority / parity to retain |
|---|---|
| MCP transport | `api/src/routes/namespaces/mcp.ts:41`: current `/api/v1/mcp` mount, protected-resource metadata, `/invoke`, `/resources/read`, `/`; both Google Drive and Gmail use the same connector host for invoke and resource reads |
| MCP identity | `mcp.ts:74`: verified `sub`, `clientId`, `tid`, scopes from existing auth port; workspace selector/default resolution remains host-owned and requires current authorization |
| MCP writer fence | `mcp.ts:128`: source author `cluster-mesh-mcp-module`; cutover `(product,/mcp)` must be active with the selected runtime generation; supervisor registration/lease precedes effects |
| Runtime/control | `api/src/services/cluster-mesh-adapter.ts:183,337`: injected PostgreSQL runtime/cutover stores; PTY and instruction resolution are not a qualified remote-control path |
| OAuth/session | Product `/api/v1/oauth/end_session`, IdP `/api/v1/auth/oauth/end_session`, both `/api/v1/auth/session`; separate composition roots, unchanged issuers |
| Gateway/chat/flow | Existing `/gw`, chat and workflow engines/journals remain authoritative; no replacement loop or implicit adoption |
| Comments/D1 | Existing `PgCommentStore` (`api/src/services/comments/instance.ts:18`) remains active; D1 service/binding stays available, with D2 capture/control off |
| Catalogue | Five existing kinds and one composite registry; new private provider metadata requires W4's request context before exposure |

Public GET observations (TLS validation succeeded; no session/token supplied): production and preprod `/api/v1/health` **200**; production `/api/v1/auth/session` **401**; production GET `/api/v1/mcp` **404**. This does not establish positive authenticated MCP parity or the live enable flag. The root-host GET `/.well-known/oauth-protected-resource/api/v1/mcp` returned the UI HTML shell, not usable JSON metadata; preserve/test the actual mounted metadata paths in W2. The initial CI jobs-detail HTTP 502 is superseded by the retained paginated [CI metadata receipt](ci-recovery-reading.txt): preprod deployment succeeded, without proving current pod digests.

## Configured domains

| Environment / purpose | Pinned source configuration and public evidence |
|---|---|
| Production app | `https://sentropic.sent-tech.ca`; base API WebAuthn RP ID `sent-tech.ca`, exact app origin; Google Drive/Gmail callback base is this origin (`deploy/k8s/base/30-api.yaml`) |
| Production IdP | `https://auth.sent-tech.ca`; public discovery GET confirms issuer, `/api/v1/auth/oauth/{authorize,token}`, `/.well-known/jwks.json`; ConfigMap has wildcard CORS `https://*.sent-tech.ca`, requiring W3 sibling-origin qualification |
| Preprod app / IdP | `https://preprod.sentropic.sent-tech.ca` / `https://preprod.auth.sent-tech.ca`; public IdP discovery confirms its issuer. API RP ID is `preprod.sentropic.sent-tech.ca`; IdP RP ID is `sent-tech.ca` (overlay patches) |
| Future stable / pinned content | `<artifactId>.sentropic.sent-tech.ca` / `<releaseId>.pinned.sentropic.sent-tech.ca`; owner-set names, DNS/TLS/routing unprovisioned by W0; both wildcard depths need separate proof |

Do not derive a new IdP hostname under the app domain. `auth.sentropic.sent-tech.ca` did not resolve and is not the configured issuer. Session-level OIDC 2FA and structured permission cards remain the owner's policy; no repeated per-action challenge is introduced.

## Existing generated-content sources

| Store/path | Existing data responsibility and required inventory |
|---|---|
| `context_documents` + `context_document_versions` SQL / `DOC_STORAGE_BUCKET` | Local uploads use `documents/<workspace>/<context type>/<context id>/...`; Google Drive references can have no storage key (`api/src/db/schema.ts:789,821`; `routes/namespaces/documents/product-documents.ts:586`). Count by tenant/workspace/source without exporting content or object names |
| `job_queue.result` + object store | DOCX/PPTX/XLSX downloads consume `storageBucket/storageKey`; legacy completed jobs can hold `contentBase64` (`product-{docx,pptx,xlsx}.ts:188,56,149`). Inventory both representations and dangling objects before deciding import scope |
| Chat tool results / attachments | `chat-service.ts:4734,4831` writes generated blobs and returns storage references; `chat_messages.attachments` holds references (`schema.ts:658`). Retain conversation/workspace ownership in any mapping |
| Existing generic `artifact-store` | Selects S3 when configured, otherwise local FS (`services/artifact-store/index.ts:12`); this document/storage seam is not `sentropic.artifacts` and must not be renamed into a migration claim |

W1 creates additive new-provider storage; it does not prove historical data migration. B04 must record counts, scope/ACL correspondence, checksums and whether legacy items remain under their existing authority or need an explicit mapping/import lot. Keep existing downloads readable; never assume zero legacy data. W5 rollback preserves new committed artifacts and deny state without rewinding the product database.
