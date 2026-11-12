# Sandbox-node operator guide (S1 agent-core, BHS b3-16)

DEFINITION ONLY. Nothing here deploys anything: the k8s session (S1-K1)
owns provisioning and hardening. Never apply against prod/preprod.

## 1. Host prerequisites (all mandatory, verified before install)

| Prerequisite | Requirement | Verify |
|---|---|---|
| OS/kernel | Linux, cgroup v2 hierarchy | `stat -fc %T /sys/fs/cgroup` prints `cgroup2fs` |
| Filesystems | `overlay` + `erofs` modules for upper/work and EROFS bases | `lsmod \| grep -E 'overlay|erofs'` |
| Firewall | `nftables` active, default-deny egress for sandbox slices | `nft list ruleset` shows the sandbox chain |
| `runsc` | gVisor systrap, `--network=none` only; version + SHA-256 recorded in `PINS.md` | `runsc --version`; `sha256sum $(command -v runsc)` |
| `crun` | OCI runtime for system containers; version + SHA-256 in `PINS.md` | `crun --version`; `sha256sum $(command -v crun)` |
| Layout | `/var/lib/execution-node/tenants/<id>/{bases,sandboxes}` mode `0700` | `stat -c %a` per tenant dir |
| Slices | `tenant-sentropic.slice` / `tenant-immo.slice` (MemoryMin 4G, High 6.5G, Max 9G, CPUWeight 100, TasksMax 4096, `memory.oom.group=1`) | `systemctl show <slice> -p MemoryMin,MemoryHigh,MemoryMax,CPUWeight` |

No static secret lives on the VM: S3 access uses short-lived presigned
URLs scoped to `s3://.../tenants/<tenantId>/...`, validated on the BHS host.

## 2. Build the reproducible artifact

From the worktree root (needs Docker only, no stack):

- `sh apps/sandbox-node/k8s/build-artifact.sh`
- Check `apps/sandbox-node/k8s/out/SHA256SUMS` with `sha256sum -c`.
- Record the published image digest in `PINS.md`, then replace the
  `image:` tag in `sandbox-node.DaemonSet.yaml` with that digest.

## 3. Freshness and contract gates

- Contract surface is frozen at `execution-node.v1`
  (`packages/contracts/src/execution-node-v1.ts`); amend that module only.
- Unit qualification (fake adapter, no `runsc` needed):
  `make test-api-endpoints SCOPE=apps/sandbox-node/tests ENV=test-sandbox-node`.
- Real-`runsc` paths compile everywhere but spawn only where the binary
  exists (`hasRunsc()` gate); they fail closed in CI.

## 4. Out of scope for this artifact

Provisioning, mTLS wiring, single-scheduler drain supervision, and the
open spec points (D2/D3/D4/D5-M1-vs-M2/D6/D7/D14) belong to S1-K1/S1-B1.
Removal of a node requires >= 7 days notice plus evidence (spec D8).
