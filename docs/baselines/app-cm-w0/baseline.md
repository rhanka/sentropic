# W0 baseline — 18 October 2026

Source authority: `9ed96eb83cd77da710f1adeb83a19e425d6c4910` (initial HEAD = origin/main). Approved plan SHA-256: `166e9bbf2c580ee61b3decc9c3a4c758db579a38783eb212cf80f0a3a43c816a`; section 3 is the execution contract. Owner request: “Comment avance app sentropic stp il faut vraiment migrer au long cours et faire le switch dans la semaine”. W0 launch GO is the 2026-10-18 task packet, `AGENT_SIG:7f3a9c2e1b`; no candidate merge or production action is authorized.

19 October follow-up: origin/main `cf0ad8ee44f9bb7cf4ad1222a468172f0f77fc2d` was integrated unchanged at fe26214df under the owner's explicit instruction. The [verbatim Q1–Q4 answers](owner-decisions.md) supersede the original plan's staffing/window and signer/key choices. No PR merge or deployment is authorized. The initial source/lock/package observations retain their original source SHA and collection date; they are not observations of the integrated main or its published packages.

## Current W0-close.a/d extension — 26 October

Current main `fbfe68f0e40d386e6b3429abc2ea8f868fcdd3f6` was merged without rebase at `79a4f2703ffd34ad2b66999d3daf8b7516e90735`; only BRANCH.md conflicted. [Published/source tuple](published-tuple-2026-10-26.json) selects artifacts 0.2.0 / mesh 0.22.1 and retains the full workspace-lock reference and whole installed published tree. Old observations below keep their original dates/source pins.

- **B01 supplied:** [endpoint/config receipt](endpoint-config-2026-10-26.md), live hashes and Ingress→Service→ready-Pod/proxy binding; prod/preprod public health/session/MCP 200/401/404 and 200/401/401. Positive authenticated parity remains W2.
- **B02 supplied as observed baseline:** [package/authority receipt](package-authority-2026-10-26.md); no artifacts schema/package journal, 17/4 active cutovers, no generation/server/registration/lease rows. Do not infer a valid writer fence; W2 must qualify it before effects.
- **B04 supplied:** [dated scoped inventory/disposition](legacy-inventory-2026-10-26.md); 15 documents, 258 jobs, 141 messages, 14 verified private objects; all sources explicitly left in place with readers retained. Four unscoped chat messages are excluded from import.
- **B06 number reconciliation closed:** [reservations](reservations.md) withdraw 0017, preserve #677's 0012–0019 and reserve verified-free control 0020. APP-P1/internal ports, branch bases and W2.b lock turn are frozen in the receiving handoffs.
- **W0 still pending:** B03 object-version/checkpoint and isolated restore, plus B08 two independent exact-head reviews/reconciliation. Restore lots b/c were not performed. Missing published UP-T durable activation/receipt separately gates W1.c; no local duplicate is authorized by this evidence update.

## Historical evidence boundary — 18–22 October

Initial observations began at 23:26 UTC with registry/GitHub GETs, unauthenticated HTTPS GETs and pinned source reads. The 19 October follow-up collected [inactive-cluster metadata and scoped-account denials](cluster-readings.md), plus [archive/CI recovery evidence and historical counts](recovery-readings.md). The [21 October tenant-admin metadata collection](tenant-readings-2026-10-21.md), explicitly authorized by the owner, records running prod/preprod/remote images, controller ownership and config revisions without RBAC refusal. The [22 October read-only collection](migration-backup-readings-2026-10-22.md) adds live product/control migration frontiers and latest backup receipts in prod/preprod, also without refusal. The older zero-pod observations describe a different cluster. Endpoint-to-cluster binding, rendered config hashes and current application-data/private-object inventories remain **pending**, not empty. This record does not qualify W0 for downstream dispatch until [authorization.md](authorization.md) closes.

| Required runtime fact | Frozen value / receipt |
|---|---|
| Production API, UI and IdP `imageID` digests; pod UID/start time | **Recorded B01**, 2026-10-21 13:10:10–18 UTC; API/IdP `sha256:f2173e9d37f525a3cef0d6148dded71765c594b775d54426486df90d82a2cbe3`, UI `sha256:a3b3458814a7e91aaf1b94728d51222c1b8c35c196ec980c152c9c17e684b316`; UIDs/start times and verified controller chains in [tenant readings](tenant-readings-2026-10-21.md) |
| Preprod API, UI and IdP digests; pod UID/start time | **Recorded B01**, same collection; API/IdP `sha256:bb1c2e72882e8bfeb91afb2a1af940b8c44a7cca8b764a585dcf94f91c1e8561`, UI `sha256:a3b3458814a7e91aaf1b94728d51222c1b8c35c196ec980c152c9c17e684b316`; UIDs/start times and verified controller chains in [tenant readings](tenant-readings-2026-10-21.md) |
| Content role digest | No `artifact-content` or other content-role Deployment in prod, preprod or remote; all Deployment/pod owners accounted for in tenant readings; no content digest exists in this inventory |
| Live config revision and rendered config hash | ConfigMap/Secret names/resourceVersions and Deployment revisions/references **recorded B01** in tenant readings; rendered hashes uncollected because ConfigMap/Secret data reads are excluded; source hashes retain their original pin in `published-tuple.json` |
| Applied product/control/package migration frontier | **Recorded live B02 product/control**, 22 Oct: both DBs `app` have product count/max ID `44/44`, frontier `0043_immo_token_exchange`; control `11/11`, timestamp frontier `0010_live_git_declarations`; frontier hashes match source. [Dated readings](migration-backup-readings-2026-10-22.md) retain hashes/timestamps and explain control journal ordering; package journals remain pending |
| Active author, generation, cutover and lease records | **Pending B02**; no source constant is promoted to live authority |
| Verified backup/object checkpoint and isolated restore | **Recorded B03 latest upload receipts**, 22 Oct: prod `s3://sentropic-pgbackup/pg/20261022T021501Z.sql.gz`, preprod `s3://sentropic-pgbackup-preprod/pg/20261022T021502Z.sql.gz`; successful jobs completed `02:15:18Z` / `02:15:10Z`. [Dated readings](migration-backup-readings-2026-10-22.md) retain sizes/status; checksums, current private-object checkpoint and data/deny-state restore proof remain pending; restore test outside scope |
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
