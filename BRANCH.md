# Feature: feat(mcp-platform): admitBridgeTools (0.4.1)

## Objective
- [x] Propose additive memory bridge admission and explicit context support in platform 0.4.1.
## Scope / Guardrails
- [x] Separate draft against main; pack only; no publish or merge.
- [x] changes the L5 frozen inventory if adopted; decision pending.
- [x] Preserve frozen catalog, L0 freeze, P3 manifest and Engram archives.
- [x] ENV=test-mem-l5-lot3 last; no application services; ports 9625/5825/1725.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/mcp-platform/src/memory/schema-profile.ts`
  - `packages/mcp-platform/src/memory/wire-profile.ts`
  - `packages/mcp-platform/src/transport/bridge.ts`
  - `packages/mcp-platform/src/transport/dispatch.ts`
  - `packages/mcp-platform/src/transport/result-codec.ts`
  - `packages/mcp-platform/src/tool-configuration.ts`
  - `packages/mcp-platform/tests/memory/schema-profile.test.ts`
  - `packages/mcp-platform/tests/memory/wire-profile.test.ts`
  - `packages/mcp-platform/package.json`
  - `package-lock.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exception required; platform change explicitly requested by owner.
## Feedback Loop
- [ ] Conductor: adoption changes the frozen inventory and requires a new freeze plus Engram repack; decision pending.
## AI Flaky tests
- [x] Deterministic contracts; no waiver.
## Orchestration Mode (AI-selected)
- [x] Single author, two isolated branches; no peer launch.
## UAT Management (in orchestration context)
- [x] No application UI change; SDK tests and package inspection only.
## Plan / Todo (lot-based)
- [x] Lot 0: isolate platform proposal from PR #777 and verify branch mechanically.
- [x] Registry pre-bump observation: published platform is 0.4.0; propose 0.4.1 for pack-only validation.
- [x] Lot 1: transfer schema admission and wire/context bridge with both profile suites.
- [x] Transfer bounded wire implementation and schema-profile test coverage from c83189032.
- [x] Transfer additive bridge admission, verified dispatch and complete-envelope codec.
- [x] Align the version constant and workspace lock with 0.4.1 after strict-version regression tests identified the mismatch.
- [ ] Lot 2: run platform tests and pack-mcp-platform; inspect additive package exports.
- [ ] Lot 3: create draft PR against main; retain conductor decision pending; no merge.
