# Feature: Rerun L5 on the exact Engram 0.22.0 candidate

## Objective
- [x] Retain the exact 965c93e3 candidate manifest, full L5 attempt, per-case bundle and strict checkpoint verdict without inventing acceptance.
## Scope / Guardrails
- [x] Worktree tmp/worktrees/memory-l5-r5-checkpoint; branch feat/memory-l5-r5-checkpoint; follows #843; preserve producer/P3/catalog/L0 bytes.
- [x] Make-only, shared Docker flock, pinned Node image, ports 9625/5825/1725, ENV=test-memory-l5 last; cleanup after.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `tools/memory-mcp-l5/**`
  - `spec/evidence/memory-mcp-l5/**`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] L5R5-EX1: forward execution-bound JSON from existing test targets only; no P3 producing recipe, frozen catalog or installed-E4 requirement changes. Rollback the report delegation.
## Feedback Loop
- [x] No signed owner UAT, L0 authorization or role acceptance is fabricated. Exact minimal actions are listed in r5-result.md.
- [x] Separate ordinary-install attribution from remaining inventory, installed proof and provenance gates.
- [ ] Final-head CI and independent complementary reviews remain required; no merge.
## AI Flaky tests
- [x] No waiver or timeout change.
## Orchestration Mode (AI-selected)
- [x] Sequential dependent PR; exact-byte qualification with retained rejected proposals when gates fail.
## UAT Management (in orchestration context)
- [ ] Record authenticated owner pass or authorized L6/L8 deferral only when actually supplied.
## Plan / Todo (lot-based)
- [ ] Lot 0: verify candidate SHA-256/SHA-512, producer P3/source/peer binding and registry mesh archive; assemble immutable inputs and manifest.
  - [x] Add exact-byte input collector; the registry mesh source commit comes from the archive-bound SLSA payload, with signature authentication explicitly unestablished.
  - [x] Independently measured candidate SHA-256/SHA-512 and P3/source/peer bindings match; mesh 0.22.4 archive integrity and SLSA subject match. Retain exact archive bytes and observed source 440599d04e91bb33e3874588f067c6a90bffd1b3 without claiming authenticated acceptance.
- [ ] Lot 1: run memory-l5-qualify; retain every command/exit, raw assertions, native positive controls, manifest and strict checkpoint proposal/result.
  - [x] Add process-time report binding with immutable raw JSON retention; source-only reports retain that mode and cannot become installed E4 evidence.
  - [x] Wire tooling, Lot 3 and packed report producers into the full attempt; retain explicit missing-file/process failures and do not stamp old reports at collection time.
  - [x] An actual GCC compilation produced an ELF object under the candidate addon path and was blocked by the predicate. The disposable positive-control container adds compiler tools; ordinary candidate installation keeps the original unmodified pinned image. The control also verifies that no Python executable is present.
  - [x] Compile attribution now requires an observed candidate compiler or concrete candidate source-build object outputs; node-gyp/make dispatch alone and downloaded prebuilt .node files are not compilation proof. Keep the full native check and actual-compiler regression.
  - [x] Execute and retain P09 regressions before the E2 acceptance check; preserve LOT=3's E2 refusal and all later installed gates. Retain actual assertion names and source-byte-bound complete suites for frozen family IDs; never map E4 canonical cases by suite alone.
  - [x] Retain the first tooling failure: the zeroed-generation negative case exceeded its five-second timer under concurrent workers. Isolate qualification workers with maxWorkers=1, as the Lot 3 runner already does; no timer or assertion is changed.
  - [x] Tooling after worker isolation: 144 passed, zero failed/skipped/todo; the complete fingerprint-negative suite passes with its original timer. Actual full qualification remains the next step.
  - [x] First complete post-reboot attempt retained by hash: P09 18 suites/90 assertions, P10 24 assertions, native/disabled controls pass; strict verdict NOT QUALIFIED. Preserve the full archive before the final correction.
  - [x] Reproduced a failed /missing/gcc spawn incorrectly counted as execution. Record native subprocess evidence only after a successful spawn (including real compiler exits with failure); keep source-object detection and real sync/async compiler controls.
  - [x] Full qualification routes LOT=2/3 to the separate canonical lot2-manifest.json, preserving the L4 candidate manifest for candidate proofs; absent or unverified E2 inputs still refuse.
- [ ] Lot 2: document the actual verdict and exact remaining owner actions, scope/review/CI checks, PR and cleanup; do not issue a false L5 acceptance.
  - [x] Final source 99f95df13: tooling 146, P09 90, P10 24, actual compiler controls 2 passed. Strict checkpoint rejected with 1417 failures; retain final raw archive and exact remaining gates. CI/reviews and installed acceptance remain open.
