# SPEC_EVOL_SANDBOX_NODE — ExecutionNodeV1 + tenant model freeze (S1-T0)

Status: FROZEN for S1-A1a / S1-K1 / S1-B1. Open points are listed in §8 and are explicitly NOT frozen.

## 1. Decisions frozen by this spec

- D1 (host): single VM OVH BHS b3-16 (4 vCPU / 16 GiB / 100 GB NVMe), cgroup v2 slices, gVisor systrap only, escalation to b3-32 when multi-tenant RSS > 12.5 GiB (B6a).
- D8 (operator): operated by the k8s session (IaC, hardening, pinned runsc systrap, systemd/cgroup, mTLS, supervision). Agent delivered by sentropic as a digest-pinned artifact. BHS residency. Removal only with >= 7 days notice plus evidence.
- Tenants: exactly 2 concurrent tenants, `sentropic` and `immo`.
- Contract: `contractVersion` is `execution-node.v1` (see `apps/sandbox-node/src/contract.ts`, the normative amendable module).
- Focus baseline: real Focus `ab86a9f13` for live/publish gates (D14-b PR due 13/11 12h00).

## 2. Tenant model (frozen)

- Isolation key: every call and object carries a mandatory `tenantId`; sandbox isolation is keyed on `(tenantId, sessionId | jobId)`.
- Warm standby pools are partitioned: `poolOwned = system:warm-pool:<tenantId>`. A cross-tenant claim is rejected (`403` / `409`).
- cgroup v2 slices: `tenant-sentropic.slice` and `tenant-immo.slice` with `MemoryMin 4 GiB`, `MemoryHigh 6.5 GiB`, `MemoryMax 9 GiB` (burst), `CPUWeight 100`, `TasksMax 4096`, `memory.oom.group=1`.
- NVMe layout (mode `0700`, no cross-tenant dedup or reads):
  `/var/lib/execution-node/tenants/<tenantId>/bases/<kind>/<identityDigest>.erofs` and
  `/var/lib/execution-node/tenants/<tenantId>/sandboxes/<uid>/{upper,work,retained}`.
- Zero static secret on the VM: S3 access uses short-lived presigned URLs scoped to the `s3://.../tenants/<tenantId>/...` prefix, with BHS host validation.
- Admission: at least 1 live + 1 standby slot reserved per tenant. Over-quota scheduling uses WFQ/DRR 1:1 and returns `429 tenant_quota_exceeded` with `retryAfterMs`.
- Observability: every audit row and metric carries `tenant_id` (+ `purpose`, `node_instance_id`); all evidence stays in BHS.

## 3. ExecutionNodeV1 identity and transport (frozen)

- `contractVersion`: `execution-node.v1`.
- Transport is agnostic (`inbound-mtls` / `outbound-relay`) and never changes the `/v1/*` routes.
- mTLS roles: `control-plane` vs `data-plane`, plus headers `X-Tenant-Id`, `X-Expected-Physical-Uid`, `X-Custody-Token` carrying a `SignedCustodyToken { tenantId, principalId, custodyEpoch, resourceId, deadlineAt }`.
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

- `GET /v1/node`: real S1 capabilities (`classes: ["sandbox"]`), instance id + epoch.
- `GET`/`PUT /v1/tenants/:tenantId/quotas`, `GET /v1/tenants/:tenantId/bases/:baseId` (`kind`: `rootfs | dependencies | source | prebundle | vendor-esm...`; cross-tenant base read -> `403 cross_tenant_base_forbidden`).
- `POST /v1/sandboxes` (`SandboxSpec`: `tenantId`, `physicalUid`, `profile`, `runtimeClass`, `baseMounts` read-only, writable overlay on `/workspace`, `quotaMiB` + inodes, process `uid:gid`, `network` (`none` | ports allowlist), `exec`/`pty`/`snapshots` flags).
- `POST /v1/sandboxes/:id/claim` (`ClaimSpec`; see §4), `GET` list/detail, `POST renew`, `POST stop { retainOutput, outputSubPath (ui/dist), retentionTtlMs <= 300 s }` (cgroup kill, empty `populated`, `allProcessesExited: true`), `POST artifacts/export { subPath (ui/dist), tar.zst, presignedPutUrl, maxBytes }` allowed only in `stopped-output-retained | exported` (`409 sandbox_still_running`; idempotent; read by a read-only runsc-side reader, symlink-safe), `DELETE` (state `destroyed`).
- `GET /v1/events` (SSE/NDJSON filtered by `tenantId`), `POST /v1/node/drain` (single-scheduler drain).
- S2 (isolates, when enabled): `POST /v1/isolates` (+ `renew` / `DELETE`; single-tenant host `workerd` under `runsc --network=none`).
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
