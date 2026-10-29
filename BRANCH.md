# Feature: Engram E11b installed Stage B and C6 closure

## Objective
- [ ] Qualify all 23 Stage B cases through the installed handle, ship C6 declaration in dev.7, and regenerate the 21-slot tuple; stop for an evidenced Engram-side blocker.

## Scope / Guardrails
- [x] Release integrator: merge `origin/main` a3204932e420efe6eeafa3428459fadb7f215aa7 into integration b90fc4ee6; preserve all main changes and union Makefile selectors. Imported changes are inherited from that main parent; no Track events changed.
- [x] Branch `feat/cluster-mesh-engram-e11b` from integration `fa900e335`; worktree `tmp/worktrees/mem-e11b`; mechanical branch PASS; merge only, never rebase.
- [x] Owner-directed pack-only dev.7; no publication, artifacts source edits or receiving ACK.
- [x] Read-only E2 inputs: published Engram 0.21.3 `32d47df1…`, mesh dev.6 `ff79088e…`, contract pair `55f8d457…` / `dd0cccbd…`; L4 MCP 0.22.0 is separate L5 scope (plan E11 line 120).
- [x] Node 24 through make and Docker flock; no Python; ENV=test-mem-e11b last; make down after each Docker step.
- [x] Isolated Compose PostgreSQL only, no host ports; API 9055, UI 5255, Maildev 1155 reserved; owner environments untouched.
- [x] Atomic make commits at most 150 changed lines; selective staging; no AI trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/**` (reviewed E0–E11b aggregate and final release qualification)
  - `PLAN.md` (inherited E2 plan entries)
  - `package.json` (inherited E2 workspace qualification tools)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (final main-PR gate routing)
  - `BRANCH.md`
  - `tools/engram-e11/**`
  - `Makefile` (BR11-EX1)
  - `packages/cluster-mesh/tests/engram-memory/**`
  - `packages/cluster-mesh/tests/storage/cold-workspace.sh`
  - `packages/cluster-mesh/src/engram-memory/**`
  - `packages/cluster-mesh/src/storage/postgres/effects.ts` (BR11B-EX3)
  - `packages/cluster-mesh/contracts/**`
  - `packages/cluster-mesh/.gitignore`
  - `packages/cluster-mesh/assets/storage/engram-memory/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
  - `.github/workflows/ci.yml` (BR11B-EX2)
- **Forbidden Paths (must not change in this branch)**:
  - `packages/engram/**`
  - `tools/memory-mcp-l5/artifacts/**`
  - `docker-compose*.yml`
  - `.track/**`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - [x] None beyond BR11-EX1.
- **Exception process**:
  - [x] BR11B-EX1: add test-mem-e11b selectors and an installed Stage B action to existing make routing; impact isolated qualification only; rollback selectors/action.
  - [x] BR11B-EX2: run E11 tooling tests/check in CI with deterministic inputs; impact tuple tooling coverage; rollback workflow step.
  - [x] BR11B-EX3: installed C5 exposes missing u64 chain-allocation exhaustion check in PG effects; add only the upper-bound guard, preserving generic safe-number dense positions and frozen SQL. Rollback guard.
  - [x] BR11-EX1: add only test-mem-e11 to host scope-check selector, avoiding an unrelated harness build; impact validation routing; rollback remove selector.
  - [x] BR11-EX2: owner-requested 0.21.3/dev.6 clean install proof uses existing qualification Compose, PostgreSQL and down selectors for test-mem-e11; rollback those three selector entries together. No package/source/lock edits.
  - [x] BR11-EX3: owner-requested CI diagnosis adds test-mem-e11 to E2 qualification, lint/wiring and packed-platform build selectors, and preserves packed-consumer npm stderr. Impact: run the same gates in the owned Compose environment and expose install failures; rollback these selector/logging changes. No assertion, dependency, lock or workflow changes.

## Plan / Todo (lot-based)
- [x] **Lot E11b-0 — Evidence and installed qualification**
  - [x] Read #789 scope: E7 supplies host binding/maintenance, not the neutral fenced handle; E10a supplies the installed handle. Stage B still uses fixture glue and unconditional skips.
  - [x] Replace fixture handle/codec/fence authority with shipped createMemoryNeutralHandle; reacquire a fresh assembly on every reopen. Qualification follows in the installed runner.
  - [x] Add installed consumer routing with source-free runtime/assets, remove unconditional skips, and add a separate Stage B CI lane; qualification remains pending until all behaviors pass.
  - [x] First installed run: 16/23 behaviors pass; fix adapter Number narrowing using E2 U64AtomicUnit, align fixture store identity, and exercise bijection after releasing the live holder. No Engram change identified.
  - [x] Replace fixture handle with shipped factory; run durable-memory.spec.ts (all 23 behaviors) from a clean packed consumer with real PostgreSQL, including independent crash/ownership processes.
  - [x] Installed dev.7 run d1726c309: 23 behaviors + inventory pass, zero skip/todo; stage-b.status exit=0 cleanup=0; archive SHA-256 7aeb92cf…395e271. Retain JSON result and exact archive for tuple binding.
  - [x] No Engram-owner change is required: 23/23 pass on published 0.21.3 after the bounded host fixes.
  - [x] Remove the unused fixture codec/handle helper and describe standalone E10 coverage separately from the passing installed Stage B campaign; preserve historical checked-in receipts verbatim.
- [x] **Lot E11b-1 — Package and tuple**
  - [x] Pack dev.7 with standalone neutral declaration; bind slot 15 SHA-256 and derive neutralContract.status from slot 15.
  - [x] Add build-time standalone C6 emission from tsc declarations; no external imports; expected SHA-256 5a8c13c5…773229, verified against dev.6 declaration with only its source-map comment removed.
  - [x] Pin dev.7 archive/SRI and d1726c309 source; prepare from installed Stage B archive and fresh locked E10 consumer, with unmodified lane assertions and standalone compilation. Each new tuple binds its own logs/locks; historical tuple stays immutable.
  - [x] Derive five QUALIFIED claims only from all 23 named passing cases plus inventory, zero skipped/todo, identical installed archive SRI, packed claim identities and cleanup success. Slot 15 checks compiled standalone bytes; neutralContract.status follows slot 15; C9 names the 1.0.0 digest supersession.
  - [x] Update installed-memory.mjs/qualification.mk to 0.21.3/dev.7; clean npm-ci/type/runtime/two-process proof and standalone compilation pass, cleanup=0; qualify five profiles from zero-skip evidence.
  - [x] Regenerate/check/test tuple 29c83333e34363c515dec2e92c00129f5a0d411df2a4d1be368c7a4531fc7a0a, 10/10 tests; retain bundle in e11b-current and archive/SHA-256 in shared e10-artifacts; no PENDING input slot; C9 explicitly names dff737ce → dd0cccbd under 1.0.0.
- [ ] **Lot E11b-2 — Validation and draft PR**
  - [ ] Typecheck/lint affected cluster-mesh paths; memory-e11-test and memory-e11-check run in CI.
  - [x] Local typecheck passes. Full memory run identified one old C6 null-hash expectation (220 pass); update it to the shipped declaration hash/status and rerun the affected suite.
  - [x] Local lint passes. Refresh source snapshot to 2d9d5da97 for E10 coverage labels/C6 expectation; original dev.7 pack source remains d1726c309 and packed-source diff is empty. Reuse the retained install lock.
  - [x] Focused corrected C6 suite passes 17/17; repeated E10 installed proof and tuple tests/check pass; owned make down succeeds. CI will rerun the full suite on the PR head.
  - [x] Vendor historical input inventory excerpt, reservation and producer record so CI needs no owner-local Markdown files; these records do not promote current qualification.
  - [x] Retain the receiver's exact readHostTuple excerpt for the development-version refusal test; this excerpt is evaluated with explicit dependencies, not executed as a standalone CLI.
  - [x] Retain the receiver format reference; document the two explicit excerpts and distinguish historical records from fresh qualification evidence.
  - [x] Wire CI to prepare/lock/install the same pinned candidate, generate its own tuple, run memory-e11-test and memory-e11-check, and upload complete receipts; add negative Stage B promotion tests.
  - [ ] Draft PR to feat/engram-e2-integration; completed/success exact-head CI retained externally; no merge/publication.
- [x] **Lot E11-4 — Integration refresh**
  - [x] Diagnose run 40741738278: common lane fails resolving AWS core ^3.978.7 at 18:45:38 UTC; registry publication occurred at 18:47:57 UTC. Unmodified common target passes locally (11 tests).
  - [x] Packed-consumer probe passes in test-mem-e11 through PACKED_ADAPTERS_OK; artifacts tarball SHA-256 matches the failed CI job exactly. Preserve npm stderr for future failures.
  - [x] Prior E11 complete E2 qualification and tuple check: .tmp/packets/pr818-ci-40741738278/LOCAL-RECEIPT.md and FINAL-RECEIPT.md (review #818 r1).
  - [x] Merge integration after #821/#803, never rebase; retain E11 plan and union all Makefile environment selectors. No `.track` changes on either side of this merge.
  - [x] Generate/check the 0.21.3/dev.6 tuple and receiving checklist; preserve evidenced Stage B gaps.
  - [x] Stage published Engram and retained dev.6; adapt only E10 consumer version/archive assertions, never package bytes or artifacts sources.
  - [x] Add make-owned E2 lock freeze and strict fresh npm-ci campaign with source/PG identity, lock comparison, type/runtime proof and automatic owned-stack cleanup.
  - [x] Pin integration source/tree, 0.21.3 SHA-256/SRI, dev.6 SHA-256/SRI and the producer neutral JCS bytes.
  - [x] Checker recomputes the domain-separated contract digest, compares mesh/producer manifest bytes and validates the explicit E10 consumer adaptation and installed closure.
  - [x] Resolve all 0.21.3-dependent slot reasons; preserve independent Stage B, standalone declaration, CI and release/ACK gates explicitly.
  - [x] Emit resolved contract path/hash/digest and installed-candidate provenance; retain the separate L5 exclusion and pack source head.
  - [x] Update receiving shape/refusal checks for resolved JCS bytes and explicit remaining slots 15/16/21; reject manual promotion.
  - [x] First campaign passed runtime/types and cleanup; finalizer caught a relative tsc entry path. Pass the absolute consumer entry, retaining the strict closure guard, and rerun.
  - [x] Replace historical receiving checklist with exact 0.21.3/dev.6/contract/image values, independent qualification gaps and ordered release/ACK handoff.
  - [x] Second campaign passes runtime/types, absolute closure and cleanup; producer manifest is internal, so inspect an in-memory export without changing installed bytes, then rerun only finalization.
  - [x] Static verification binds all three adapted consumer entry/helper/type files independently of the observed import closure, plus the complete transformation receipt.
  - [x] Producer extraction passes. First tuple test exposed the mesh manifest wrapper; compare its manifest, canonical bytes, byte hash and digest rather than the enclosing metadata object.
  - [x] Freeze successful E2 receipt, package/lock, campaign log/status and adaptation hashes as checker anchors; successor reruns require an explicit reviewed evidence update.
  - [x] E10 final-head CI `cfd45de4d54651626e97113494b9d7bd108998c8` completed/success in run 40727760123; bind that exact receipt as slot 21. E11 exact-head CI stays a separate post-push receipt to avoid self-reference.
  - [x] Nine tests pass, generation/check exit 0, cleanup 0; tuple SHA-256 `66fa8eeef276dfd73fdb9440f589dbdeff33417e8650b55ac354e894cd547527`; complete bundle retained in `.tmp/engram-e2-host-tuple/e11-current/`.
  - [x] Prior E11 exact head 6a8eee916 CI run 40773445916 completed/success; #818 r1 verified 63 passed jobs, 26 skipped; no publication or ACK.
- [x] **Lot E11-0 — Baseline and scope**
  - [x] Read MASTER/workflow, plan E11, PR #803 E11 inputs, Opus r3 21-entry inventory, RESERVATION.md and Docker lock packet; mechanical branch PASS.
- [x] **Lot E11-1 — Generator and checker**
  - [x] File/archive binding primitives and deterministic comparison added; final acceptance refuses preparation.
  - [x] Pin current candidate hashes and snapshot committed E10 inputs without changing its sources or locks.
  - [x] Encode all 21 input categories and independent receiving gates with explicit PENDING reasons.
  - [x] Validate source/package, tarball identities, retained locks, installed closure, migration bytes, engines and exact profile statuses.
  - [x] First real fixture run exposed a root-level hydration helper in E10 runtimeClosure; bind its retained bytes to the committed lane snapshot and compare installed locks byte-for-byte.
  - [x] Preserve documented receiving top-level fields; null C6 final path/hash and empty qualified profiles deliberately retain source-gap; bind format/receiving-validator evidence.
  - [x] Execute the retained receiver's actual shape gate against preparation and require source-gap for development backend, missing C6 final bytes and unqualified profiles.
  - [x] Add `tools/engram-e11/{tuple,bindings,slots}.mjs` and candidate spec; hash files/tarballs/backend/C6/locks; reject drift and status promotion.
  - [x] Add `tools/engram-e11/e11.mk`: pinned Node 24, temporary evidence, deterministic dry-run/check; no lock regeneration.
  - [x] Add `tools/engram-e11/tuple.test.mjs`: tampering, missing input, pending/final refusal, deterministic output.
- [x] **Lot E11-2 — Receiving handoff**
  - [x] Add `tools/engram-e11/README.md`: 21 categories, PENDING reasons, retained-lock install, reservation, main PR, CI publication, byte recheck, separate C9/L5 ACKs.
- [ ] **Lot E11-3 — Evidence and draft PR**
  - [x] Run make tests and candidate dry-run/check under flock: 9/9 passed, generation/check exit 0; tuple SHA-256 `9edee7d7998addd6ddc2ff383989d3fd0805d2dc3f84fd467604f40e8438a2cd`; PENDING inventory in `tools/engram-e11/DRY-RUN.md`.
  - [x] Retain complete bundle via memory-e11-retain outside the worktree; cleanup via make down after Docker verification.
  - [ ] Review scoped diff; draft PR against feat/engram-e2-integration; completed/success CI on exact head; no merge/publication.

## AI Flaky tests
- [x] No provider tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; no delegated implementation.

## UAT Management (in orchestration context)
- [x] Evidence tooling only; web, Chrome and VSCode unaffected; deterministic checks and negative tests.

## Feedback Loop
- [x] #821/#803 merged into integration; published 0.21.3/dev.6 carry producer intentHash, and the neutral JCS byte/digest pair is resolved.
- [x] E9/host-binding source gap resolved in E11b: all 23 Stage B behaviors pass through the installed dev.7 handle, no blocked markers.
- [x] C6 packaging source gap resolved in dev.7: standalone declaration SHA-256 5a8c13c51eb00b350fae0b271d5357f54bdb01c930d607f679372bebff773229, compiled in the installed closure; C9 remains a separate owner ACK.
- [ ] PENDING conductor/release owners: stable reserved-version qualification, integration → main PR, CI-only publication, published-byte recheck, producer C9 ACK and receiving ACK.
- [x] Review author: host codex, model gpt-6.1-sol, effort high (owner declaration).
