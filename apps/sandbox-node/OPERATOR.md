# Standalone sandbox-node VM operator contract

Definition only: k8s owns deployment. Never deploy from this lane or touch
prod/preprod. The VM is not a Kubernetes node; no DaemonSet applies.

## Host and resources

`artifact-builder-vm-1`, OVH BHS5, d2-4: 2 shared vCPU, about 3.5 GiB
for both tenants, 48 GiB disk, Ubuntu 24.04/kernel 6.8, about 24 CAD/month.
Rollback pool `artifact-builders` stays min/desired 0, max 2.

| systemd resource | Required value |
| --- | --- |
| `builder.slice` | MemoryMax=3456M, MemorySwapMax=0, CPUQuota=180% |
| `builder-tenant.slice` | Intermediate parent required by systemd naming |
| `builder-tenant-{sentropic,immo}.slice` | MemoryMax=2560M, MemoryHigh=2304M, MemoryLow=768M, CPUWeight=100, TasksMax=4096 |
| `builder-sbx-<physicalUid>.scope` | 768M warm OR 1664M build, MemorySwapMax=0, MemoryOOMGroup=yes |

Admission reserves at most 3200 MiB including runsc sentry, cache, slab
and overlays: one warm live OR standby per tenant plus one global build.
A bounded non-preemptible queue alternates tenants strictly; full queues
or capacity return 429 before allocation. Claim transfers the standby
reservation. The 2 s/5 s live admission goal is not a build queue deadline.

Resolve the scope's effective `ControlGroup` using systemd and verify its
tenant ancestry before writing scope-only `cgroup.kill`. Require
`populated 0` for export. Stop timeout is 202/stopping, never success.

## Hardening and public transport

- Public IPv4, inbound mTLS on TCP 9443, no vRack. k8s synchronizes
  nftables allowlist of MKS egress IPs and operator IPs, default deny.
- Separate operator/control-plane/data-plane certificates; CA, cert and
  key paths are mandatory. No plaintext agent listener.
- Pin runsc systrap and crun version/SHA-256 in PINS.md before installation.
  Sandboxes use runsc `--network=none`; crun is benchmark witness only.
- EROFS/overlay support; `/var/lib/builder/tenants/<tenantId>` mode 0700.
  Enforce 16 GiB project quota and inode quota per tenant at S1-A1a.
- BHS public S3 endpoint, prefix-limited tenant keys or presigned URLs.
- No Python: Node/static probes only. Enable unattended-upgrades with
  an agreed reboot window. Rebuild from cloud-init, without snapshots.

## k8s delivery through cloud-init

Canonical provisioning is in the separate `poc-k8s` repository:
`platform/artifact-builder-vm/cloud-init.yaml`. It installs Node, pinned
runtimes, slices, firewall, `k8s/sandbox-node.service` and `k8s/start.sh`
as `/usr/local/libexec/sandbox-node-start` (0755).

k8s verifies the release archive SHA-256, extracts to
`/opt/sandbox-node/releases/<64-character-sha256>`, sets `RELEASE_DIR` in
`/etc/sandbox-node/agent.env`, and restarts the unit. Moving tags are
forbidden deployment references. Keep the previous verified digest.

`agent.env` requires `AGENT_CA`, `AGENT_CERT`, `AGENT_KEY`,
`NODE_INSTANCE_ID`, `NODE_EPOCH` and HTTPS `JOB_ALERTS_URL`;
`AGENT_PORT` defaults to 9443. Persist node identity/monotone epoch and
custody WAL across restarts; environment/cert files are mode 0600.
The cluster probes `/v1/node` using an operator certificate. The agent
sends an mTLS job-alerts heartbeat every 15 s; alert on heartbeat/probe
failure or epoch mismatch. Control-plane heartbeat loss over 5 s blocks
mutations independently of monitoring heartbeats.

## Qualification boundary

`make -f Makefile -f apps/sandbox-node/checks.mk check-sandbox-node ENV=test-sandbox-node`
checks local types and regressions without a stack; the same makefile's
`build-sandbox-node-artifact` target builds the release.

Bootstrap supportedOps is limited to node/quotas. Real OCI bundle creation,
retained-output reader, lifecycle route wiring/recovery and host isolation
remain S1-A1a/S1-K1 qualification work. Do not route live/publish until
supportedOps and host tests prove those operations. Fake unit tests are
not VM benchmark evidence. Removal requires at least 7 days notice (D8).
