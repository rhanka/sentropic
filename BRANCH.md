# Fix: sandbox-node data-plane forwarding qualification

## Objective
- [ ] Diagnose and fix the first real-host data-plane connection failure, preserving deadlines and cleanup.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/sandbox-node-dpf`, branch `fix/sandbox-node-data-plane-forward`, base `origin/main`.
- [x] Make-only, Docker-first; `ENV=test-sandbox-dpf` last; ports 9465 / 5665 / 1565 checked free.
- [x] No VM access, deployment or merge; no production state writes or secrets in diagnostics.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `BRANCH.md`
  - `spec/SPEC_EVOL_SANDBOX_NODE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] BRDPF-EX1: align co-signed AMD-28 network contract (k8s 3b042fd) in spec; documentation only; rollback the spec line with the network implementation.

## Feedback Loop
- [x] Request source: `.tmp/packets/s1-dataplane-qual-fix2.md`; Track import reserved for the conductor's single writer, as in PR #1023.

## AI Flaky tests
- [x] No AI tests or accepted nondeterministic failures.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no integration of other branches.

## UAT Management (in orchestration context)
- [x] Real VM qualification belongs to k8s; this lane uses a hermetic helper reproducing gVisor stream semantics.

## Plan / Todo (lot-based)
- [x] Round 2a: explicit network refusal and disabled-by-default ports kill switch (409), including adapter enforcement.
- [x] Round 2b: verify private namespace, hardening prerequisites and receipt digests; extra interface and IPv4/IPv6 route refusals tested.
- [x] Round 2c: both network modes, two tenants, network witnesses and crash reconciliation qualification.
- [x] Round 2c probes: host/public/metadata/IPv6/tenant TCP refusal, DNS refusal and positive host loopback listeners.
- [x] Round 2c matrix: both modes and tenants simultaneous; scripts run under shipped unit hardening with bounded supervisors.
- [x] Round 2c inventory: scope processes and private netns references (including host FDs) checked after cleanup.
- [x] Round 2c data plane: live peer witness, ports network probes, HTTP/WS and revocation share a real-host run.
- [x] Round 2c regressions: hardened prerequisites receipt and actual child SIGKILL orchestration in Docker.
- [ ] Round 2d: tests, archive rebuild/verification, exact-head green CI and receipt.
- [ ] Co-signed AMD-28: qualified digest switch, profile fence, runtime audits, helper cap, UDP/raw/kernel witnesses and OOM qualification.
- [x] AMD-28 switch: live root-owned config, digest-gated discovery/admission, stream cut and sandbox destruction on closure.
- [x] AMD-28 audits: strict addresses/all-table loopback routes and sentry namespace/flags/spec auditors.
- [x] AMD-28 runtime: enforce audits at launch, destroy on violations, emit daemon audit event, forbid forwarding non-ports sandboxes.
- [x] AMD-28 helpers: global configurable 1..8 cap (default 2), bounded queue and typed 429 saturation; burst regression.
- [x] AMD-28 regressions: address and host-namespace refusal, kernel main IPv6 loopback compatibility, qualified binary fixtures.
- [x] AMD-28 native probes: raw/packet socket refusals, UDP refusal and positive private-kernel TCP/UDP witnesses shipped in the archive/rootfs.
- [x] AMD-28 qualification authorization: in-memory digest pin after hardened prerequisites; no production switch write.
- [x] AMD-28 gate coverage: kernel witnesses in ports namespaces, exact host TCP/UDP inventory, fixed-port refusal and kernel-confirmed OOM cleanup in both modes.
- [x] AMD-28 revocation regressions: shared 50ms monitor, local cut before asynchronous stop, retry and reservation release.
- [x] AMD-28 audit regressions: every forbidden flag, UDS/FIFO requirements, OCI annotations/capabilities/devices, sentry inode/host/peer/listener failures and profile/digest refusals.
- [x] AMD-28 switch gate: real HTTP/WS cuts within 250ms, 409 admission and sandbox destruction for closed-switch and digest-mismatch scenarios.
- [x] AMD-28 burst gate: hold the configured connection cap, saturate with twelve mTLS requests, verify typed refusals, slot drainage and actual 192M/128-task cgroup limits; hash files with bounded scratch memory.
- [x] AMD-28 fixture alignment: ports exercise the live 704M profile, export lifecycle validates a stopped output archive, and supervision regressions cover both OOM variants.
- [x] AMD-28 finalization: early ports exit fails the audit; namespace/spec failures destroy physical and logical sandboxes and release capacity.
- [x] AMD-28 documentation: co-signed k8s 3b042fd contract, exact switch keys, closed defaults, dependencies, helper caps and qualification receipt rules.
- [x] Digest identity: resolve the actual runsc executable; test binary identities use an isolated PATH fixture without an alternate production digest target.
- [x] Switch integration regressions: actual HTTP/WS teardown and slot destruction, atomic config replacement and binary replacement without restart.
- [x] Archive smoke regression: isolation worker reports failure through its supervisor once, preserving the authorization-refusal smoke contract.
- [x] Native probe verification: unprivileged Docker controls prove raw/packet denial, TCP witnesses and UDP positive/negative behavior on IPv4/IPv6.
- [x] Saturation protocol: preserve 429 ports_saturated on WebSocket handshakes as well as HTTP; included in the burst gate.
- [x] Revocation diagnostics include measured cut latency without changing the 250ms contract.
- [x] Security review fixes: check ss exit status; retain cleanup identity/reservations after failure; close relays and stop cgroups before requiring a working runsc binary.
- [x] UDP evidence: external targets require local refusal before successful send; remote ICMP port-unreachable cannot qualify isolation.
- [x] Standalone scope-check uses the installed host harness C2 producer with the same staged/unstaged inventory, avoiding Docker for mechanical checks.
- [x] Lot 0: read rules, previous packets, generated fixture and forwarding implementation; verify branch mechanically.
- [x] Lot 1: staged safe diagnostics for TLS/CN, custody, UDS, helper, fixture, HTTP/WS and failure inventories; real in-sandbox accept readiness before probes.
- [x] Lot 2a: reproduce the unsupported NetworkNone selection; select NetworkSandbox only inside a fresh loopback-only namespace for ports workloads; propagate and test the declared network policy.
- [x] Lot 2b: reproduce `socket hang up` with a NetworkNone helper and prove HTTP/WS with an actual cross-process socket donation surviving helper exit; add bounded internal readiness.
- [x] Lot 3: full check 207 tests, TypeScript and memory pass; independent Astra high review APPROVE at 8d8941f89, with two optional test precision improvements applied afterward.
- [x] Lot 4: archive 97bb367427f0c9389547c86bbf199b2775680047669deee5cc399b9721002407 built and verified via docker-slot, 42 GiB free before build; 11 internal sums and SEA root/non-root pass.
- [x] Test-stack cleanup: `make down-volumes` completed for test-sandbox-dpf.
- [ ] Lot 5: PR using this file, CI green on exact head, cleanup test volumes, French report and done marker; do not merge.
