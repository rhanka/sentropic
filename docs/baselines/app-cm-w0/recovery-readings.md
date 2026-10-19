# F1/F2 recovery and historical-content readings

Collected under `AGENT_SIG:7f3a9c2e1b`. All times are UTC on 19 October 2026. These are existing evidence reads; no backup, restore, migration or database connection was initiated. The standalone [collector](readings.mk) loads no `.env`. Its offline container has no network and mounts existing archives read-only; raw SQL/content never reaches the terminal or committed records.

| Observation | Collection time | Command / retained output |
|---|---|---|
| Existing production-labelled archive | 00:17:11 | `rtk make -f docs/baselines/app-cm-w0/readings.mk w0-archive ENV=test-app-cm-w0`; [archive-reading.txt](archive-reading.txt) |
| Existing preprod source/restored count receipts | 00:17:12 | `rtk make -f docs/baselines/app-cm-w0/readings.mk w0-local-restore ENV=test-app-cm-w0`; same retained output |
| Existing CI backup/restore and preprod deployment status | 00:17:30 | `rtk make -f docs/baselines/app-cm-w0/readings.mk w0-ci-recovery ENV=test-app-cm-w0`; [ci-recovery-reading.txt](ci-recovery-reading.txt) |
| Archive journal/source checksum match | 00:17:42 | `sha256sum api/drizzle/0041_track_owner_signatures.sql api/drizzle/control/0007_cluster_mesh_r13.sql`, through the Make-only inspection wrapper |

Archive: `/home/antoinefa/src/sentropic/data/backup/prod-2026-10-17T21-56-20.dump`, 1,777,675 bytes; internal creation **18 October 01:56:21 UTC**. SHA-256 `4e3bbf6dc2897ed9597d0b9944879f54e007a86f3b7b279bccebaa26dcb6c14f`. Its filename is a provenance label, not independently verified current-cluster identity. PostgreSQL/pg_dump 17.11; 671 TOC entries. All 42 product and 8 control journal rows/checksums are retained without application data. Maximum journal timestamps map by source checksum to product `0041_track_owner_signatures` (`32cf3ac6c66c9ea8526ec8168a9a9252ccb8de491d4fea9ebb124ba1d9200e48`) and control `0007_cluster_mesh_r13` (`248ce19dc427a43a34ecd0f2b1aee8fdca1be948e9ea647b7a16a83bd64068e0`). These are snapshot frontiers; source maxima and current applied frontiers differ in meaning. Package journals and live author/generation/lease state remain unread.

| Historical source in this archive | Rows | Reference observations |
|---|---:|---|
| `context_documents` | 15 | 13 nonempty `storage_key` fields; no object existence assertion |
| `context_document_versions` | 0 | Snapshot only |
| `job_queue` | 258 | 1 result row contains both `storageBucket`/`storageKey` keys; 0 contain `contentBase64` |
| `chat_messages` | 141 | 0 nonempty `attachments`; tool-result references were not inventoried |

The [COPY counter](archive-inventory.awk) counts rows and key presence, without decoding documents, emitting identities or checking JSON semantics. A two-table synthetic COPY fixture verified table separation, one storage reference and empty attachments before capture. Zero key-presence counts do not prove no historical generated outputs. Existing S3/document buckets, external Google references and the generic artifact-store filesystem/S3 backend are outside this database archive. Tenant/workspace grouping, ownership/ACL joins, object checksums/existence and an explicit per-source disposition remain B04 requirements; no import or leave-in-place decision is made here.

The two existing preprod count files have identical SHA-256 `63c7ecf04d4ec5bd9ed0bcb88b4f2905fc09623f4d4ccef28f525134f14f2dad` and 26 September mtimes. Their selected counts are product/control journals 42/8, and documents/versions/jobs/messages all 0. Matching count receipts demonstrate only that historical comparison; they do not establish current preprod emptiness or restored content/grant parity.

CI run [39154603798](https://github.com/rhanka/sentropic/actions/runs/39154603798), job [117759494574](https://github.com/rhanka/sentropic/actions/runs/39154603798/job/117759494574), reports successful production database backup **18 October 18:38:35–18:38:41**, then successful restore/smoke **18:38:41–18:39:44**, with teardown through **18:40:05**. This is an existing CI-reported SQL restore receipt, not a new W0 restore. Job [117761055256](https://github.com/rhanka/sentropic/actions/runs/39154603798/job/117761055256) reports preprod deployment success **18:58:58–19:00:49**; that status does not identify current pod digests. The query uses `per_page=100`; all 84 jobs fit on that page.

B03 remains open: the CI metadata does not bind its backup bytes to this local archive, nor supply private-object checkpoints or restored object/ACL/revocation validation. The owner's [Q1 answer](owner-decisions.md) assigns all human recovery roles to him, with agent execution; ownership is settled. Required access is read-only access to the applicable backup catalogue/checkpoint metadata and retained isolated-restore receipts for the actual tenant/environment; an S3 object reader must be scoped to the existing document, generated-output and artifact-store locations. The locally configured relay/session and other-tenant readers are not substituted. No secret values or archive data are committed.
