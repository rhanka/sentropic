# Standalone sandbox-node VM operator contract

Definition only: k8s owns deployment. Never deploy from this lane or touch
prod/preprod. The VM is not a Kubernetes node; no DaemonSet applies.

## Host and resources

`artifact-builder-vm-1`, OVH BHS5, d2-4: 2 shared vCPU, about 3.5 GiB
for both tenants, 48 GiB disk, Ubuntu 24.04/kernel 6.8, about 24 CAD/month.
Rollback pool `artifact-builders` stays min/desired 0, max 2.

| systemd resource | Required value |
| --- | --- |
| `builder.slice` | MemoryMax=2944M, MemorySwapMax=512M, CPUQuota=180% |
| `builder-tenant.slice` | Intermediate parent required by systemd naming |
| `builder-tenant-{sentropic,immo}.slice` | MemoryMax=2304M, MemoryHigh=2048M, MemoryLow=704M, MemorySwapMax=256M, CPUWeight=100, TasksMax=4096 |
| `builder-sbx-<physicalUid>.scope` | 704M warm (swap 0) OR 1536M build (swap <=256M), MemoryOOMGroup=yes |

Measured identity: host 512 + agent 192 + parent 2944 + margin 172 = 3820 MiB.
The agent has MemoryMin=64M. k8s provides 1 GiB zram (zstd) only as a peak
absorber; it never increases RAM admission. A lower MemTotal reduces admission
and requires k8s to reduce the parent ceiling before routing traffic.

Admission reserves at most 2944 MiB including runsc sentry, cache, slab
and overlays: one warm live OR standby per tenant plus one global build.
A queue of at most two outstanding heavy jobs per tenant (active included)
alternates eligible heads strictly; full queues
or capacity return 429 before allocation. Claim transfers the standby
reservation. Service deadlines are 60 s for artifact-build and 120 s for
prebundle/cold-materialize; timeout kills and destroys before releasing the slot.
The 2 s/5 s live admission goal is not a build queue deadline.
Warm replacement requires complete destruction, including upperdir cleanup.

Resolve the scope's effective `ControlGroup` using systemd and verify its
tenant ancestry before writing scope-only `cgroup.kill`. Require
`populated 0` for export. Stop timeout is 202/stopping, never success.

## Hardening and public transport

- Public IPv4, inbound mTLS on TCP 8443, no vRack. k8s synchronizes
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
`NODE_INSTANCE_ID`, `NODE_EPOCH`, `AGENT_TICKET_PUBLIC_KEY` (Ed25519 public-key
file) and HTTPS `JOB_ALERTS_URL`;
`AGENT_PORT` defaults to 8443. Persist node identity/monotone epoch and
custody WAL across restarts; environment/cert files are mode 0600.
The cluster probes `/v1/node` using an operator certificate. The agent
sends an mTLS job-alerts heartbeat every 15 s; alert on heartbeat/probe
failure or epoch mismatch. Control-plane heartbeat loss over 5 s blocks
mutations independently of monitoring heartbeats.

## Qualification boundary

`make -f Makefile -f apps/sandbox-node/checks.mk check-sandbox-node ENV=test-sandbox-node`
checks local types and regressions without a stack; the same makefile's
`build-sandbox-node-artifact` target builds the release.

The listener wires bases/create/start/claim/stop/export/delete/renew/revoke/write.
Before routing traffic, k8s must qualify the complete lifecycle on an isolated
host with pinned runsc, EROFS, overlayfs, systemd and tenant cgroups. Local
dispatcher/bundle/filesystem regressions do not prove kernel isolation.
Removal requires at least 7 days notice (D8).

The host supplies devScope per session: `{kind,writable[],refused[],source:{repo,path,commit}}`.
The agent contains no tenant-specific allowlist. Every session mutation repeats
this exact policy; source writes go through `/write`, while sandbox processes
see source read-only. Build output `ui/dist` is a separate writable bind and
must be refused by the host's source policy.

`X-Execution-Ticket` is base64url JSON `{ticket,signature}`. Its body hash covers
`JSON.stringify(requestBody)` and binds commandId, route, owner and node identity.
Each session request includes devScope; creation carries it in spec.
`POST /v1/bases/ensure` takes `{commandId,ownership,base,url}` (HTTPS, SHA-256);
creation requires rootfs/source bases and an absolute argv command, with no shell.
`POST /v1/sandboxes/:id/start` starts a created record. `/write` takes
`{commandId,devScope,path,contentBase64}`. `/stop` takes `stop`; `/export` takes
`spec` and returns gzip bytes after quiescence; DELETE releases capacity only
after runtime state, scope, mounts and private directories are removed.
