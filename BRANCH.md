# Feature: feat(memory-l5): Lot 3 transport and context integration

## Objective
- [x] Prove independent Lot 3 regressions on published platform 0.4.0; preserve P3 and block dependent memory transport cases.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/mem-l5-lot3; branch feat/memory-l5-lot3; replayed onto rebased #771 then git rebase origin/main on 2026-10-29; no merge before predecessor acceptance.
- [x] Approved schedule supersedes R2/R7a/R3 dependency; retain 18 P09 suites and current remote-binding refusal.
- [x] P3 1c96bada2a749155f29aae763fa73ea6379c385d619f70614110f59b6b10b730 immutable; frozen catalog/contracts/fixtures untouched.
- [x] Shared Docker lock; official disposable containers; ENV=test-memory-l5 last; ports 9625/5825/1725; no application services.
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
  - [x] L5L3-EX2: platform source and mesh integration withdrawn; restore mesh 0.22.4 and its lock entry; retain platform 0.4.0 and frozen snapshots.
  - [x] L5L3-EX3: add one Lot 3 action to the existing disposable cold workspace; reuse its installation, no additional runtime; rollback that action only.
  - [x] L5L3-EX4: prepare the existing MCP packaging fixtures in isolation with the frozen platform 0.4.0 floor; three required P09 cases otherwise skip. Rollback the preparation mode only.
## Feedback Loop
- [x] Owner direction: withdraw all platform source changes; propose 0.4.1 separately, draft and pack only; no freeze or Engram repack.
- [x] Schema admission removed here; P03.platform.schema-profile-2020-12 remains blocked: platform-admitBridgeTools.
- [x] Wire and bridge source removed here; P04.platform.wire-profile-v1 remains blocked: platform-admitBridgeTools.
- [x] All platform source changes and dependent mesh composition withdrawn; original c83189032 and conductor handoff preserve the proposal.
- [x] Both new platform profile suites transferred to the separate draft; blocked cases remain in the catalog and receipts.
- [x] Mesh context suite withdrawn to the local conductor handoff; P01.mesh.memory-context remains blocked: platform-admitBridgeTools.
- [x] Published 0.4.0 archive is hash-checked and supplies platform runtime JS for source imports and packaged P09 consumers; six dependent cases are explicitly blocked.
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
- [x] Lot 1: withdraw all platform source changes and both new profile suites into a separate 0.4.1 draft proposal.
- [x] Lot 2: withdraw dependent mesh composition and context suite; preserve c83189032 and local conductor handoff.
- [x] Lot 3: classify every catalog file/case as run-here, blocked or out-of-lot; retain all 18 P09 suites.
  - [x] Negative tests require all six platform-dependent cases to remain explicitly blocked and absent from execution selection.
  - [x] Tooling gate: 119 tests passed, including publication and receipt negative cases.
  - [x] Include all 11 independent broker catalog source suites against the same published platform; E4 and manifest obligations remain pending.
  - [x] Replace superseded transport claims with the precise independent/blocked split in the report and Opus r2 dossier.
  - [x] Fresh source head baf55ae8e: 122 platform, 23 mesh and 27 broker tests passed against published platform 0.4.0; all 18 P09 files retained.
- [ ] Lot 4: push #777 and separate draft against main; final-head CI; no merge or publication.
  - [ ] Independent review remains open; catalog discovery is pending the installed mesh launcher failure.
  - [x] pr777_opus_r3: r2 P1-A is resolved and no blocking source request remains; final-head CI remains mandatory. Add a Vitest resolver canary for the r3 published-JS observation.
  - [x] Post-rebase version gate: no public package source differs from main; preserve cluster-mesh 0.24.0 and its current lock entry instead of restoring historical 0.22.4 metadata.
  - [x] Post-rebase working-tree source run: 123 platform (including the poisoned-TS resolver canary), 23 mesh and 27 broker tests passed; all 18 P09 files executed with no skipped/todo cases. Final-head CI remains required.
