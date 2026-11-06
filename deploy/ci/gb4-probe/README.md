# GB4 preprod isolation probe

Run from the wagon worktree. All commands require `ENV=test-gb4` last.

```sh
make -f deploy/ci/gb4-probe/probe.mk gb4-prepare ENV=test-gb4
/home/antoinefa/src/sentropic/.tmp/packets/docker-slot.sh make -f deploy/ci/gb4-probe/probe.mk gb4-check ENV=test-gb4
make -f deploy/ci/gb4-probe/probe.mk gb4-wait ENV=test-gb4
```

Preparation writes the pinned digest, full Pod/Service/temporary egress manifests,
and pending checks to the shared `.tmp/rv/gb4-probe.md`. The conductor supplies the
digest to k8s and creates `.tmp/rv/gb4-probe-go.flag` after the namespace baseline
and image allowlist have been applied. Waiting polls every 120 seconds for at most
10 hours. `gb4-run` also refuses to load credentials before GO exists.

Access uses `KUBE_CONFIG_DATA_PREPROD_BASCULE` from the shared root `.env` or the
environment, without displaying its value. The selected context must name
`sentropic-preprod`. The probe creates resources only in that namespace and
`sentropic-artifact-builders`. It needs ready artifact-content and API/auth-idp
pods with Node, and at least two services with ready endpoints. The temporary
egress policy enables the positive test before the train's permanent policy lands.

The runner verifies short WebSocket echoes from both the allowed and denied
source, through both Service DNS and Pod IP. DNS failures, refused connections,
protocol errors and missing live-service prerequisites fail the probe. A negative
connection alone cannot distinguish source egress denial from target ingress denial.
All temporary resources are deleted and checked absent, including on errors.
The namespace baseline, VAP, RBAC and application workloads remain operator-owned.

Kernel pseudo filesystems and device nodes are excluded from the writable-storage
test; every regular storage mount is checked. `/dev/shm` has its own emptyDir.
The offline check runs the actual embedded server in a read-only non-root container,
tests the split-frame echo, checks storage, and proves reachable egress cannot PASS.
The train integration lane owns the consolidated review, CI and Track import.
