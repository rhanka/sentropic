# Feature: feat(memory-l5): Lot 3 transport and context integration

## Objective
- [ ] Integrate explicit memory profiles and verified context through existing transport/mesh; preserve P3.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/mem-l5-lot3; branch feat/memory-l5-lot3; base origin/feat/memory-l5-lot2; merge only; merge main after #771 merges.
- [x] Approved schedule supersedes R2/R7a/R3 dependency; retain 18 P09 suites and current remote-binding refusal.
- [x] P3 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 immutable; frozen catalog/contracts/fixtures untouched.
- [x] Shared Docker lock; official disposable containers; no Python; ENV=test-mem-l5-lot3 last; schedule ports 9625/5825/1725; no application services.
- [x] Tests first; selective staging; make commit only; under 150 lines per commit; draft PR to main; no merge.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/mcp-platform/src/transport/bridge.ts`
  - `packages/mcp-platform/src/transport/dispatch.ts`
  - `packages/mcp-platform/src/transport/result-codec.ts`
  - `packages/mcp-platform/src/memory/wire-profile.ts`
  - `packages/mcp-platform/src/memory/schema-profile.ts`
  - `packages/mcp-platform/tests/memory/schema-profile.test.ts`
  - `packages/mcp-platform/tests/memory/wire-profile.test.ts`
  - `packages/mcp-platform/tests/request-identity.test.ts`
  - `packages/mcp-platform/tests/registry-dispatch.test.ts`
  - `packages/mcp-platform/package.json`
  - `packages/cluster-mesh/src/compose/mcp.ts`
  - `packages/cluster-mesh/tests/memory-context.spec.ts`
  - `packages/cluster-mesh/tests/mcp-composition.spec.ts`
  - `packages/cluster-mesh/tests/storage/cold-workspace.sh`
  - `packages/cluster-mesh/tests/packaging/prepare.sh`
  - `packages/cluster-mesh/tests/packaging/mcp-tuple.spec.ts`
  - `packages/cluster-mesh/tests/verified-invocation-context.spec.ts`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `tools/memory-mcp-l5/lot3*.mjs`
  - `tools/memory-mcp-l5/tests/lot3*.test.mjs`
  - `spec/evidence/memory-mcp-l5/lot3/**`
  - `Makefile`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `tools/memory-mcp-l5/artifacts/**`
  - `tools/memory-mcp-l5/fixtures/**`
  - `tools/memory-mcp-l5/proof-catalog-v1.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5L3-EX1: bounded root Makefile/CI source/regression wiring; preserve frozen producing recipes; rollback Lot 3 delegation only.
  - [x] L5L3-EX2: package version/lock scalars above published releases; retain frozen snapshots; successor pre-candidate/E4 required before installed acceptance.
  - [x] L5L3-EX3: add one Lot 3 action to the existing disposable cold workspace; reuse its installation, no additional runtime; rollback that action only.
  - [x] L5L3-EX4: prepare the existing MCP packaging fixtures in isolation and update their platform floor to 0.4.1; three required P09 cases otherwise skip. Rollback the preparation mode and floor assertion together.
## Feedback Loop
- [ ] gr-conductor: verified P3-bound lot2-manifest/sidecar, E2/backend/neutral/profile/lock closure and G1–G4/C9 receipts required; stop dependent qualification.
- [ ] Lot 4: S1 normalization, compatible frozen successor/E4, installed six-suite qualification and owner UAT remain owning-lot gates.
## AI Flaky tests
- [x] Deterministic transport/security tests; no waiver or timeout increase.
## Orchestration Mode (AI-selected)
- [x] Mono-branch author implementation; independent review per harness review skill.
## UAT Management (in orchestration context)
- [x] No UI/API change; SDK transport tests; final installed E4/owner UAT remain later lots.
## Plan / Todo (lot-based)
- [x] Lot 0: read lock/rules/spec/schedule/template; mechanically verify isolated branch and P3.
- [ ] Lot 1: failing wire/schema tests; profile admission, full-envelope codec, protocol refusal.
  - [x] Schema test reproduced missing admission module; wire SDK tests specified; finite schema admission implemented.
  - [x] Added explicit transport call context types; memory text uses the complete JSON envelope without changing the default codec.
  - [x] SDK red run: outputSchema loss and absent-audit protocol refusal reproduced; explicit memory bridge implemented; platform 0.4.1 fixes the existing declared profile within current peer intervals.
- [ ] Lot 2: mesh context/guards/cancellation/compiled dispatch; concurrent subject/tenant/workspace tests.
  - [x] Preserve full context and cancellation; compile policy uses verified claims/source; mesh 0.22.5 requires corrected platform 0.4.1.
  - [x] HTTP namespace proof: real SDK client/compiled registry, frozen get schemas, tenant distinct from workspace, forged headers and full envelope; five mesh cases passed.
- [ ] Lot 3: profile/context tests and all 18 P09 suites; retain reports and publication/writer evidence.
  - [x] New runner/tests: tools/memory-mcp-l5/lot3-source.mjs and tests/lot3-source.test.mjs; exact P09 file set bound to the unchanged P3 catalog.
  - [x] First exact run: platform 132 passed; mesh 24 passed/3 skipped, rejected by the reporter. Existing packaging fixtures now prepare those three required cases.
- [ ] Lot 4: review, push draft PR to main, final-head CI green; list manifest-blocked proofs and Lot 4 estimate.
