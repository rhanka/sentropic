# Feature: #861 L8b ensure and recovery qualification

## Objective
- [x] Qualify ensure waits, quota atomicity, restart, crash, uncertain COMMIT and legacy quarantine.

## Scope / Guardrails
- [x] Worktree: tmp/worktrees/861-L8b; branch: feat/artifacts-861-L8b.
- [x] ENV=test-861-l8b last; shared Docker flock; make down after every test step.
- [x] Ports: API 18922, UI 15922, Maildev 11922; qualification services publish no ports.
- [x] Tests only; product defects remain known failures and return to the owning lot.
- [x] Merge only; no rebase, Python, publication or attribution trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/tests/commit-ensure-recovery.integration.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/artifacts/src/**`
  - `packages/cluster-mesh/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No source exceptions; inherited topic changes enter only through requested merges.

## Feedback Loop
- [x] Integration be22b0563 contains L6 e67a978f9; merge conflicts only in BRANCH.md, retaining this lane plan.
- [x] Radar A1 f2b6c25cc9458ec285d6d4f620a55dad8c30f909; A2 b104ae90a28a5581e8eabd15f12acb58558d3396.
- [x] Radar PR908 e2e9515ea41baebf5539743f0cfa0dea750d072c; main 2dbde92e9a6c532abe4f9e7bed8ed9a9b381d530.
- [x] BASE #910 retires the route still called by immo-mcp data-source.ts:316; CT-3/CT-9 requalification required.
- [x] Radar H3 quota/admission interface absent: consumer integration not covered; real-PG upstream participant required.
- [x] Q1 draft SHA256: 49babf7b8a592da4159d0a1904f7716724bff2345886f14835789d3af46ce4e2; no valid pinned checkout metadata.
- [x] Q1/Q2/Q3/Q4 and all eight Radar acceptance suites remain consumer gates; no packed/published receipt claimed here.
- [x] L8b receipt: 2026-10-25 10:07 UTC, 19/19 tests passed, zero skips; no product defects found.
- [x] Test source SHA256: 5c13d2379149c3d1b5689c06829202a532cbb9df4813bbf2d544d69d143e7c24.
- [x] Command: `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make -f /tmp/861-l8b.make test-artifacts-integration SCOPE=tests/commit-ensure-recovery.integration.test.ts API_PORT=18922 UI_PORT=15922 MAILDEV_UI_PORT=11922 ENV=test-861-l8b`.
- [x] Temporary runner SHA256: e63fe43b8564e0e55c708f824adf5d51266af5c4dbca06e4dcc1c0903dff8b01; copied Makefile with only ENV condition/build guard expanded to this lane; no tracked runner edits.
- [x] Runner reproduction: `sed 's/ifeq ($(ENV),test-861-int)/ifneq ($(filter test-861-int test-861-l8b,$(ENV)),)/;s/@test "$(ENV)" = test-861-int/@test "$(ENV)" = test-861-l8b/' Makefile > /tmp/861-l8b.make`.
- [x] Node image: node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6; PostgreSQL 17 and MinIO use docker-compose.immo-861.yml (SHA256 b4e609883e1f77eaf64672f34661df4058054177a652c376c8dbffde04412e95).
- [x] Source qualification only: no archive/lock installation; provider restart persists across processes, not a PostgreSQL storage restart. Packed/published tuple and actual Radar H3 remain not covered by this shard.
- [x] Initial fixture run failed on an omitted storage-scope seed; corrected locally. The next attempt stopped at the runner ENV guard; the recorded final run passes.
- [x] Shared-lock cleanup after the passing test removed only test-861-l8b containers/network; no owner environment touched.
- [ ] Lint and final remote-head verification pending; draft PR https://github.com/rhanka/sentropic/pull/742.

## AI Flaky tests
- [x] None accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: qualification shard only; integration owner handles product changes and releases.

## UAT Management (in orchestration context)
- [x] No UI changes; PostgreSQL integration tests provide this shard's evidence.

## Plan / Todo (lot-based)
- [x] Lot 0 — read lock, spec r2 S4/L8b, section 6.3, Q1-Q4 and Radar pins; check branch mechanically.
- [x] Lot 1 — create real-PG participant and host fixture in commit-ensure-recovery.integration.test.ts.
- [x] Lot 2 — exercise connection/key/binding/replay waits and denied retry without residue.
- [x] Lot 3 — race the last quota unit; recreate pool/service and replay without recharging.
- [x] Lot 4 — SIGKILL provider before COMMIT; inject lost COMMIT acknowledgment before/after durability.
- [x] Lot 5 — quarantine legacy receipts and historical keys through actual transport wiring.
- [x] Lot gate — scoped integration suite: 19 passed; build passed; no known product failures.
- [ ] Handoff — merge refreshed integration, scope-check each atomic commit, push and open draft PR.
