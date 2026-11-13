# Feature: Bounded isolated data-plane qualification

## Objective
- [x] Repair the qualification workload, cancellation, private fixtures and custody verification roles.

## Scope / Guardrails
- [x] Worktree: `tmp/worktrees/sandbox-node-dpq`; branch: `fix/sandbox-node-data-plane-qual`; base: `origin/main`.
- [x] Make-only, Docker-first; `ENV=test-sandbox-dpq` last; no VM access and no merge.
- [x] Ports: API 9460, UI 5660, Maildev 1560; check availability before tests.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/sandbox-node/**`
  - `api/src/services/artifacts/live/**`
  - `api/tests/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions declared.

## Feedback Loop
- [x] Round 2: reproduce CI EPERM under UID/GID 1001:1001; stub only test chown, assert 1000:1000 ownership and real modes under umask 077; all 185 tests pass unprivileged. Production chown and archive bytes are unchanged.
- [x] Astra review: guard delayed launcher exit after scope-map teardown; add regression before archive rebuild.
- [x] Astra review: reject empty/premature HTTP responses before first bytes; bound runsc version detection with SIGKILL.
- [x] Enforce the wall-clock deadline in a separate supervisor event loop: SIGTERM the worker alone to preserve flock during cleanup, then process-group SIGKILL after 10 seconds for a blocked worker.
- [x] Astra closure review APPROVE after signal-routing regression; report `.tmp/rv/dpq-review-astra-closure.md`.
- [x] Independent security review APPROVE; Argon APPROVE with umask finding accepted: force output-parent traversal under UMask=0077.
- [x] Strict 250ms revoke test failed while the artifact build ran concurrently; isolated rerun passed all 185 tests without changing the threshold. The umask regression then failed before chmod and passed after it.
- [x] Packet references merged #1022; fetched `origin/main` is `87485f912` (#1020). Use the actual origin/main ancestry.
- [x] Track import is reserved for the conductor, the designated single writer; deliver the updated branch checklist for import.

## AI Flaky tests
- [x] No AI tests apply.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent code reviews after local validation.

## UAT Management (in orchestration context)
- [x] Real runsc qualification remains operator-owned; no VM access in this lane.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read mandatory rules, packet, template and qualification implementation; mechanical branch check passed.
- [x] **Lot 1 — Workload and runtime readiness**
  - [x] Reproduce missing source parent permissions in `tests/bundle.test.ts`; failed before fix (0700), corrected to 0755.
  - [x] Test actual generated qualification spec and execute its HTTP/WS server command in the mTLS harness.
  - [x] Detect early workload/scope exit and refuse unavailable port targets; preserve legitimate short build completion.
- [x] **Lot 2 — Bounded execution and cleanup**
  - [x] Validate deadline, SIGTERM, early sandbox exit, probe failure and successful finalization using the real qualification entry with fake host/runtime dependencies.
  - [x] Remove relay directories and refuse stale qualification resources, including the reported legacy `caf46fda` base; bases and bundles use private roots.
  - [x] Apply private fixture handling and leftovers inventory to isolation qualification; all 13 isolation orchestration tests pass.
- [x] **Lot 3 — Custody keys**
  - [x] Validate separate `CUSTODY_PUBLIC_KEY` / `ARTIFACT_CUSTODY_ED25519_KEY_B64`; API tests prove cross-use refusal both ways.
  - [x] Update node/API custody tests and operator installation instructions; dossier §A.3 separates the three ticket/token keys.
- [ ] **Lot 4 — Final validation**
  - [x] Local node checks: 185 tests, both TypeScript projects and memory check; API: 71 tests. Node/API source lint: zero errors.
  - [x] Rebuild and verify through `docker-slot.sh`: archive SHA-256 `4dbea87df4692edcc1522823fbf1af2cd7103e5221d198806c80f5e327fb6f74`; all internal sums and root/non-root SEA checks pass.
  - [x] Obtain independent code reviews and resolve findings; Astra closure and independent security review APPROVE, Argon umask finding accepted.
  - [ ] Push, open PR using this file and verify green CI on exact head; do not merge.
  - [x] Run `make down-volumes ENV=test-sandbox-dpq`; no branch stack remains.
  - [ ] Write French report and completion marker under `.tmp/rv/`.
