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
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare a reason, impact and rollback before any scope exception; none required.

## Feedback Loop
- [x] Request source: `.tmp/packets/s1-dataplane-qual-fix2.md`; Track import reserved for the conductor's single writer, as in PR #1023.

## AI Flaky tests
- [x] No AI tests or accepted nondeterministic failures.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no integration of other branches.

## UAT Management (in orchestration context)
- [x] Real VM qualification belongs to k8s; this lane uses a hermetic helper reproducing gVisor stream semantics.

## Plan / Todo (lot-based)
- [x] Lot 0: read rules, previous packets, generated fixture and forwarding implementation; verify branch mechanically.
- [x] Lot 1: staged safe diagnostics for TLS/CN, custody, UDS, helper, fixture, HTTP/WS and failure inventories; real in-sandbox accept readiness before probes.
- [x] Lot 2a: reproduce the unsupported NetworkNone selection; select NetworkSandbox only inside a fresh loopback-only namespace for ports workloads; propagate and test the declared network policy.
- [x] Lot 2b: reproduce `socket hang up` with a NetworkNone helper and prove HTTP/WS with an actual cross-process socket donation surviving helper exit; add bounded internal readiness.
- [ ] Lot 3: run `check-sandbox-node`, TypeScript and memory checks; review the final diff.
  - [x] Full check: 206 tests pass, two TypeScript projects and memory reclamation pass; add final external-interface regression and independent review.
- [ ] Lot 4: build and verify archive via docker-slot after confirming at least 30 GB free; record SHA256SUMS.
- [ ] Lot 5: PR using this file, CI green on exact head, cleanup test volumes, French report and done marker; do not merge.
