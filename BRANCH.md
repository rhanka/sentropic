# Feature: #861 L8b ensure and recovery qualification

## Objective
- [ ] Qualify ensure waits, quota atomicity, restart, crash, uncertain COMMIT and legacy quarantine.

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

## AI Flaky tests
- [x] None accepted.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: qualification shard only; integration owner handles product changes and releases.

## UAT Management (in orchestration context)
- [x] No UI changes; PostgreSQL integration tests provide this shard's evidence.

## Plan / Todo (lot-based)
- [x] Lot 0 — read lock, spec r2 S4/L8b, section 6.3, Q1-Q4 and Radar pins; check branch mechanically.
- [x] Lot 1 — create real-PG participant and host fixture in commit-ensure-recovery.integration.test.ts.
- [ ] Lot 2 — exercise connection/key/binding/replay waits and denied retry without residue.
- [ ] Lot 3 — race the last quota unit; recreate pool/service and replay without recharging.
- [ ] Lot 4 — terminate an in-flight backend; inject lost COMMIT acknowledgment before/after durability.
- [ ] Lot 5 — quarantine legacy receipts and historical keys through actual transport wiring.
- [ ] Lot gate — run scoped make test-artifacts-integration; record known failures with source locations.
- [ ] Handoff — merge refreshed integration, scope-check each atomic commit, push and open draft PR.
