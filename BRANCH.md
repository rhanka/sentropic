# Feature: Cluster-mesh comments M2 on the generic storage port (K1-K4 consolidated, Postgres injected driver, import/receipt/readback)

## Objective
- [ ] Consolidate the storage stack K1+K2a+K2b+K3 (#666, #669, #670), K4 (#671) and comments C0 (#667) onto ONE linear branch and ONE draft PR (owner rule against salami slicing).
- [ ] Close the open K2b r3 findings (MAJEUR-N1, MINEUR-1..10) and the K4 findings (Opus B1, MAJ-1..9, m1..m13; engram Sol S4:1..12) by rebuilding K4 on this K3 per the integrity design note N1-N12 / C01-C19.
- [ ] Deliver comments M2 for the Immo host (Radar PR #859): cluster-mesh comments module on the storage port, injected-driver Postgres module, import interface, typed complete receipts and authorized readback (Steve data migration).

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` storage kernel, comments module, Postgres module, M2-W wiring, their specs/docs, and the cluster-mesh version bump.
- No migration in `api/drizzle/*.sql`; Postgres assets are package assets under `packages/cluster-mesh/assets/storage/postgres/`.
- Make-only workflow, no direct Docker commands; one Docker build at a time (`make ps-all` first).
- Root workspace `~/src/sentropic` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in worktree `tmp/worktrees/cm-comments-m2` on branch `feat/cluster-mesh-comments-m2`.
- Automated test campaigns run on `ENV=test-cm-comments-m2`, never on root `dev`.
- In every `make` command, `API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720` then `ENV=test-cm-comments-m2` passed as the last argument.
- Linear history only: no merge commits; per-branch BRANCH.md commits of the source branches dropped.
- Frozen comments M1 (`packages/comments/src/**`, `contract-v1.json`) and merged engram L6a stay unchanged.
- Kernel and Postgres module stay neutral: no `pg`, no `drizzle`, no `engram`, no `api/` imports; hosts inject query/transaction execution.
- Storage port co-owner gr-conductor (engram): validated K3 behaviour is preserved; every port change is recorded in `## Feedback Loop` for its co-review.
- Test-first with discriminating mutations; commits under 150 lines with BRANCH.md updated in the same commit.
- Never merge, never publish; all new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package-lock.json`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/src/storage/**`
  - `packages/cluster-mesh/tests/storage/**`
  - `packages/cluster-mesh/assets/storage/**`
  - `packages/cluster-mesh/src/comments/**`
  - `packages/cluster-mesh/tests/comments-*.spec.ts`
  - `packages/cluster-mesh/src/modules/contracts.ts`
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/src/modules/registry.ts`
  - `packages/cluster-mesh/src/compose/comments.ts`
  - `packages/cluster-mesh/src/hono/comments-router.ts`
  - `packages/cluster-mesh/src/loaders/comments/index.ts`
  - `packages/cluster-mesh/src/integrations/comments/index.ts`
  - `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md`
  - `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md`
  - `docs/comments-annotations/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/comments/src/**`
  - `docs/comments-annotations/contract/contract-v1.json`
  - `packages/cluster-mesh/src/live*/**`
  - `api/**`
  - `ui/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
  - `packages/cluster-mesh/package.json` `exports` map changes (new public subpaths)
  - `packages/cluster-mesh/tsconfig.json`
- **Exception process**:
  - Declare exception ID `BRCM2-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop`.

## Feedback Loop
- [ ] `attention` BRCM2-EX1 — initial BRANCH.md creation exceeds 150 lines (template-mandated detailed plan); doc-only commit; rollback: none needed.
- [ ] `attention` BRCM2-EX2 — consolidation commits are carried as-is from #666/#669/#670/#671/#667 (authorship preserved, BRANCH.md stripped); historical commits above 150 lines (for example K4 `staged-runtime.ts`, 986 lines) are not rewritten; the K4 rebuild lots replace them with commits under 150 lines.
- [ ] `attention` BRCM2-EX3 — MAJEUR-N1 corpus re-derivation touches the reference and four corpora (~690 changed lines); the reference rejects every non-codec digest, so the corpora and reference land as three file-grouped commits (corpora RED first, reference GREEN last) above 150 lines each; rollback: revert the three commits together.
- [ ] `attention` BRCM2-PORT — storage port changes for gr-conductor (engram) co-review:
  - [ ] PORT-1 additive: `src/storage/staged-codec.ts` shared canonical staged codec (effects, derived dependencies, fragment digest, dependency/effect roots, v1); K3 validated behaviour unchanged.
  - [ ] PORT-2 root composition: opt-in indexed backend state and a trusted mutation coordinator will cover ordinary writes, transactions and current-coverage reads; adapter handles keep binding only. Existing default K3 behavior is qualified by its 56-test suite; co-review required for the additive root options and backend record-history type.
  - [ ] PORT-3 backend identity: an injected backend must retain one module/incarnation identity and hold hidden progress by scope/namespace; cross-module reuse and a conflicting incarnation are rejected before binding.
    - [x] RED identity probes observed; backend pins identity and exposes trusted scoped control storage for resumable hidden preparation. All eight coordinator/identity probes pass.
- [ ] `attention` BRCM2-VER — version ordering: npm `@sentropic/cluster-mesh` 0.16.0 = main 0.16.0; PR #679 holds 0.18.0; this branch takes 0.19.0 so either merge order keeps both strictly above main. `@sentropic/comments` stays 0.3.0 unless `packages/comments/src/**` changes (forbidden here).
- [ ] `attention` BRCM2-PG — real Postgres qualification needs a Postgres service reachable from `make test-cluster-mesh`; Makefile/docker-compose are forbidden here. Until a decision, Postgres lots are qualified against the injected structural driver port with an in-process executor; real-PG qualification stays an open gate.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- No AI test is in scope for this branch (no `api/tests/ai/**`, no AI E2E spec touched).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: owner rule « tu te rends compte qu'il va falloir rebase 50 fois avec 50 ci cd ? » — one branch, one PR, one CI cycle per push.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- This branch has no UI surface (package-only); no web app, Chrome plugin or VSCode plugin UAT applies. Host acceptance belongs to the Immo host (Radar PR #859).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `rules/security.md`, `plan/BRANCH_TEMPLATE.md`.
  - [x] Read the integrity design note, K2b Opus r3, K4 Opus, engram Sol K4 co-review, frozen L3a v4.1 §17 and `spec/SPEC_EVOL_COMMENTS_ANNOTATIONS.md`.
  - [x] Worktree `tmp/worktrees/cm-comments-m2` on `feat/cluster-mesh-comments-m2` from `origin/main` `fb5e92a6a`.
  - [x] Make targets: `typecheck-cluster-mesh`, `lint-cluster-mesh`, `test-cluster-mesh`, `build-cluster-mesh`, `pack-cluster-mesh`, `test-packages SCOPE=...`, `scope-check`.
  - [x] Environment: `ENV=test-cm-comments-m2`, `API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720`; command shape `make <target> <vars> ENV=test-cm-comments-m2`.
  - [x] Consolidation K3: `origin/feat/cluster-mesh-storage-k3` `534922e70` (contains K1 #666 and K2b #669) filtered of BRANCH.md (40 BRANCH-only commits dropped) and rebased linearly on `fb5e92a6a`; storage tree byte-identical to `534922e70`.
  - [x] Consolidation K4: 8 code commits of `origin/feat/cluster-mesh-storage-k4` `1c6249509` cherry-picked (BRANCH.md and report-only commits dropped); NO-GO code carried for rebuild in Lots 2-5.
  - [x] Consolidation C0: 30 commits of `origin/feat/comments-cm-c0` `e19b394e2` and its `spec/comments-annotations-port` intake cherry-picked; C0 paths byte-identical to `e19b394e2`; obsolete K1 duplicates and already-merged M1 commits not replayed.
  - [x] Version bump `@sentropic/cluster-mesh` 0.16.0 -> 0.19.0 with lock and selected packaging fixture (BRCM2-VER).
  - [x] O4:B1(a) compile-only adaptation of carried K4 `staged-runtime.ts` to the K3 `KernelRoot` type (typecheck RED: `bindNew`/`revoke` missing on `KernelHandle`); B1(b)/(c) stay in Lot 2.
  - [x] Existing draft PR #684; #666, #669, #670, #671 and #667 are CLOSED with a comment pointing to #684 (verified on relaunch); reuse #684.
  - [ ] Lot gate: `make typecheck-cluster-mesh API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` + `make test-cluster-mesh API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` (carried K4 runtime failures recorded, fixed by Lots 2-5).
    - [x] Typecheck green at `8fec6302d`.
    - [ ] Tests at `8fec6302d`: 61 files pass, 5 skipped, 3 failed (`staged-units.spec.ts`, `visibility.spec.ts`, `manifest.spec.ts`; 9 K4 tests) — all `UnsupportedProfileError: fenced-writers-v1` from carried K4 passing a fence to K3 `commitAtomic` (O4:B1(b)), owned by Lot 2. K1/K2a/K2b/K3/C0 suites green.

- [x] **Lot 1 — K2b r3 findings (shared corpus and reference)**
  - [x] MAJEUR-N1: add a shared canonical staged codec (versioned, domain-separated, framed) deriving `fragmentDigest`, `dependencyRoot` and `effectRoot`; reference recomputes on every ordinal and on seal; corpora derive values from the codec instead of `dep-root-k2b` / `eff-root-k2b`.
    - [x] RED spec `packages/cluster-mesh/tests/storage/staged-codec.spec.ts` (independent literal vectors + discrimination).
    - [x] Codec `packages/cluster-mesh/src/storage/staged-codec.ts`; mutants MC1 (dependencies dropped), MC2 (moduleResult always absent), MC3 (null predecessor encoded as empty) each killed at one targeted test.
    - [x] Corpora derive digests/roots via `stagedDigestOf` / `stagedSealRoot` (`staged-corpus.ts`, `barrier-corpus.ts`, `replay-corpus.ts`); new cases: changed-dependency retry, other-effects digest on a new ordinal, self-consistent foreign roots, unresolved dependency at seal; handle carries `moduleId`/`scope` (K1 `StagedUnitHandle` alignment).
    - [x] Reference recomputes digests on every ordinal, roots at seal, and dependency closure over base plus earlier fragments; mutants S14 (new-ordinal digest trust) and S15 (closure blind) killed at their targeted assertions; S2/S7 kept faithful (gap mutant recomputes its digest; buffer mutation moved after seal so roots do not mask it).
    - [x] Evidence: `make test-cluster-mesh ... ENV=test-cm-comments-m2` 62 files pass, 3 fail (the 9 carried K4 tests, unchanged, Lot 2).
  - [x] MAJEUR-N1: C01 case with a self-consistent but wrong digest on a NEW ordinal and a changed-dependency-only retry; mutant "trust caller digest on new ordinal" killed at its targeted assertion.
  - [x] MINEUR-1: read corpus accepts `null` or a fitting recovery cursor on empty `incomplete` pages; cross-validate missing-head, disposed-chain and empty pages through `validateReadPage`.
  - [x] MINEUR-2: M18 mutant measures the candidate cursor instead of the effective cursor (no budget inflation).
    - [x] Evidence: `assertEmptyIncomplete` (null or fitting cursor plus explicit recovery of the exact remaining records), `validateReadPage` on disposed/missing/floor pages, `RecoveryCursorStore` conformance test in `reference.spec.ts`; M18 now overrides `admissionCursor` and dies at "the exhausting record is admitted with its effective null cursor" (final E/E-1 envelope case); `reference.spec.ts` 36/36, `mutations.spec.ts` 19/19, `kernel.spec.ts` 56/56.
  - [x] MINEUR-3: mutant regexes pinned to one exact assertion each (M1-M16, S1, B1/E1); M4 gets a unique one-byte-budget assertion and B1/E1 target comment 0 head denial.
    - [x] `make -o build-events -o build-llm-gateway test-cluster-mesh SCOPE=mutations.spec.ts API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`: 59/59; prerequisite artifacts reused after the first full Make build.
  - [x] MINEUR-4: raw tombstone names `thread-2`; its covered child remains readable; B5 installs a barrier from the raw tombstone and dies at that exact assertion.
    - [x] Relaunch evidence: `make test-cluster-mesh SCOPE=tests/storage/profile-mutations.spec.ts API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` passes 40/40, including B5.
  - [x] MINEUR-5: fence rotation hook (superseded fence cannot publish/abort/stage), nested record and append aliases through exact byte readers, hidden audit reader, deliberate `unitId` collision across scopes.
    - [x] RED shared probes: `tests/storage/staged-integrity-corpus.ts` and `staged-integrity.spec.ts` force a colliding recipient id with its valid digest, inspect hidden audit membership, mutate nested bytes and rotate the current fence.
    - [x] Reference checks full-scope/owner handles and the current scope fence at every staged mutation; audit membership is copied and published with canonical effects. The two shared probes now pass; discriminating mutants follow.
    - [x] Mutants: scope-blind colliding handle, nested record alias, nested append alias, premature audit publication and begin-fence-only validation, each killed at its exact assertion in `staged-integrity.spec.ts` (7/7).
  - [x] MINEUR-6: replay ports gain `fence`, `pauseConsumer`, `maintain` authority; refusal cases for unauthorized principal, stale fence, wrong incarnation; `c-stall` consumes the snapshot then checks poison redelivery; mutant "resync clears stall".
    - [x] Replay RED port: explicit incarnation/owner/current-fence binding, maintain-only checkpoint/pause/retry/resync, pause-preserving resync and poison redelivery after snapshot consumption.
    - [x] Reference implements maintain/fence checks and pause/retry; replay mutation fixtures forward the original maintenance fence. `profile-mutations.spec.ts` passes 40/40.
    - [x] `tests/storage/replay-integrity.spec.ts`: five exact-target mutants killed (5/5): resync clearing stall, write-only maintenance, stale epoch, wrong incarnation and wrong owner.
  - [x] MINEUR-7: snapshot returns root state (heads/indexes) not journal events; captured roots authenticated; external journal scoped per stream.
    - [x] Replay RED requires bounded canonical snapshot rows, captured heads/indexes, unissued/foreign-root refusal and one isolated external stream per scope; observed RED on the reference's journal-event response.
    - [x] Reference captures owned canonical rows under opaque scope-held snapshot capabilities and pages them with current authorization/coverage; J5 substitutes live rows while retaining the captured watermark and dies at the content-boundary assertion. Profile mutations: 40/40.
    - [x] External reference streams are keyed by full scope/incarnation and copy exact kernel events; the cross-scope exposure mutant targets C11.
  - [x] MINEUR-8: lifecycle interruption after commit before response; outcome/notification counts; record/aggregate disposal reported as `retained` unless physically removed.
    - [x] Lifecycle RED probes require explicit payload dispositions, independent outcome/notification membership, and response-loss recovery after committed disposal; the aggregate fixture now uses the K1 encoded-value contract.
    - [x] Reference records actual retained/erased dispositions and canonical completion/notification membership before simulating a lost response; pre-outcome failure leaves the local disposal uncommitted. Profile mutations pass 40/40; new lifecycle mutants follow.
    - [x] `tests/storage/lifecycle-integrity.spec.ts`: five exact-target mutants killed (5/5): duplicate outcomes, duplicate notifications, false record/aggregate erasure and committed completion lost after response interruption.
  - [x] MINEUR-9/10: `read-corpus.ts` header corrected at `655f13a46`. Historical K1 `R3-MUT1` overstated the evidence at its original date: actual targeted M6/M11 proofs are carried at `6d3d0f6aa`; exact assertion pins are at `a5ea9b226`. Stale source-branch reports are superseded by this branch/report, with current ancestry and version 0.19.0.
  - [x] Lot gate (K2b passes; the carried K4 failures remain assigned to Lots 2–5):
    - [x] `make -j1 -o build-events -o build-llm-gateway typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`: typecheck/lint pass, 65 files pass, 3 K4 files fail (9 tests), 5 packaging files skip; 698 tests pass, 9 fail, 34 skip. Evidence `.h2a/build/lot1-gates.log` and RTK recall `12990cbff865`, code head `d85c394da`.
    - [x] **Package tests (cluster-mesh, Vitest)**
      - [x] Updated: `packages/cluster-mesh/tests/storage/{staged-corpus,barrier-corpus,replay-corpus,lifecycle-corpus,read-corpus,reference-staged,reference-store}.ts`
      - [x] Updated: `packages/cluster-mesh/tests/storage/{reference,mutations,profile-mutations}.spec.ts`
      - [x] New: `packages/cluster-mesh/src/storage/staged-codec.ts`, `packages/cluster-mesh/tests/storage/{staged-codec,staged-integrity,replay-integrity,lifecycle-integrity}.spec.ts`, `packages/cluster-mesh/tests/storage/staged-integrity-corpus.ts`.
      - [x] Scoped runs: `make test-cluster-mesh SCOPE=<file-filter> API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`; mutations 59/59, staged integrity 7/7, replay integrity 6/6, lifecycle integrity 5/5; reference 36/36 and K3 kernel 56/56 also pass in the package gate.
      - [x] Sub-lot package gate executed above: K2b green; K4 adapters lack full-scope handles, replay maintenance and lifecycle hooks, and still pass fences into K3. These remain release blockers in Lots 2–5.
    - [x] **API tests**: not impacted (no `api/**` change).
    - [x] **UI tests**: not impacted (no `ui/**` change).
    - [x] **E2E tests**: not impacted (no app surface change).

- [ ] **Lot 2 — K4 rebuild on K3 (O4:B1, O4:m7, O4:MAJ-9)**
  - [ ] Indexed successors: `tests/storage/indexed-state.spec.ts` qualifies version preservation and capture without historical enumeration before coordinator integration.
    - [x] `src/storage/indexed-{tree,map}.ts`: immutable balanced search paths and lockable forked maps; indexed-state probes pass 2/2. Coordinator integration follows.
    - [x] Indexed history RED probe prevents successor creation from copying historical records; all three indexed-state probes pass.
    - [x] Backend adds opt-in indexed maps/histories and constant-metadata forks; K3 default state remains unchanged.
    - [x] Ordinary record preparation uses indexed forks when supplied, clones only touched history paths, and installs successor map pointers without replaying every scope entry; exact cursor sequence uses indexed lookup. Typecheck passes; K3 kernel suite stays 56/56.
  - [ ] Compose K3 `KernelRoot` (issuance) vs adapter `KernelHandle`; relay `predicates`, `authority`, `cursorSecret`, `incarnation`.
  - [ ] Internal root-aware mutation coordinator in K3 (captured read view, prepared overlay, conditional publication hook) used by both ordinary commits and K4; no fence passed to public `commitAtomic`.
    - [x] RED `tests/storage/mutation-coordinator.spec.ts`: ordinary mutations, stale-root CAS, preparation failure, authority revalidation, transaction coverage and unsupported-effect refusal; all 6 cases pass after wiring.
    - [x] Shared `prepareUnitsInScope` separates owned sequential preparation from publication, preserving the K3 guard/predicate/effect implementation for the root coordinator.
    - [x] `RootMutationCoordinator` captures indexed roots, prepares owned core/module effects, revalidates and switches the root conditionally.
    - [x] Kernel root options accept the trusted backend/coordinator; scoped adapters retain private wiring and frozen binding surfaces.
    - [x] Append/genesis/index/dispose/commit and ordinary reads participate in the configured root coordinator.
    - [x] Transactions publish through that coordinator and revalidate every contributing grant after preparation; transactional getters honor current coverage. K4 runtime composition remains the next step.
    - [x] Additional RED probes exercise transactional paging without scope/history enumeration and authority revalidation on an equal-result index replacement; both paths use indexed forks and fresh authority checks. Coordinator probes pass 10/10; typecheck passes.
  - [ ] K4 handles reuse K1 `StagedUnitHandle` / `ProfileClaim`; K4 exported from `src/storage/index.ts`; projections only through authorized ports.
  - [ ] Applicable K2b/K3 corpora run through K4 (`staged-units.spec.ts`).
  - [ ] Lot gate: copy of Lot 1 gate; tests updated `packages/cluster-mesh/tests/storage/{staged-units,visibility,manifest,kernel}.spec.ts`.

- [ ] **Lot 3 — K4 integrity (N1-N3; MAJ-1..3, m2, m3, S4:4, S4:10; C01-C04)**
  - [ ] Kernel-computed fragment digests and roots from the shared codec; owned deep-frozen buffers; divergent begin refused; terminal states kept.
  - [ ] Authenticated unforgeable handles/seals bound to module/tenant/workspace/incarnation/owner; current fence verified at begin/stage/seal/commit/abort and after the publication gate.
    - [ ] `src/storage/staged-state.ts` defines indexed canonical root attachments separately from backend-held hidden operation/consumer/snapshot progress; memory progress makes no durability claim.
    - [ ] `src/storage/staged-core.ts` binds progress to backend identity, verifies provisioned lane ownership/epoch/lease and exposes trusted provisioning/rotation separately from scoped adapter operations.
    - [x] Shared replay staging reuses the actual maintenance fence issued by its backend, allowing opaque lane ids without a hard-coded reference fence; profile mutations stay 40/40.
  - [ ] Seal binds base B, ordered fragment set, recomputed roots; bounded sealing steps honoring limits; failure does not reopen staging; distinct staged/commit/command-index namespaces.
  - [ ] Lot gate: copy of Lot 1 gate; tests `staged-units.spec.ts` + corpus cases C01-C04 with mutants.

- [ ] **Lot 4 — K4 publication (N4-N6; MAJ-4..6, S4:1-3, S4:5-6, m13; C05-C09)**
  - [ ] RED `tests/storage/projection-roots.spec.ts`: relationship changes prepare on an owned successor and nested delta buffers cannot mutate captured projection membership.
    - [x] Projection state forks immutable indexed relationship/delta roots; successive changes validate on the successor, descriptor/delta inputs are owned, and delta reads use a bounded window. Projection root probes pass 2/2; publication integration remains pending.
  - [ ] One atomic visibility point: data, barriers, projections, receipt and journal segment switch together under the scope gate with base compare.
  - [ ] Projection preparation on the prepared overlay (two removals of one link fail with no effects); evolving-head validation across fragments (h0 then h1).
    - [ ] `src/storage/staged-effects.ts` prepares module effects, verified purge authorizers, projections, audit and one scoped journal event on the owned root before publication; shared purge fixtures will be aligned with verified principals.
  - [ ] Real versioned root over immutable indexed maps; every mutation path (commit/transact/append/genesis/index replace/coverage/disposal) advances it; reparenting cannot escape an active barrier.
  - [ ] G5: imported content and its covering barrier publish in one unit (reference aligned).
  - [ ] Lot gate: copy of Lot 1 gate; tests `visibility.spec.ts`, `staged-units.spec.ts` with interleaved readers.

- [ ] **Lot 5 — K4 journal, manifests and ports (N7-N9, N11; MAJ-7..8, m1, m4-m6, S4:7-9, S4:11-12; C10-C18)**
  - [ ] Scoped/incarnated journal streams; resync preserves poison; fenced checkpoints with maintain authority; pause/retry.
  - [ ] Structurally framed deep-owned manifests bound to captured storage boundaries; awaited rejection assertions.
  - [ ] Semantic profile digests; advertise only implemented profiles; purge covers records/aggregates with honest dispositions.
  - [ ] Lot gate: copy of Lot 1 gate; tests `manifest.spec.ts`, `visibility.spec.ts`, `staged-units.spec.ts`.

- [ ] **Lot 6 — Postgres injected-driver module (P1, P2a, P2u, P2b-J, P2b-M, P2c consumed by comments)**
  - [ ] Structural driver port (parameterized query + transaction on one connection), serializable atomic ops, fences, error mapping in `src/storage/postgres/*.ts`; no `pg` import.
  - [ ] Assets `assets/storage/postgres/00N-*.sql` and `manifest.json`; host-owned migration history attachment.
  - [ ] Lot gate: copy of Lot 1 gate; new tests `packages/cluster-mesh/tests/storage/postgres-{core,readers,staged,replay,migrations,barriers}.spec.ts` (BRCM2-PG).

- [ ] **Lot 7 — Comments module C1a/C1b/C2 (`src/comments/`)**
  - [ ] Eleven-kind codecs, exact 24-method store mapping, request/transaction context, authority composition (C1a).
  - [ ] Three named queries, projections, PG projection assets (C1b); lifecycle, coverage, purge, availability (C2).
  - [ ] Lot gate: copy of Lot 1 gate; new tests `packages/cluster-mesh/tests/comments-{store,transactions,authority,queries,hashes,lifecycle,purge,coverage}.spec.ts`; frozen M1 corpus and hash vectors on the module.

- [ ] **Lot 8 — Import, typed complete receipts and authorized readback for the Immo host (C4a/C4b/C4c)**
  - [ ] Versioned fragment/root/continuation codecs and `transport-v1.json` vectors (C4a).
  - [ ] Import in chained sub-units and atomic groups with mappings; typed complete batch/unit receipts recoverable after commit-before-response (C4b).
  - [ ] Authorized readback/export with terminal completeness and continuation; truncated terminal export rejected (C4c).
  - [ ] Lot gate: copy of Lot 1 gate; new tests `packages/cluster-mesh/tests/comments-{fragment-vectors,import,receipts,import-crashes,export,transfer,long-history}.spec.ts`.

- [ ] **Lot 9 — M2-W registration and canonical Hono API**
  - [ ] Local module discovery/load/probe in `src/modules/{catalog,registry,contracts}.ts`; `src/compose/comments.ts`, `src/loaders/comments/index.ts`, `src/integrations/comments/index.ts`.
  - [ ] `src/hono/comments-router.ts` with no raw lifecycle bypass; forged HTTP tombstone / `purge-outcome` refused without effects.
  - [ ] Lot gate: copy of Lot 1 gate; new tests `packages/cluster-mesh/tests/comments-{module,router}.spec.ts`; existing `packages/cluster-mesh/tests/modules/{registry,capabilities,namespace-loading,topology,topology-ranges}.spec.ts` and `tests/conformance/h2a-contract.spec.ts` green.

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Update `spec/SPEC_EVOL_CLUSTER_MESH_MODULE_STORAGE.md` with K4 rebuild, Postgres module and port changes (BRCM2-PORT).
  - [ ] Update `docs/comments-annotations/contract/storage-compatibility.md` and evidence index with M2 delivery and Immo import/receipt/readback API.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint: `make typecheck-cluster-mesh ... ENV=test-cm-comments-m2`, `make lint-cluster-mesh ... ENV=test-cm-comments-m2`
  - [ ] Retest package: `make test-cluster-mesh API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`
  - [ ] Build and pack: `make build-cluster-mesh ... ENV=test-cm-comments-m2`, `make pack-cluster-mesh ... ENV=test-cm-comments-m2`
  - [ ] Retest API/UI/E2E: not impacted (no app surface change); CI suites must stay green.
  - [ ] Retest AI flaky tests: not applicable.
  - [ ] Bumped `packages/cluster-mesh/package.json` 0.19.0, re-verified `> npm view @sentropic/cluster-mesh version` after every rebase.
  - [ ] Final gate step 1: create/update PR using `BRANCH.md` text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both `OK`, commit removal of `BRANCH.md`, push, and merge (owner only).
