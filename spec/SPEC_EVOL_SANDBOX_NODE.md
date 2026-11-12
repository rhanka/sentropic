# SPEC_EVOL_SANDBOX_NODE — ExecutionNodeV1 + tenant model freeze (S1-T0)

Status: FROZEN for S1-A1a / S1-K1 / S1-B1. Open points are listed in §8 and are explicitly NOT frozen.

## 1. Decisions frozen by this spec

- D1 (decided): artifact-builder-vm-1, OVH BHS5 d2-4, 2 shared vCPU / about 3.5 GiB for both tenants / 48 GiB disk, Ubuntu 24.04 kernel 6.8. gVisor systrap only. About 24 CAD/month, rollback builder pool min/desired 0, max 2.
- D8 (operator): operated by the k8s session (IaC, hardening, pinned runsc systrap, systemd/cgroup, mTLS, supervision). Agent delivered by sentropic as a digest-pinned artifact. BHS residency. Removal only with >= 7 days notice plus evidence.
- Tenants: exactly 2 concurrent tenants, `sentropic` and `immo`.
- Contract: `contractVersion` is `execution-node.v1` (see `apps/sandbox-node/src/contract.ts`, the normative amendable module).
- Focus baseline: real Focus `ab86a9f13` for live/publish gates (D14-b PR due 13/11 12h00).

## 2. Tenant model (frozen)

- Isolation key: every call and object carries a mandatory `tenantId`; sandbox isolation is keyed on `(tenantId, sessionId | jobId)`.
- Warm standby pools are partitioned: `poolOwned = system:warm-pool:<tenantId>`. A cross-tenant claim is rejected (`403` / `409`).
- Canonical hierarchy: `builder.slice/builder-tenant.slice/builder-tenant-<tenantId>.slice/builder-sbx-<physicalUid>.scope`. Parent MemoryMax=3456 MiB, MemorySwapMax=0, CPUQuota=180%. Each tenant: MemoryMax=2560 MiB, MemoryHigh=2304 MiB, MemoryLow=768 MiB, CPUWeight=100, TasksMax=4096; each scope has memory.oom.group=1. No burst fields or second build.
- NVMe layout (mode `0700`, no cross-tenant dedup or reads):
  `/var/lib/builder/tenants/<tenantId>/bases/<kind>/<identityDigest>.erofs` and
  `/var/lib/builder/tenants/<tenantId>/sandboxes/<uid>/{upper,work,retained}`.
- Zero static secret on the VM: S3 access uses short-lived presigned URLs scoped to the `s3://.../tenants/<tenantId>/...` prefix, with BHS host validation.
- AdmissionLedger: one warm live OR standby per tenant (768 MiB each), plus exactly one global publish build (1664 MiB), sum <=3200 MiB including gVisor/cache/slab. Read complete memory.current before reservation; reject 429 before OOM. Disk/project quota 16 GiB per tenant and inode quota required from S1-A1a. Claim transfers the standby reservation without double accounting.
- Publish queue: bounded, non-preemptible, strict tenant alternation; at most one adverse service ahead when both tenants wait. No 5 s build wait guarantee. Live admission alone targets p95 <=2 s/max <=5 s outside the build slot. Queue-full 429 counts as qualification failure.
- Observability: every audit row and metric carries `tenant_id` (+ `purpose`, `node_instance_id`); all evidence stays in BHS.

## 3. ExecutionNodeV1 identity and transport (frozen)

- `contractVersion`: `execution-node.v1`.
- D6-B decided: inbound mTLS on public IPv4/agent port, nftables MKS-egress/operator allowlist synchronized by k8s, no vRack. Outbound relay is S2-2, routes unchanged.
- mTLS roles: operator/control-plane/data-plane, headers X-Tenant-Id, X-Expected-Physical-Uid, X-Custody-Token. Signed custody tokens include tenantId, principalId, custodyEpoch, resourceId, issuedAt, deadlineAt; TTL <=60 s. Mutations fail closed after >5 s without authenticated control-plane heartbeat.
- `nodeInstanceId`: UUIDv4 assigned at NVMe format; `nodeEpoch`: monotone counter fsync-persisted. A new disk means a new instance id. Unknown instance returns `409 unknown_node_instance`.

## 4. Ownership and compatibility (frozen)

- Ownership (every sandbox/claim): `{ tenantId, poolOwned, workspaceId, principalId, sessionId, buildId, jobId, attemptId, purpose, generation, custodyEpoch }`.
- `standbyCompatibility` is immutable per base: `{ tenantId, repoId, sourceTreeSha256, lockSha256, prebundleDigest, rootfsBaseDigest, profile, viteConfigDigest }`. Claim requires exact `tenantId` equality plus full compatibility equality; a pool-owned standby flips `poolOwned` to `false` atomically on claim.
- Execution ticket (`X-Execution-Ticket`, Ed25519): `{ v1, tenantId, commandId, method, path, bodySha256, targetNodeId, expectedNodeInstanceId, expectedNodeEpoch, ownership, issuedAt, deadlineAt }` with `deadlineAt - issuedAt <= 30 s`.
- Idempotence-before-state rule on `(tenantId, commandId)`:
  - replay with the identical triplet (same ticket body hash) -> `200`/`201` with the original result;
  - same `commandId` with a different body -> `409 command_id_payload_mismatch`;
  - distinct `commandId` on an already claimed box -> `409 already_claimed`;
  - obsolete epoch -> `409 stale_node_epoch`.

## 5. Lifecycle (frozen)

- Normative cycle: `creating -> standby | running -> stopping -> stopped-output-retained -> exported -> destroyed` (`failed -> destroyed`).
- Normative D5-M1 build sequence: `BUILD_RECIPE` (`npm --ignore-scripts --offline run build:artifact` on a fresh box) -> `stop { retainOutput: true }` -> `export` -> `DELETE`.
- Internal W3 behavior: claim starts a new frame without restarting vite; `attach`/`applyRevision` apply at L4 onto `/workspace` (gVisor inotify); `put`/`dependencies/install` returns `410 deprecated_on_overlay_node` on the VM.
- Box network: `--network=none` plus a Unix socket (rule B1).

## 6. Endpoints (frozen surface)

- OperatorScope: `GET /v1/node` has no tenantId; reports parentSlice `{ name: 'builder.slice', memoryMaxMiB: 3456 }` and capabilities.supportedOps for actually delivered operations. All TenantScope calls require tenantId or 400 missing_tenant_id. QuotaSnapshot contains limits, effective controlGroup, usage.memoryCurrentBytes/reservedMemoryBytes and globalBuildSlot `{ maxConcurrentBuildsGlobal: 1, holderTenantId?, queueDepth }`; no burst fields.
- `GET`/`PUT /v1/tenants/:tenantId/quotas`, `GET /v1/tenants/:tenantId/bases/:baseId` (`kind`: `rootfs | dependencies | source | prebundle | vendor-esm...`; cross-tenant base read -> `403 cross_tenant_base_forbidden`).
- `POST /v1/sandboxes` (`SandboxSpec`: `tenantId`, `physicalUid`, `profile`, `runtimeClass`, `baseMounts` read-only, writable overlay on `/workspace`, `quotaMiB` + inodes, process `uid:gid`, `network` (`none` | ports allowlist), `exec`/`pty`/`snapshots` flags).
- `POST /v1/sandboxes/:id/claim`, GET list/detail (scopeName and resources.memoryCurrentBytes/memoryPeakBytes), renew, stop, export and DELETE. Stop resolves systemd ControlGroup and validates tenant ancestry (500 cgroup_tenant_mismatch, no write otherwise); scope-only cgroup.kill and cgroup.events, never tenant kill. Within 5000 ms: 200 stopped-output-retained/destroyed with allProcessesExited:true; otherwise 202 stopping/allProcessesExited:false/retryAfterMs:250. Export requires buildId and confirmed quiescence (409 sandbox_not_quiesced), read-only symlink-safe reader.
- `POST /v1/sandboxes/:physicalUid/revoke-custody { tenantId, physicalUid, minCustodyEpoch, reason }`: minCustodyEpoch=max(persisted,received), fsync before 200 `{ activeCustodyEpoch, closedStreams, ackedAt }`; close lower-epoch streams with WS 1008/TCP RST locally <=250 ms, end-to-end <=1 s. Refuse new revoked connections/invocations with 403 custody_revoked, including isolates. Epoch 2 then late epoch 1 must remain 2 across restart.
- `GET /v1/events`: exclusive TenantScope tenantId/afterSeq OR operator certificate `?scope=node` infrastructure events only. Node drain requires X-Operator-Ticket and drainScope=node OR tenant (tenantId mandatory for tenant drain).
- S2 isolates: one dedicated runsc --network=none sandbox and one dedicated workerd host per session, no intra-tenant host sharing by default. Shared-host benchmarks never qualify strict isolation.
- Data-plane: `ANY /v1/ports/:port/*`, `POST /v1/exec` (S2 cli-remote / agent-loop), `WS /v1/pty` (relay), `POST /v1/snapshots` (`tar.zst` -> tenant-scoped S3), `POST /v1/isolates/:id/invoke` (no egress; upload outside the isolate).

## 7. S1-T0 gates consuming this freeze

- G-VM-PROV: existing VM; k8s hardening about 2-3 agent-hours after artifact delivery, no signed completion date. Cloud-init/unit: poc-k8s/platform/artifact-builder-vm/cloud-init.yaml. No Python; unattended upgrades/reboot window, job-alerts heartbeat/cluster probe, pinned digest rollback and no snapshots.
- G-VM-AGENT: supportedOps must prove node/quotas/bases/create/stop/export/delete/revoke-custody; bootstrap advertises node/quotas only. G-B adds claim/applyRevision; S1-A1b/S1-F add drain/events/labels and SIGKILL WAL recovery. Never advertise undelivered operations.
- G-A/G-LIVE-COLD: real Focus ab86a9f13 on d2-4 under both tenant slices; T_open_full is the cold clock (T_routable diagnostic only). Optimize the cold path after drainage, not standby count. No inherited local Node timing qualifies this gate.
- G-B: claim <1 s, L4 and tagged D14-b release. Claim transfers standby memory. Requalify B3-COLD/B4a/B4b/B5-APP-VM/B6a-QUAL/affected B6c-WFQ and parity after DS, S1-V or S1-V2 changes; no F-FOCUS-OPT -> F-FOCUS-DS capacity transfer.
- G-PUB: current S5 <25 s plus joint S6 S5 p95 <=12 s/max <=15 s; proposed D5-S1b reallocation is not signed. Qualify only 1 warm/tenant + 1 global build (B6a-QUAL); excess workloads are rejection tests, no two-build cell. WFQ probes start immediately after adverse build start and count 429 as failures. Distinct M1/M2 export clocks compare via T_after_build.
- G-ISO: 100% refusal of egress / `169.254` / cross-tenant / double claim; dm-verity, else OD-4 visa; BHS residency.
- G-RECOVERY / G-RB: monotone `nodeEpoch`, `409 stale_node_epoch`, single-scheduler drain.

## 8. Explicitly NOT frozen (owner decisions pending)

- D2 (order #1007, non-critical + OD-4 visa), D3 (D3-A stateless, B8-SRC p95 <=1.5 s else D3-B MKS PVC), D4 (warm T_open_full vs T_routable goal, S1-V2), D5-M1 vs M2 and possible signed SLO reallocation, D7 (real CSP qualification), D14 (whole app with import/DS optimization vs separately contracted standalone page). D6 is decided; S1-P0 closed, outbound relay deferred to S2-2.

## 9. Provenance and S2 recipe amendments

- ArtifactProvenanceV1 is execution-provenance.v1: tenantId, logicalSandboxId, physicalUid, attemptId, buildCommandId, nodeInstanceId/nodeEpoch; runtime engine/version/platform/rootfsBaseId/rootfsDigest; source repoId/commitSha/treeSha256/dirtyRevisionDigest:null; bases kind/baseId/lockSha256/erofsSha256/dmVerityRootHash; recipe profile/entry/command/envAllowlistDigest/artifactModel; output subPath/fileCount/totalBytes/manifestSha256/archiveSha256; startedAt/stoppedAt/exportedAt/signatureEd25519. Ed25519 JWS covers the canonical payload, returned as provenance and X-Artifact-Provenance. Normative local type: ArtifactProvenanceV1.
- S2 ds.compile recipeKey: SHA-256 RFC 8785 JCS ds-recipe-key.v1, normalize POSIX paths first, reject 400 INVALID_SOURCE_PATH and DUPLICATE_NORMALIZED_PATH, sorted complete compilers map (version/digest), canonical compilerOptions including urlRewriteMode and always importMapManifestDigest (sha256:... or none). Distinct output digests, upload outside isolate, tenant-private bases/pinned catalog; Vapor/SSR remains unverified.
- Protocol corrections assert no measured success/calendar dates: candidates only for no-codeload gate, separate codeload witness, seven source-freshness regimes including external branch changes, N=10 exploratory/N=20 qualification. Search maximum density before 15-minute hold; reserve browser/d2-4 hosts independently; invalidate mean steal >5%.
