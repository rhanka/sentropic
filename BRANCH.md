# Feature: feat(memory-l5): Lot 3 transport and context integration

## Objective
- [x] Integrate explicit memory profiles and verified context through existing transport/mesh; preserve P3.
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
  - [x] L5L3-EX2: mesh patch version only; platform package.json restored byte-for-byte to P3 0.4.0; retain its existing dependency floor and frozen snapshots.
  - [x] L5L3-EX3: add one Lot 3 action to the existing disposable cold workspace; reuse its installation, no additional runtime; rollback that action only.
  - [x] L5L3-EX4: prepare the existing MCP packaging fixtures in isolation with the frozen platform 0.4.0 floor; three required P09 cases otherwise skip. Rollback the preparation mode only.
## Feedback Loop
- [x] Owner direction: withdraw all platform source changes; propose 0.4.1 separately, draft and pack only; no freeze or Engram repack.
- [x] Schema admission removed here; P03.platform.schema-profile-2020-12 remains blocked: platform-admitBridgeTools.
- [x] Wire and bridge source removed here; P04.platform.wire-profile-v1 remains blocked: platform-admitBridgeTools.
- [x] All platform source changes and dependent mesh composition withdrawn; original c83189032 and conductor handoff preserve the proposal.
- [x] Both new platform profile suites transferred to the separate draft; blocked cases remain in the catalog and receipts.
- [ ] gr-conductor: P01.packed/P02.packed/P03/P04.packed need verified context/audit/schema/transport tuple; P05 canonical fenced-store; P06 restart/lost-ack; P07 assurance/continuation; P08 installed closure/disabled exports; P10 manifest/sidecar/G1-G4/C9 and tuple acceptances. Exact missing inputs: tools/memory-mcp-l5/lot3-dispositions.mjs WAITING_FOR.
- [ ] Lot 4: S1 normalization, same frozen tuple/E4 installed six-suite qualification and owner UAT remain owning-lot gates; no successor freeze authorized.
## AI Flaky tests
- [x] Deterministic transport/security tests; no waiver or timeout increase.
## Orchestration Mode (AI-selected)
- [x] Mono-branch author implementation; independent review per harness review skill.
## UAT Management (in orchestration context)
- [x] No UI/API change; SDK transport tests; final installed E4/owner UAT remain later lots.
## Plan / Todo (lot-based)
- [x] Lot 0: read lock/rules/spec/schedule/template; mechanically verify isolated branch and P3.
- [x] Lot 1: failing wire/schema tests; profile admission, full-envelope codec, protocol refusal.
  - [x] Schema test reproduced missing admission module; wire SDK tests specified; finite schema admission implemented.
  - [x] Added explicit transport call context types; memory text uses the complete JSON envelope without changing the default codec.
  - [x] SDK red run: outputSchema loss and absent-audit protocol refusal reproduced; explicit memory bridge implemented; platform version remains frozen at 0.4.0.
- [x] Lot 2: mesh context/guards/cancellation/compiled dispatch; concurrent subject/tenant/workspace tests.
  - [x] Preserve full context and cancellation; compile policy uses verified claims/source; mesh 0.22.5 retains the platform >=0.4.0 floor.
  - [x] HTTP SDK proof: strict client reproduced missing root object type; full rerun passes with the complete frozen oneOf preserved (136 platform/28 mesh).
- [x] Lot 3 source scope: profile/context tests and all 18 P09 suites; retain reports and real publication receipts; installed qualification remains manifest-blocked above.
  - [x] Review r1: produce npm view/download receipts, recompute SHA-512 and compare registry metadata plus a real npm-generated observation lock; retain both with source reports.
  - [x] Review r1: every catalog file/case has an explicit run-here/out-of-lot disposition, existence observation and gate/dependency; frozen P3 archive inventory is reverified before source tests.
  - [x] Review r1: HTTP cases cover a coherent wrong-subject binding, absent binding and foreign tenant; each must return -32603 before authorization or runner effects.
  - [x] New runner/tests: tools/memory-mcp-l5/lot3-source.mjs and tests/lot3-source.test.mjs; exact P09 file set bound to the unchanged P3 catalog.
  - [x] First exact run: platform 132 passed; mesh 24 passed/3 skipped, rejected by the reporter. Existing packaging fixtures now prepare those three required cases.
- [ ] Lot 4: review, push draft PR to main, final-head CI green; list manifest-blocked proofs and Lot 4 estimate.
  - [x] Draft PR #777 targets main; no merge. Source head 826418296: 136 platform/31 mesh passed; 119 tooling passed; actual npm receipts and source reports retained under spec/evidence/memory-mcp-l5/lot3/.
  - [ ] Final independent review/consensus remains open; supplied Opus r1 changes addressed in this author response; no new peer launch authorized in this packet.
