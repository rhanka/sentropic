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
  - [x] BRDPF-EX1: align anticipated AMD-28 network contract in spec; documentation only; rollback the spec line with the network implementation.

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
- [ ] Round 2c: both network modes, two tenants, network witnesses and crash reconciliation qualification.
- [ ] Round 2d: tests, archive rebuild/verification, exact-head green CI and receipt.
- [x] Lot 0: read rules, previous packets, generated fixture and forwarding implementation; verify branch mechanically.
- [x] Lot 1: staged safe diagnostics for TLS/CN, custody, UDS, helper, fixture, HTTP/WS and failure inventories; real in-sandbox accept readiness before probes.
- [x] Lot 2a: reproduce the unsupported NetworkNone selection; select NetworkSandbox only inside a fresh loopback-only namespace for ports workloads; propagate and test the declared network policy.
- [x] Lot 2b: reproduce `socket hang up` with a NetworkNone helper and prove HTTP/WS with an actual cross-process socket donation surviving helper exit; add bounded internal readiness.
- [x] Lot 3: full check 207 tests, TypeScript and memory pass; independent Astra high review APPROVE at 8d8941f89, with two optional test precision improvements applied afterward.
- [x] Lot 4: archive 97bb367427f0c9389547c86bbf199b2775680047669deee5cc399b9721002407 built and verified via docker-slot, 42 GiB free before build; 11 internal sums and SEA root/non-root pass.
- [x] Test-stack cleanup: `make down-volumes` completed for test-sandbox-dpf.
- [ ] Lot 5: PR using this file, CI green on exact head, cleanup test volumes, French report and done marker; do not merge.
