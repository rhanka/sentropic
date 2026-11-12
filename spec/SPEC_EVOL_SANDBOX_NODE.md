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

- G-VM-PROV (S1-K0, T0+6h): provisioned VM, zero code dependency.
- G-VM-AGENT (S1-K1, T0+15h): agent service active, `/v1/node` plus B7-ISO 8/8.
- G-A (S1-B1, T0+20h): Focus `ab86a9f13` cold live < 5 s + publish `stop -> export` to BHS S3 < 25 s (with D14-c).
- G-B (T0+28h): claim < 1 s + L4 + D14-b.
- G-PUB: D5-S1 whole app p95 <= 20 s target / < 25 s contract (S5); S6 < 40 s; D5-S2 <= 8 s / < 12 s only for the D14-a standalone page.
- G-ISO: 100% refusal of egress / `169.254` / cross-tenant / double claim; dm-verity, else OD-4 visa; BHS residency.
- G-RECOVERY / G-RB: monotone `nodeEpoch`, `409 stale_node_epoch`, single-scheduler drain.

## 8. Explicitly NOT frozen (owner decisions pending)

- D2 (order #1007, non-critical + OD-4 visa), D3 (default D3-A stateless; B8-SRC p95 <= 1.5 s else D3-B MKS PVC), D4 (D4-A `T_open_full` p95 <= 0.90 s / max < 1 s vs D4-B `T_routable` p95 < 1 s; default failover D4-B, target S1-V2), D5-M1 vs M2 (default M1, B5 N=10), D5-S1 vs S2 indexed on D14, D6 (S1-P0 30 min: D6-C on vRack else D6-B 4-6 h, D6-A +6 h option), D7 (D7-A: B3-CSP test under real live headers, pre-authorized `worker-src 'self' blob:`), D14 ((a1) whole app + D14-c now + D14-b recommended; (a2) `ui/artifact/` stays a contractual evolution of +12-20 h).
