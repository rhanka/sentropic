# Standalone sandbox-node VM operator contract

## Round 3 real-host data-plane qualification (required before G-A)

The archive includes `qualify-data-plane.sh` and the SEA entry
`--qualify-data-plane`. On the isolated qualification host, stop
`execution-node.service`, verify the release's `SHA256SUMS`, and create the
one-shot `/etc/execution-node/isolated-qualification` authorization marker.
Run `QUALIFICATION_ONLY=isolated QUAL_RELEASE_DIR=<verified-release>
sh <verified-release>/qualify-data-plane.sh`. From a source checkout the
equivalent target is `make -f Makefile -f apps/sandbox-node/checks.mk
qualify-sandbox-node-data-plane ENV=test-sandbox-node` with those same variables.
Never run this on an active tenant host. It does not restart the service.

The SEA requires root, the inactive service, the shared node flock, an empty
runsc/scope/sandbox/mount inventory, and the installed tenant loop mount.
It consumes the marker under the lock, starts a real runsc sandbox and uses
the production daemon, API dispatch, custody guard, mTLS listener and UDS
port-forward code. All certificate authorities, client/server certificates,
signing keys and custody WAL are generated for this run only; production keys,
node epoch and custody state are never opened. The fixture serves streaming
HTTP and concurrent HMR on sandbox port 5173 and writes a retained output.

PASS receipts cover absent/untrusted certificates, wrong CN/control-plane role,
tenant, physical UID, port, epoch, principal and execution-ticket refusal for
HTTP and WS; expiry and authenticated `revoke-custody` must cut concurrent HTTP
and WS (1008) within 250 ms locally, also bounded by one second end to end.
The agent listener itself uses a private UDS in this test; host TCP listeners
are compared before sandbox creation, during forwarding and after the probes.
The qualification then exercises authenticated GET, stop (including polling
202 when returned), export and DELETE. Cleanup verifies empty inventories and
removes only its own bases/state. Failure or interruption exits nonzero and
must block G-A; investigate any cleanup failure before further qualification.

`verify-sandbox-node-artifact` checks this script's archived bytes/digest and
the SEA's refusal without isolated authorization. Local hermetic probes test
the harness; **only a PASS on the installed runsc qualifies the real host**.
k8s owns that execution, qualification receipts, installation and activation.

## Round 2 data plane and export

The updated archive adds authenticated `ANY /v1/ports/5173/*` and WebSocket
upgrades. Only mTLS CN `data-plane:artifact-content` may use these routes.
`X-Tenant-Id`, `X-Expected-Physical-Uid` and API-signed `X-Custody-Token` are
mandatory; execution tickets are refused on this plane. The six custody claims
are checked against the active sandbox owner/epoch, WAL revocation floor and
60-second TTL. Expiry/revocation cuts HTTP and sends WS close 1008.

The sandbox must opt into `network: ports`; gVisor still uses `--network=none`.
The agent creates private UDS listeners under
`/run/execution-node/ports/<physicalUid>/5173.sock`. Each connection is relayed
through `runsc --root=/run/execution-node/runsc port-forward --stream=<uds>
sandbox-<physicalUid> 5173`. This is gVisor stream mode: runsc connects once to
the UDS and donates it to the sentry, then exits. No host TCP forwarding port.
The existing worker bootstrap multiplexes live and supervisor traffic on 5173.
Operator qualification must cover concurrent HTTP/HMR, revocation and expiry
using the installed pinned runsc before G-A; hermetic fake-runtime tests do not
qualify real gVisor forwarding.

Export bodies carry a durable `destination`, not a presigned upload URL. The API
obtains fresh upload authorization outside the agent idempotency body. Signed
archive provenance now binds physicalUid, attemptId, buildId, command argv and
devScope source as well as tenant, node identity/epoch and archive SHA-256.
The API persists upload completion before DELETE, allowing a lost DELETE
response to reconcile without exporting the destroyed sandbox again.

Definition only: k8s owns deployment. Never deploy from this lane or touch
prod/preprod. The VM is not a Kubernetes node; no DaemonSet applies.

## Host and resources

`artifact-builder-vm-1`, OVH BHS5, d2-4: 2 shared vCPU, about 3.5 GiB
for both tenants, 48 GiB disk, Ubuntu 24.04/kernel 6.8, about 24 CAD/month.
Rollback pool `artifact-builders` stays min/desired 0, max 2.

| systemd resource | Required value |
| --- | --- |
| `builder.slice` | MemoryMax=2944M, MemoryLow=1408M, MemorySwapMax=512M, CPUQuota=180% |
| `builder-tenant.slice` | MemoryLow=1408M; intermediate parent required by naming |
| `builder-tenant-{sentropic,immo}.slice` | MemoryMax=2304M, MemoryHigh=2304M, MemoryLow=704M, MemorySwapMax=256M, CPUWeight=100, TasksMax=2048 |
| warm scope | MemoryMax=704M, MemoryHigh=704M, MemoryLow=704M, CPUWeight=200, swap 0 |
| build scope | MemoryMax=1536M, MemoryHigh=1408M, MemoryLow=0, CPUWeight=100, swap 256M |
| all scopes | OOMPolicy=kill (sets memory.oom.group); TasksMax and OCI pids.limit=512 for sessions, 1024 for builds (AMD-20/27) |

AMD-17: MemTotal=4,005,416,960 bytes, floor 3819 MiB;
host 512 + agent 192 + parent 2944 + margin 171 = 3819 MiB.
The agent has MemoryMin=64M (k8s also sets system.slice MemoryMin=64M).
k8s provides 1 GiB zram (zstd), mem_limit=128 MiB inside the 171 MiB margin;
it never increases RAM admission. Below floor 3819, reduce admission
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
Admission uses reservations alone (AMD-21); complete tenant memory.current,
including cache left by destroyed scopes, remains telemetry only.

Resolve the scope's effective `ControlGroup` using systemd and verify its
tenant ancestry before writing scope-only `cgroup.kill`. Require
`populated 0` for export. Stop timeout is 202/stopping, never success.

## Hardening and public transport

- Public IPv4, inbound mTLS on TCP 8443, no vRack. k8s synchronizes
  nftables allowlist of MKS egress IPs and operator IPs, default deny.
- Separate operator/control-plane/data-plane certificates; CA, cert and
  key paths are mandatory. No plaintext agent listener.
- Pin runsc systrap release-20261102.0 under `/opt/gvisor/20261102`.
  Sandboxes use runsc `--network=none`; crun is benchmark witness only.
- EROFS/overlay support; `/var/lib/builder/tenants/<tenantId>` mode 0700.
  Enforce 16 GiB project quota and inode quota per tenant at S1-A1a.
- Install `e2fsprogs`, `quota` and loop-device support. Before launch the agent
  formats a private ext4 volume with project quotas and applies the session's
  `quotaMiB`/`quotaInodes` hard limits to its upper/work/output project.
  Missing quota support fails launch; memory remains a separate 704/1536 MiB limit.
- Bucket `sentropic-execution-bhs`, prefix `tenants/<tenantId>/<env>/`.
  Presigned URLs only; ZERO static S3 secret on the VM. Sentropic control plane
  holds `SANDBOX_S3_{SENTROPIC,IMMO}_ACCESS_KEY_ID` and corresponding
  `_SECRET_ACCESS_KEY`, minted/rotated by k8s every 90 days.
- Zero project Python. Enable unattended-upgrades with
  an agreed reboot window. Rebuild from cloud-init, without snapshots.

## k8s delivery through cloud-init

Canonical provisioning is in the separate `poc-k8s` repository:
`platform/artifact-builder-vm/cloud-init.yaml`. It installs pinned
runtimes, slices, firewall, `k8s/execution-node.service` and `k8s/start.sh`
as `/usr/local/libexec/sandbox-node-start` (0755).

k8s verifies the release archive SHA-256, extracts to
`/opt/execution-node/releases/<64-character-sha256>`, sets `RELEASE_DIR` in
`/etc/execution-node/agent.env`, and restarts the unit. Moving tags are
forbidden deployment references. Keep the previous verified digest.

The archive ships a single glibc Linux x86_64 Node SEA executable; no host Node
is required (libc6/libstdc++6/libgcc-s1 must exist). It also ships `agent.env`,
the operator public key, exact unit/startup and sentropic-built shared rootfs.
Copy the shipped config, add RELEASE_DIR and install the public keys below.
TLS paths are `/etc/execution-node/tls/{ca.crt,server.crt,server.key}`;
`AGENT_PORT` defaults to 8443. CNs: `control-plane:sentropic-api`,
`data-plane:artifact-content`, `operator:cluster-controller`. TLS 1.3 required.
The agent reads `/var/lib/builder/node-instance-id` and owns/fsyncs `node-epoch`;
persist both plus custody.wal across restart. Environment/private files: 0600.
Pull-only: cluster operator probe `GET /v1/node` every 5 min, no ticket/header
tenant ID. Metrics include sandboxesActive, memoryBytes, cpuSecondsTotal,
psiStallSeconds (memory some), wfqWaitMs and cacheHitsTotal, labelled by tenant,
purpose=all aggregate. Probe stdout goes via cluster Fluent Bit to
`sentropic-cluster-logs/raw/poc-ca/builder-vm-probe/`; journald stays local.
No VM push, shipper or S3 writer. Sentropic-api alone sends
`POST /v1/node/heartbeat` every 1 s with
`{expectedNodeInstanceId,expectedNodeEpoch,sentAt}` (ISO UTC); no tenant header.
Wrong role/node/epoch or sentAt older than 5 s/future is refused.
Heartbeat absence >5 s blocks mutations; operator reads never refresh it.

## Qualification boundary

`make -f Makefile -f apps/sandbox-node/checks.mk check-sandbox-node ENV=test-sandbox-node`
checks local types and regressions without a stack; the same makefile's
`build-sandbox-node-artifact` target builds the release.

The listener wires bases/create/start/claim/stop/export/delete/renew/revoke/write.
Before routing traffic, k8s must qualify the complete lifecycle on an isolated
host with pinned runsc, EROFS, overlayfs, systemd and tenant cgroups. Local
dispatcher/bundle/filesystem regressions do not prove kernel isolation.
Removal requires at least 7 days notice (D8).

Restart is fail-closed until full adoption lands in S1-A1b. Before constructing
fresh reservation counters or listening, the agent inventories all
`builder-sbx-*.scope` units, `runsc --root=/run/execution-node/runsc list`,
both tenants' sandbox directories and sandbox mount targets in mountinfo.
Any survivor or inventory error aborts startup; a heartbeat cannot bypass this.
k8s must reconcile surviving sessions/builds before restarting: identify their
scope and runtime IDs, stop and confirm quiescence, delete the runsc state,
unmount each bundle in reverse mount order, then remove its private directory.
Preserve any required output before cleanup. Do not delete tenant roots, bases
or the runsc root to bypass the check. Startup succeeds only after every
inventory is empty. The shipped mount-visibility B-test uses a separate
qualification directory; it does not prove adoption or admission recovery.

Execution deadlines (60s artifact-build, 120s prebundle/cold-materialize) stop
at confirmed quiescence. Retained output keeps its memory reservation and the
global build slot until DELETE or retention expiry; it cannot be replaced by a
new build meanwhile. Explicit stop uses `retentionTtlMs` (0..300000, default
300000); natural successful exit retains `ui/dist` for 300000ms. Retention is
measured from confirmed stop, and successful export does not extend it.
Cleanup confirms destruction before releasing capacity; an error keeps it
reserved. A successful launcher exit before the first `running` poll follows
the same confirmed-stop/retained-output path, rather than becoming a failure.

The host supplies devScope per session: `{kind,writable[],refused[],source:{repo,path,commit}}`.
The agent contains no tenant-specific allowlist. Every session mutation repeats
this exact policy; source writes go through `/write`, while sandbox processes
see source read-only. Build output `ui/dist` is a separate writable bind and
must be refused by the host's source policy.

`X-Execution-Ticket` is base64url JSON `{ticket,signature}`. Its body hash covers
`JSON.stringify(requestBody)` and binds commandId, route, owner and node identity.
Each session request includes devScope; creation carries it in spec.
`PUT /v1/tenants/:tenantId/bases` takes `{commandId,ownership,base,url}` (HTTPS, SHA-256);
creation requires rootfs/source bases and an absolute argv command, with no shell.
Imports accept only `s3.bhs.io.cloud.ovh.net/sentropic-execution-bhs/tenants/<tenantId>/<env>/...`
or `sentropic-execution-bhs.s3.bhs.io.cloud.ovh.net/tenants/<tenantId>/<env>/...`;
`SANDBOX_ENV` binds env (shipped value preprod is configuration only). Redirects,
encoded paths, credentials and alternate ports are rejected before download.
`POST /v1/sandboxes/:id/start` starts a created record. `/write` takes
`{commandId,devScope,path,contentBase64}`. `/stop` takes `stop`; `/export` takes
`spec` and returns gzip bytes after quiescence; DELETE releases capacity only
after runtime state, scope, mounts and private directories are removed.

Authentication occurs before enqueueing a heavy request. The agent keeps an
immutable, node-epoch-bound queue entry; the original ticket's 30-second expiry
does not invalidate an already accepted wait. Service deadlines start on grant.
Each later mutation still requires a fresh ticket. Export retries reread stopped
output with the same body binding; completed promises retain no archive buffer.

On the isolated qualification host, after verifying the extracted release,
set `QUAL_RELEASE_DIR` to that release and `QUALIFICATION_ONLY=isolated`, then run
`make -f Makefile -f apps/sandbox-node/checks.mk qualify-sandbox-node-disk ENV=test-sandbox-host`.
The SEA runs standalone, without starting the agent or loading its service configuration:
`QUALIFICATION_ONLY=isolated <release>/execution-node --qualify-disk` (root required).
The SEA executes real non-root writes exceeding block and inode hard limits and
requires `EDQUOT` in both cases; it unmounts/removes only its private test volumes.
Linux errno -122 is accepted even when Node reports its code as `UNKNOWN`.
It requires root for mount/quota setup. It is not a substitute for the full
runsc/EROFS lifecycle qualification and does not deploy the agent.

Run the real two-tenant isolation qualification as root on the isolated host:
`QUALIFICATION_ONLY=isolated <release>/execution-node --qualify-isolation`, or
`QUALIFICATION_ONLY=isolated QUAL_RELEASE_DIR=<release> sh <release>/qualify-isolation.sh`.
It also requires `/etc/execution-node/isolated-qualification`, installed tenant
loop mounts/slices, pinned runsc in PATH, and quota and mount tools.
The archive ships `qualification.erofs`, covered by SHA256SUMS; no `mkfs.erofs`
or erofs-utils installation is needed on the VM.
The service must be stopped (systemd ActiveState=inactive) and the sandbox,
scope and runsc inventories must be empty before creation. The agent and this
command hold the same exclusive `/run/lock/execution-node.lock` throughout
execution; concurrent service startup fails closed. The marker is consumed
once under that lock after inventory validation; recreate it for each run.
No agent listener, signing keys or host Node installation is needed.
It creates one 704 MiB session sandbox per tenant through the production adapter,
using the release EROFS rootfs and disposable tenant-private source/dependency bases.
In each sandbox it checks zero read/write access to the other tenant's sandbox,
bases, loop backing image and mount, hidden host state/key/runtime paths, read-only
own bases, loopback-only interfaces and blocked IPv4/IPv6/metadata/host connections.
Host checks assert tenant cgroup ancestry and AMD-27 scope properties. Each check
prints PASS or FAIL; any failure exits nonzero. A timeout fails the network check.
Cleanup targets only its generated UUID scopes, bundles, mounts and test bases;
failed cleanup is reported and leaves evidence for operator reconciliation.
The qualification neither restarts the agent nor changes existing tenant data.
This command must pass on the real isolated host before S1-K1 is accepted.

The archive's `./` entry and extracted release directory are mode 0755 so the
unprivileged disk-quota child can execute the SEA. k8s also applies `chmod 0755`
to the release directory at install. Release contents are public; no private
key ships in the archive. Installed TLS private keys and the agent environment
file containing private configuration remain root-only mode 0600; the generated
node-provenance PKCS#8 private key remains root-only mode 0400. Public archive
directory permissions do not change these separately installed file modes.

## Exact execution-node.service

Root is required for StartTransientUnit, loop/EROFS/overlay, quotas and scope
cgroup.kill. `systemd-run --scope --slice=builder-tenant-<t>.slice` invokes
PID 1 StartTransientUnit; no delegation or polkit. Capability/syscall lists
must pass S1-K1 on the pinned host. No file namespacing directive is permitted:
mounts must remain host-visible across crashes/restarts. ProtectControlGroups
would block cgroup.kill; PrivateDevices would hide loop devices.

```systemd
[Unit]
Description=Sentropic sandbox agent on standalone d2-4 VM
After=network-online.target zram-modules-ensure.service
Wants=network-online.target
Requires=zram-modules-ensure.service
RequiresMountsFor=/var/lib/builder/tenants/sentropic /var/lib/builder/tenants/immo
Conflicts=execution-node-stub.service

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=/etc/execution-node/agent.env
# RELEASE_DIR must be an immutable digest-named release verified by k8s.
ExecStart=/usr/local/libexec/sandbox-node-start
ExecStartPre=/bin/sh -ec 'grep -q "^/dev/zram0 " /proc/swaps'
Restart=on-failure
RestartSec=3
StateDirectory=builder
RuntimeDirectory=execution-node
RuntimeDirectoryPreserve=yes
UMask=0077
CapabilityBoundingSet=CAP_SYS_ADMIN CAP_SYS_CHROOT CAP_SETUID CAP_SETGID CAP_DAC_OVERRIDE CAP_CHOWN CAP_FOWNER CAP_FSETID CAP_MKNOD CAP_SETPCAP CAP_KILL CAP_SYS_RESOURCE CAP_SYS_PTRACE CAP_NET_ADMIN
SystemCallFilter=@system-service @mount @chown @setuid @resources chroot capset mknod mknodat pivot_root setns unshare ptrace process_vm_readv process_vm_writev quotactl
# Tenant scopes are siblings managed through systemd, never inside this unit.
MemoryMax=192M
MemoryMin=64M
MemorySwapMax=0
CPUWeight=100
TasksMax=128
OOMPolicy=kill

[Install]
WantedBy=multi-user.target
```

S1-K1 B-test **agent restart with live mounts**: on an isolated host only,
create `/etc/execution-node/isolated-qualification`, set
`QUALIFICATION_ONLY=isolated` and `QUAL_RELEASE_DIR`, then run
`make -f Makefile -f apps/sandbox-node/checks.mk qualify-sandbox-node-restart-mounts ENV=test-sandbox-host`.
It mounts EROFS and loop-backed ext4/overlay in the running agent namespace,
restarts the agent, verifies host/new-agent visibility and a written witness,
then unmounts through the new agent namespace. Never run on prod/preprod.

k8s owns cutover: install this unit replacing the stub (Conflicts= handles
port ownership), restart it, and switch the probe to GET /v1/node. Drain
before planned replacement. Rollback: stop/disable execution-node.service,
re-enable/start execution-node-stub.service, restore the previous verified
agent/rootfs digest when ready. No install/restart is performed by this lane.

## Verification key custody and operator tickets

| Key | Holder / VM path | Rotation |
| --- | --- | --- |
| Execution ticket/token Ed25519 | Sentropic control plane private key; VM public SPKI only at `/etc/execution-node/keys/execution-ticket.ed25519.pub.pem` (`AGENT_TICKET_PUBLIC_KEY`) | Control plane supplies the public key before installation; replace config and restart on rotation |
| Operator ticket Ed25519 | k8s private key; shipped SPKI `/etc/execution-node/keys/operator-ticket.ed25519.pub.pem` | 365 days; `AGENT_OPERATOR_PUBLIC_KEYS` accepts one or two comma-separated public-key paths for overlap; restart config, then retire old key after 60 s |
| Node provenance Ed25519 | k8s generates at install; PKCS#8 PEM `/etc/execution-node/keys/node-provenance.ed25519`, root 0400 | Rotate annually and on every rebuild, with public revocation and rebuild on compromise; k8s coordinates control-plane pin registration; never copied to an `.env` or release |

The N1 shipped operator key is:

```pem
-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEArfMfag+AHpptmfGgO1z/DZGXaj3XwaufBbomkwqdtho=
-----END PUBLIC KEY-----
```

GET /v1/node returns `provenancePublicKey` (SPKI PEM). k8s sends that public
key after install; the control plane pins it per nodeInstanceId before trusting
`X-Artifact-Provenance` (compact EdDSA JWS over archiveSha256, tenantId,
nodeInstanceId, nodeEpoch, exportedAt). Verify archive digest and pinned key.
The shared rootfs is built by sentropic, shipped beside the agent, registered
as `shared-rootfs` and advertised by GET node. Tenant source/dependency bases
arrive only through PUT bases. PUT refuses rootfs replacement.

`X-Operator-Ticket` is a compact JWS `base64url(header).base64url(claims).base64url(signature)`
(unpadded, signing bytes are the ASCII first two segments joined by `.`).
Protected header: `{"alg":"EdDSA"}`; signature algorithm Ed25519.
Signed claims: `{op,nodeInstanceId,nodeEpoch,iat,exp,jti,aud}`. Operations:
`drain|undrain|status`; audience exactly `execution-node`; `iat`/`exp` are
integer Unix seconds, `0 < exp-iat <= 60`, no future iat, exp strictly after now.
Node identity/epoch must match GET node. A bounded jti cache rejects reuse
until exp; restart advances the durable epoch, invalidating all old tickets.
Operator mTLS is required in addition to the ticket. The header is required
on `POST /v1/node/{drain,undrain,status}`; GET node requires no ticket.
Drain refuses new reservations/start/claim; existing stop/export/delete stay
available. This S1 endpoint drains the whole node; use a fresh JWS for undrain.

Worked example on the **k8s operator workstation**, with its existing private
key file (never copy it to the VM). Read NODE_INSTANCE_ID/NODE_EPOCH from
authenticated GET node, export those and OPERATOR_KEY_FILE/AGENT_URL, then:

```sh
# If creating a rotation key: openssl genpkey -algorithm ED25519 -out operator-next.pem
TICKET=$(node --input-type=commonjs <<'NODE'
const { readFileSync } = require('node:fs');
const { sign, randomUUID } = require('node:crypto');
const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const claims = { op: 'drain', nodeInstanceId: process.env.NODE_INSTANCE_ID,
  nodeEpoch: Number(process.env.NODE_EPOCH), iat: now, exp: now + 60,
  jti: randomUUID(), aud: 'execution-node' };
const input = enc({ alg: 'EdDSA' }) + '.' + enc(claims);
const signature = sign(null, Buffer.from(input), readFileSync(process.env.OPERATOR_KEY_FILE));
process.stdout.write(input + '.' + signature.toString('base64url'));
NODE
)
curl --fail-with-body --tlsv1.3 --cacert ca.crt --cert operator.crt --key operator.key \
  -X POST -H "X-Operator-Ticket: $TICKET" "$AGENT_URL/v1/node/drain"
unset TICKET
```
