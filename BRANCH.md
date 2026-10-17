# Feature: Cluster-mesh comments M2 on the generic storage port (K1-K4 consolidated, Postgres injected driver, import/receipt/readback)

## Objective
- [x] Consolidate the storage stack K1+K2a+K2b+K3 (#666, #669, #670), K4 (#671) and comments C0 (#667) onto ONE linear branch and ONE draft PR (owner rule against salami slicing).
- [x] Close the open K2b r3 findings (MAJEUR-N1, MINEUR-1..10) and the K4 findings (Opus B1, MAJ-1..9, m1..m13; engram Sol S4:1..12) by rebuilding K4 on this K3 per the integrity design note N1-N12 / C01-C19.
- [x] Deliver comments M2 for the Immo host (Radar PR #859): cluster-mesh comments module on the storage port, injected-driver Postgres module, import interface, typed complete receipts and authorized readback (Steve data migration).

## Scope / Guardrails
- Scope limited to `packages/cluster-mesh` storage kernel, comments module, Postgres module, M2-W wiring, their specs/docs/version bump and the narrow EX7/EX8 CI/build prerequisite corrections.
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
  - `packages/cluster-mesh/CHANGELOG.md` (Opus m2)
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/cluster-mesh/tests/packaging/types-and-bundlers.spec.ts` (BRCM2-EX6)
  - `packages/cluster-mesh/README.md` (BRCM2-EX6)
  - `scripts/ci/publishable-ci-wiring.test.mjs` (BRCM2-EX7)
  - `Makefile` (BRCM2-EX8/EX9: comments prerequisites and ephemeral package tooling)
  - `api/Dockerfile` (BRCM2-EX8: unchanged peer build ordering only)
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
  - `.github/workflows/ci.yml` (BRCM2-EX5: storage qualification only)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/comments/src/**`
  - `docs/comments-annotations/contract/contract-v1.json`
  - `packages/cluster-mesh/src/live*/**`
  - `api/src/**`
  - `api/tests/**`
  - `api/drizzle/**`
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
- [x] `acknowledge` BRCM2-EX8 — comments prerequisites and Docker peer ordering fixed the cold TS2307 failure. Run 39024243221 at 383d48f24 passed API typecheck, API image and toolbox image. Impact: build ordering only; rollback: restore the prior order with comments module removal.
- [x] `acknowledge` BRCM2-EX9 — owner-requested Opus m7: make cluster-mesh cold build/typecheck/test self-contained and keep dependencies inside disposable containers. Root Makefile tooling and the qualification include may change. CI retains the explicit include under tests/storage as the accepted isolated PostgreSQL harness. Rollback: revert tooling and qualification wiring together.
- [x] `acknowledge` BRCM2-EX7 — CI's exact Cluster Mesh candidate/post-publication tuple assertion omitted the newly required optional comments peer. Updated its expected tuple to the already qualified comments@0.3.0 configuration. Impact: one workflow wiring regression test; production manifests/guard policy unchanged. Rollback: revert the assertion with the corresponding CI tuple change.
- [x] `acknowledge` BRCM2-EX6 — packed qualification exposes a hard-coded inventory of eight foreign provider proxy leaves; the new local comments leaf requires an explicit ninth local-export assertion. Also document the delivered storage/comments exports in the shipped README. Impact: one packaging test and package documentation; no runtime contract changes. Rollback: revert these two file changes with the new comments export.
- [ ] `attention` BRCM2-PORT17 — nested binding revalidation now joins the active same-scope PG session and remains attached to its final revalidation set. This removes a hidden second-connection requirement without weakening issuance, revocation, lifetime or scope checks; installed page reads also honor configured work maxima. Co-review pending.
- [ ] `attention` BRCM2-PORT16 — installed modules can read bounded pages through the existing kernel reader/session; comments authorization and exact captured boundaries remain module-owned. No caller SQL or read-enforcement flag is accepted. Co-review pending.
- [ ] `attention` BRCM2-PORT15 — trusted installed context separates actual committed root/version from pending state, preventing retained export of rolled-back writes. Co-review pending.
- [ ] `attention` BRCM2-PORT14 — installed read operations require read authority and cannot apply/stage canonical effects; they can persist bounded private continuation metadata on the same injected session. Co-review pending.
- [ ] `attention` BRCM2-PORT13 — trusted projection preparation receives backend-derived staged unit identity and captured coverage root for actual module validation, never values from scoped request flags. Co-review pending.
- [ ] `attention` BRCM2-PORT12 — installed staged contracts register domain authorization and policy handlers. Begin/intake/seal/publication/recovery use actual persisted unit facts; generic contracts retain generic coherence checks. No request supplies a callback/enforcement flag. Publication acquires the scope gate before its unit lock to match native hidden preparation; co-review pending.
- [ ] `attention` BRCM2-PORT11 — installed hidden preparation reuses kernel begin/stage/inspect on the existing injected session, including rollback-only propagation and outer grant/fence/domain revalidation. Hidden metadata/fragments commit without a canonical root event; no second canonical store or caller SQL is introduced. Co-review pending.
- [ ] `attention` BRCM2-PORT10 — installed native operations/finalization receive a private same-session SPI for real retained records, metadata and bounded kernel applies. Scoped requests supply only named input DTOs, never callbacks/SQL/enforcement flags. This enables authorized post-barrier intent and proof-gated final lifecycle append while all M1 getters retain denial semantics; co-review pending.
- [ ] `attention` BRCM2-PORT9 — module assets use independent local chains with explicit core dependencies; the single host-owned history is verified by ID and chronological dependencies. Fingerprints cover selected asset-owned objects. Core-007-after-comments regression PASS; same-session raw validation/effective projection split listed under PORT6. Co-review pending.
- [ ] `attention` BRCM2-PORT8 — reserved neutral `coverage-parent-v1` relationships install immutable indexed parents within ordinary/staged root preparation. Both memory and PG reject removal, cycles, reparenting and covered intake; no descendant enumeration or request-selectable bypass. Co-review pending.
- [ ] `attention` BRCM2-PORT7 — additive selected Postgres leaf uses asynchronous durable grant binding and the same object-shaped staged commit/abort inputs as K4. SQL session/query/outbox/history interfaces remain host-injected; K3's existing factory and validated behavior stay unchanged. Co-review by gr-conductor remains pending.
- [x] `acknowledge` BRCM2-EX4 — authorized package delivery needs public `storage`, `storage/postgres`, `comments` and selected composition/router leaves in `packages/cluster-mesh/package.json`; assets join the package files list. Impact: additive optional leaves, no root peer evaluation. Rollback: remove those new exports/assets entries together.
- [x] `acknowledge` BRCM2-EX5 — real Postgres and portable-digest qualification will be wired into `.github/workflows/ci.yml`, using a branch-local `tests/storage/postgres.mk` include. Impact: isolated package validation steps only; Makefile/Compose remain unchanged. Rollback: remove the added workflow steps and include invocation.
- [ ] `attention` BRCM2-PORT6 — immutable insert replay compares canonical bytes/hash, counts zero creations and excludes replayed records from PG projection deltas. New trusted validateEffects checks the full raw plan separately, preserving comments import validation. RED probes reproduce duplicate projections before this fix; gr-conductor re-pass required.
- [ ] `attention` BRCM2-PORT5 — issuance/revocation records are retained in the backend module/incarnation namespace so recreating a runtime on the same backend cannot revive a revoked token. K3's default fresh backend remains isolated; co-review pending.
- [ ] `attention` BRCM2-PORT4 — `CommitReceipt` carries the optional K1 encoded `moduleResult`; ordinary/staged recovery owns it deeply. Existing receipt fields and K3 unfenced behavior remain compatible; co-review by gr-conductor pending.
- [x] `acknowledge` BRCM2-EX1 — initial BRANCH.md creation exceeds 150 lines (template-mandated detailed plan); doc-only commit; rollback: none needed.
- [x] `acknowledge` BRCM2-EX2 — consolidation commits are carried as-is from #666/#669/#670/#671/#667 (authorship preserved, BRANCH.md stripped); historical commits above 150 lines (for example K4 `staged-runtime.ts`, 986 lines) are not rewritten; the K4 rebuild lots replace them with commits under 150 lines.
- [x] `acknowledge` BRCM2-EX3 — MAJEUR-N1 corpus re-derivation touches the reference and four corpora (~690 changed lines); the reference rejects every non-codec digest, so the corpora and reference land as three file-grouped commits (corpora RED first, reference GREEN last) above 150 lines each; rollback: revert the three commits together.
- [ ] `attention` BRCM2-PORT — storage port changes for gr-conductor (engram) co-review:
  - [ ] PORT-1 additive: `src/storage/staged-codec.ts` shared canonical staged codec (effects, derived dependencies, fragment digest, dependency/effect roots, v1); K3 validated behaviour unchanged.
  - [ ] PORT-2 root composition: opt-in indexed backend state and a trusted mutation coordinator covers ordinary writes, transactions and current-coverage reads; adapter handles keep binding only. Existing default K3 behavior is qualified by its 56-test suite; co-review required for the additive root options and backend record-history type.
  - [ ] PORT-3 backend identity: an injected backend must retain one module/incarnation identity and hold hidden progress by scope/namespace; cross-module reuse and a conflicting incarnation are rejected before binding.
    - [x] RED identity probes observed; backend pins identity and exposes trusted scoped control storage for resumable hidden preparation. All eight coordinator/identity probes pass.
- [x] `acknowledge` BRCM2-VER — required order: merge #679 (0.18.0) first, then rebase #684, resolve overlapping Makefile/CI/Dockerfile/lock edits and re-bump above both main and npm before publication. Current candidate is 0.19.0; it is not cleared for either merge order. `@sentropic/comments` remains frozen at 0.3.0. Never merge from this builder.
- [ ] `attention` BRCM2-U1 — gr-conductor co-review: validateAtomicUnit now rejects malformed arrays, records, guards, relations, barriers, purge intents and index results, including default K3 callers.
- [ ] `attention` BRCM2-U2 — gr-conductor re-pass: dense records[i].seq === i is an explicit memory-only representation contract, checked on restored arrays/indexed histories at composition; unrelated to DAG ordering/SQL layout.
- [ ] `attention` BRCM2-U3 — gr-conductor re-pass: trusted composition rejects a coordinator unless its exact backend is explicitly supplied.
- [ ] `attention` BRCM2-U4 — gr-conductor co-review: indexed disposeChainInScope retains bytes and reports retained disposition.
- [ ] `attention` BRCM2-U5 — gr-conductor re-pass: coordinated readPage/transaction readChain validate limit, byte budget and cursor after authority but before inaccessible results.
- [ ] `attention` BRCM2-U6 — gr-conductor co-review: storage/Postgres leaves and staged root/profile exports extend the public port; unused legacy alias will be deleted.
- [ ] `attention` BRCM2-U7 — gr-conductor re-pass: armFailure/beforePublish and failure state removed from shipped code/types; interruptions are test-side backend/response wrappers, with real async-checkpoint authority/fence probes PASS.
- [x] `acknowledge` BRCM2-PG — resolved through the branch-local Make include: real pinned PostgreSQL, all source/installed gates and actual server-SIGKILL recovery pass. No root Makefile/Compose change or infrastructure decision remains.

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
- [ ] **Opus corrections — PR #684 NO-GO (2026-10-17)**
  - [x] Engram U2/U3/U5: all four representation/composition/argument probes observed RED then PASS, including malformed cursors; memory contracts/spec and restored-state checks align. Existing K3 suites unchanged.
  - [x] Engram MAJ-1/2: effective-record and cursor regressions observed RED; postgres-effective-records.spec.ts 2/2 and comments-cursor.spec.ts restart/replica/key-mismatch 1/1 PASS.
  - [x] MAJ-1: owned-object fingerprints and typed PgSchemaDriftError; host-DDL regression and operator re-attestation PASS. postgres-reattest.spec.ts simulates PostgreSQL catalog-rendering changes, rejects stale approvals/actual drift and reopens after audited host approval.
  - [x] MAJ-2: generic PG cursorSecret is required and rejects empty/missing keys; stable host key, replica continuity and rotation implications documented and qualified.
  - [x] m1/m4/m10: required #679-first ordering, historical CI/EX8 state and complete gr-conductor U1–U7 inventory recorded; final candidate CI remains pending below.
  - [x] m2/m3: independent migration chains and core-007 upgrade PASS, original comments receipts unchanged; 0.19.0 changelog covers leaves/assets/digest/peer and required merge order.
  - [x] m4/m5: public-root hook assertion observed RED; armFailure/beforePublish/failure state and unused alias removed. Test-side publication/response wrappers and actual async-checkpoint probes PASS: root suites 13 files / 44 tests.
  - [ ] m6: formatting progress 14/72 atomic groups; TypeScript AST equality checked; SQL reflow changes only unquoted whitespace. Final gates follow.
  - [x] m7: source/PG/dependency helpers use disposable container dependencies; accepted include documented. Interrupted-run node_modules artifacts removed; self-contained cold typecheck PASS without host dependencies.
  - [x] m8: binding-derivation, terminal-root, receipt-owner SQL and captured-export-root mutants PASS with assertion-specific kill markers; import/receipt refusals assert exact typed conditions. Evidence: comments-transport-mutations.spec.ts 3/3 and comments-export-mutations.spec.ts 1/1.
  - [x] m9: host-owned full-receipt table/audit, finite host 40001 callback retry versus immutable module flush retry, and separate 50-operation recovery cap documented with concrete Immo migration guidance.
  - [ ] Final: source/PG/crash/installed gates, mutation record, push #684, fresh CI with restored OpenAI credit, report and stop without merging.

- [x] **Lot 0 — Baseline & constraints**
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
  - [x] Baseline carried K4 failures were observed RED and resolved by Lots 2–5; final typecheck/lint/source gates pass (93 files / 805 tests).
    - [x] Typecheck green at `8fec6302d`.
    - [x] Historical RED at `8fec6302d` (resolved by K4 rebuild): 61 files pass, 5 skipped, 3 failed (`staged-units.spec.ts`, `visibility.spec.ts`, `manifest.spec.ts`; 9 K4 tests) — all `UnsupportedProfileError: fenced-writers-v1` from carried K4 passing a fence to K3 `commitAtomic` (O4:B1(b)), owned by Lot 2. K1/K2a/K2b/K3/C0 suites green.

- [x] **Lot 1 — K2b r3 findings (shared corpus and reference)**
  - [x] MAJEUR-N1: shared framed canonical codec derives every fragment/dependency/effect root; reference recomputes new ordinals and seal roots, validates closure and refuses self-consistent foreign commitments.
  - [x] Literal vectors and discriminating mutants MC1–3, S14/S15, M6/M11 and assertion-specific M1–M18/S/B/E targets pass. Historical K1 evidence is corrected rather than backdated.
  - [x] MINEUR-1/2: empty incomplete-page cursors and effective-cursor byte measurement match exact E/E-1 envelopes.
  - [x] MINEUR-3/4: each mutant targets one exact assertion; raw thread tombstone leaves its dependent child readable unless an explicit barrier exists.
  - [x] MINEUR-5: current fence rotation, deep record/append aliases, hidden audit membership and valid-capability cross-scope unit collision probes.
  - [x] MINEUR-6/7: maintenance/current-fence/incarnation authority, real snapshot roots, scoped external journal and resync preserving poison/stall.
  - [x] MINEUR-8: lifecycle commit-before-response, exact outcome/notification counts and actual retained/disposed classification.
  - [x] MINEUR-9/10: corrected corpus header, current ancestry/report and version 0.19.0; supersedes stale source-branch reports.
  - [x] Files: `tests/storage/{staged-codec,reference,mutations,profile-mutations,staged-integrity}.spec.ts`; shared `{staged,barrier,replay,read,lifecycle}-corpus.ts` and integrity helpers.
  - [x] Recorded scoped gates: profile mutations 40/40, ordinary mutations 59/59, K3 kernel 56/56.
  - [x] Shared source gate: `make -j1 -o build-events -o build-llm-gateway typecheck-cluster-mesh lint-cluster-mesh test-cluster-mesh API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`.
  - [x] Detailed RED/GREEN and per-mutant evidence retained at [execution anchor](https://github.com/rhanka/sentropic/blob/7ddb9c836/BRANCH.md); this final checklist consolidates those notes to fit the exact PR-body limit.

- [x] **Lot 2 — K4 rebuild on K3 (O4:B1, O4:m7, O4:MAJ-9)**
  - [x] Replaced the obsolete staged runtime with indexed persistent maps/histories, one mutation coordinator, trusted root facade and binding-only adapter; K3 issuance/options and semantics remain intact.
  - [x] Ordinary writes, nested transactions, current-coverage reads, predicates, indexed replacements and staged preparation share real root publication; no historical scope clone/replay at commit.
  - [x] Owned/frozen descriptor, query and work-limit registration; bounded retained-root queries and protected callable profile ports. Unsupported private-live commitments and unimplemented profiles refuse explicitly.
  - [x] Files: `tests/storage/{indexed-state,mutation-coordinator,root-query,root-public,root-integrity,root-ordinary,staged-units,visibility,manifest,kernel}.spec.ts`.
  - [x] Every advertised profile is invoked through its actual public port; shared K2b/K3 corpora run through the replacement export.
  - [x] Legacy `staged-runtime.ts` and syntax-only seal implementation removed; unbounded client driving/failure injection lives only in test helpers.
  - [x] Historical integrated memory gate at `497d40838`: typecheck/lint pass, 85 files / 777 tests pass (RTK `5537ba475ece`); final source gate below supersedes it.
  - [x] Lot gate: shared Lot 1 source command; K3 remains 56/56.

- [x] **Lot 3 — K4 integrity (N1–N3; MAJ-1..3, m2/m3, S4:4/10; C01–C04)**
  - [x] Kernel recomputes every digest/root, authenticates current scope/owner/incarnation/capability/fence, deeply owns accepted bytes and preserves terminal identities.
  - [x] Durable intent freezes base B and ordered fragments; bounded seal preparation validates evolving heads and dependencies, streams canonical commitments and never reopens failed sealing.
  - [x] Root equality is framed/semantic rather than property-order dependent. Preparation owns/finalizes options before atomic publication; asynchronous final hooks refuse.
  - [x] Trusted maintenance recovery retains input, rotates backend-held handles/seals and records operator action; lost fragment/commit responses recover originals without duplicate journal events.
  - [x] Files: `tests/storage/{root-intake,root-capability-mutations,root-recovery,root-work,root-journal,root-seal,staged-units}.spec.ts`; shared C01–C04 corpora.
  - [x] Measured fixed-budget work forbids historical enumeration/whole-unit replay; final publication repeats contributor authority/current-fence checks. Lot 1 source gate passes; historical evidence linked there.

- [x] **Lot 4 — K4 publication (N4–N6; MAJ-4..6, S4:1–3/5–6, m13; C05–C09)**
  - [x] Data, coverage, projections, canonical receipt/moduleResult, audit and journal switch through one real immutable root under scope coordination/base CAS.
  - [x] Projection deltas validate sequentially on an owned successor; repeated removal or stale rival state refuses with no partial effects.
  - [x] Interleaved publication probes revoke grants/rotate fences at the actual wait; equal-result rival replacements still invalidate the sealed base.
  - [x] Exact immutable insert replay preserves original bytes and counts zero new records; changed representation under the same hash refuses.
  - [x] Imported historical content and its explicit covering barrier publish together. Reparenting cannot evade a current barrier.
  - [x] Files: `tests/storage/{projection-roots,root-publication-mutations,root-publication,visibility,staged-units}.spec.ts`; C05–C09 and receipt-ownership probes.
  - [x] Counter-only visibility implementation removed. Lot 1 source gate passes; K3 remains 56/56.

- [x] **Lot 5 — K4 journal, manifests and ports (N7–N9/N11; MAJ-7..8, m1/m4–6, S4:7–9/11–12; C10–C18)**
  - [x] Journal/checkpoint/snapshot authority binds scope/incarnation/owner and current maintenance fence. Only contiguous delivered prefixes can advance checkpoints; resync retains poison/pause.
  - [x] Snapshot pages visit bounded indexed positions of actual captured roots and recheck current coverage; captures retain real canonical state, not journal approximations.
  - [x] Manifest codec separately frames selections/heads/unit roots/terminal metadata and deeply owns input/returned heads. Value-only digests grant no storage capability.
  - [x] Actual root-bound manifests preserve head/sequence/allocation/version/owner and exclude newer writes. Foreign roots/owners and current barriers refuse across reopenings.
  - [x] Lifecycle verifies authorizers, holds/shared ownership and real dispositions; memory retains old-root bytes and advertises retained dispositions rather than physical erasure.
  - [x] Files: `tests/storage/{root-journal,root-snapshot,manifest-integrity,root-manifest,manifest,visibility,staged-units}.spec.ts`; C10–C18 and current-fence/poison/disposition mutations.
  - [x] Semantic profiles expose actual callable protected ports only. External-journal failure rolls back publication and leaves a seal retryable.
  - [x] Lot 1 source gate passes; detailed RED/GREEN/mutation history stays at the linked execution anchor.

- [x] **Lot 6 — Postgres injected-driver module (P1/P2a/P2u/P2b-J/P2b-M/P2c)**
  - [x] Parameterized structural driver/session/layout/outbox/query interfaces; serializable finite transactions, lossless byte/counter codecs, SQLSTATE/uncertain-outcome classification and owned/frozen configuration. No production driver/application import.
  - [x] Persistent SQL AVL metadata and separate canonical payload bytes; indexed old-root reads, exact sequence/CAS/allocation and one bounded scope-root/journal publication. No scope clone or historical replay at commit.
  - [x] Durable issued/revoked grants, incarnation, database-clock fence epochs/leases, owner capabilities and explicit maintained recovery. Revocation before issuance remains effective after restart.
  - [x] Staged intake/ACKs/prepared roots/seals/terminal receipts survive runtime reconstruction; every digest/closure/root is recomputed and each work step is bounded.
  - [x] Portable SHA-256 uses documented `@stablelib/sha256@2.0.1` save/restore; eight native-oracle restart/multibyte/branch/corruption vectors pass. Exact five-package MIT/SRI closure is locked and audited.
  - [x] Ordinary same-session transactions preserve sequential pending reads, nested rollback-only/closed handles and contributor revalidation. Owned immutable flush plans may retry bounded contention; arbitrary callbacks execute once.
  - [x] Current coverage, registered opaque retained queries/manifests, real captured heads, poison-preserving resync and contiguous fenced checkpoint CAS survive reopenings.
  - [x] External journal read/lookup/append uses its actual injected same-session table with zero duplicate package events; incomplete bindings refuse.
  - [x] Physical purge establishes a barrier before its first step, checks holds/shared ownership, erases current/hidden/retained bytes and only then commits one outcome/notification. Native numeric SQL ordering prevents ten-plus-item journal/purge truncation.
  - [x] Bounded maintain-authorized terminal cleanup removes aborted prepared bytes and duplicate staging while retaining terminal identities and published references.
  - [x] Six checksum-ordered core SQL assets attach to the host's single history. Startup checks actual schema columns/constraints/indexes/functions and receipt/checksum chains; it never applies migrations.
  - [x] Files: `tests/storage/postgres-{protocol,transactions,core,readers,record-budget,ordinary,staged,authority,queries,replay,manifest,barriers,lifecycle,hidden-purge,cleanup,external-journal,migrations,registration,profiles,installed-staging,module-policy,flush-retry,corpus,mutations,digest,crashes}.spec.ts`.
  - [x] Shared atomic/staged/barrier/lifecycle/replay corpora pass on real PostgreSQL. Three actual production mutations die at exact scope/fence/physical-byte assertions.
  - [x] Final real-PG neutral gate: 26 files / 47 tests PASS; two crash phase tests intentionally belong to the separate server-SIGKILL target. Comments gate adds the single-session nested-binding probe.
  - [x] Both independent-process server-SIGKILL phases PASS; saved hidden progress resumes and original committed receipt survives without duplicate canonical publication.
  - [x] Commands: `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-pg-test cluster-mesh-comments-test cluster-mesh-pg-crash-test API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`; RTK `e23b89c8a2b4`.
  - [x] Branch-local Make include/CI owns one pinned labeled test service/network/anonymous volume with no host port; cleanup never addresses another environment.

- [x] **Lot 7 — Comments C1a/C1b/C2**
  - [x] All 24 frozen M1 methods operate on the generic PG root through issued async contexts. Scope/principal/operation/lifetime/revocation checks survive runtime reconstruction and simultaneous contexts.
  - [x] Exact M1 `transaction().run(callback)` preserves pending reads, nested rollback-only errors and closed handles; all original registration/genesis/idempotency results survive retries.
  - [x] Eleven record kinds retain canonical bytes/hashes. Typed physical keys hash framed identities; immutable records, append heads, index causes and projections share one root.
  - [x] Six comments SQL assets attach to the same host-owned migration chain; actual projection/data schema drift refuses. Complete resource tuples prevent cross-tenant/workspace/type collisions.
  - [x] Operational lifecycle enforces actual target authority, immediate tombstone barriers and independent purge authority; only actual byte erasure permits a server-owned completion record.
  - [x] Imported historical tombstone/purge claims remain validated history and create no physical job; later independently authorized maintenance can derive and complete a real intent.
  - [x] Packaged digest-pinned unchanged corpus and all-kind vectors pass on PG. Three production C1 scope/coverage/canonical-byte mutations die at their exact assertions.
  - [x] Files: `tests/comments-{store,transactions,authority,queries,hashes,lifecycle,purge,coverage,mutations}.spec.ts`; shared frozen M1 oracle and module assets.
  - [x] Lot gate: Lot 1 source command plus `make -f Makefile -f packages/cluster-mesh/tests/storage/postgres.mk cluster-mesh-comments-test API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2`.

- [x] **Lot 8 — C4 import, complete typed receipts and authorized readback**
  - [x] Separate `comments-transport-v1` envelopes, literal escaped/multibyte native-SHA vectors and exact canonical/full-envelope budgets. No frozen M1 DTO/descriptor changes or time-only cursor expiry.
  - [x] Bind frozen request, mapping/source boundary, actual targets/capabilities, admitted sorted unit inventory and coherent group dependencies. ACK/control/kernel intake uses one injected transaction; every retry rechecks current fence.
  - [x] Chained bounded fragments remain hidden; terminal predecessor/count/typed payload roots must exactly match accepted records. Omitted/corrupt/changed/reordered/cross-scope data refuses without canonical effects.
  - [x] Server derives data/coverage and actual M1 manifest/unit/batch/audit effects; one root publishes bindings, original complete receipt/moduleResult and journal together. Groups advance one cumulative batch snapshot without duplicate unit counts.
  - [x] Bounded sealing/restart/response-loss recovery returns original complete typed receipts. Current read authority/principal can recover committed results without write escalation; imported receipt/audit records receive normal domain checks.
  - [x] Record hashes, exact actual chain membership, source/resource references and indexed lifecycle/review evidence feed frozen constructors. Forged validation without submission and an older unresolved contest refuse the entire unit.
  - [x] Export captures actual committed roots/heads/version and excludes pending/newer writes; opaque HMAC continuations bind owner/incarnation/selection/root/position. Missing bytes report explicit incomplete/denied outcomes.
  - [x] Full canonical pages and whole-fragment pages preserve count/byte envelopes; only the verified terminal proves completeness. Personal lifecycle actor and restricted audit audiences remain enforced.
  - [x] Admission bounds segments/mentions/depth/targets/shapes separately from frozen capacity; shared aliases remain valid, cyclic/deep input refuses before canonical encoding.
  - [x] Independent PG stores round-trip 28 multibyte/escaped revisions above one MiB. Explicit mapped cross-scope copy preserves attribution/derivation audit; source retirement requires separate authority after destination receipt/readback.
  - [x] Files: `tests/comments-{fragment-vectors,import,import-fence,import-review,import-lifecycle,receipts,import-crashes,export,read-audience,transfer,long-history,admission}.spec.ts`; `docs/comments-annotations/contract/transport-v1.json`.
  - [x] Lot gate: same comments PG command as Lot 7; final combined comments gate 25 files / 104 tests PASS, including frozen C0/M1 and operational HTTP/namespace probes.

- [x] **Lot 9 — M2-W registration and canonical Hono API**
  - [x] Existing registry/catalog handles metadata-only local discovery, optional compatible peer preflight, typed lazy loading and disabled isolation. Root JS/declarations retain no comments/driver edge.
  - [x] Static local integration, `./comments/hono`, lazy loader and namespace composition are exported with packaged assets; exact frozen router-factory/store signatures are preserved.
  - [x] Operational annotation/thread/comment revisions use frozen constructors, actual root-member references, server registration, stable command replay and exact CAS.
  - [x] Native authorized reads/pages resolve actual indexed resource tuples, personal preferences and audit audiences. The private installed SPI enforces configured kernel page limits.
  - [x] HTTP checks injected authority/decision ports before and after pending writes inside `store.transaction().run`; installed services separately check final revocation/expiry/base/proposal bindings before publication.
  - [x] Strict streamed actual UTF-8 request and measured response limits, reserved collection paths and closed wire errors; no raw append or physical-completion route.
  - [x] Full-runtime namespace derives issued scope only from the verified invocation; principal/workspace/generation/lifetime mismatches and forged body scope refuse before effects.
  - [x] Files: `tests/comments-{module,router,namespace,single-session}.spec.ts`; existing `tests/modules/{registry,capabilities,namespace-loading,topology,topology-ranges}.spec.ts` and `tests/conformance/h2a-contract.spec.ts`.
  - [x] Lot 1 source gate and Lot 7 real-PG gate PASS; actual installed registry/full-runtime HTTP is qualified again in Lot N.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Both storage/comments evolution specifications describe the shared root, host-owned PG installation, trusted bounded module SPI, candidate APIs and remaining separate scopes.
  - [x] `docs/comments-annotations/contract/storage-compatibility.md`, literal `transport-v1.json`, `evidence/index.md`, `evidence/installed-module.md` and `immo-host-guide.md` identify exact calls, archive/lock/audit and source/installed boundaries.
  - [x] BRCM2-EX6 shipped package README documents selected exports/peer/context/migration/transport composition; packed inventory now explicitly includes the ninth local comments leaf.
  - [x] Documentary C0 assertions follow the executable packaged-oracle proof while preserving absent M1 public conformance export. Historical review provenance is unchanged.

- [ ] **Lot N — Final validation**
  - [x] CI's 5-second source long-history probe expired while executing 28 source publications. Kept the same timeout and >1-MiB/multibyte/three-plus-fragment/terminal/full-readback assertions, using 14 larger revisions (each body remains below 64 KiB); scoped real-PG probe PASS in 1.97 seconds. The separate installed 28-revision proof remains unchanged.
  - [x] CI run 39024243221 at 383d48f24 passed API typecheck, image and toolbox builds after EX8 added comments prerequisites and corrected Docker peer ordering; no application runtime code changes.
  - [x] CI run 39023730235 exposed the stale exact peer-tuple assertion in `publishable-ci-wiring.test.mjs`; reproduced locally and updated its shared candidate/post-publication/bootstrap expectation with comments@0.3.0. Both `test-publishable-manifests` and `test-qualify-published-install` now PASS (BRCM2-EX7; RTK `10f2a27c5493`).
  - [x] Typecheck/lint PASS; source package suite 93 files / 805 tests PASS, 48 files / 106 explicit PG/crash/installed tests skipped only here and qualified separately below (RTK `24fdf710d026`).
  - [x] Real neutral PG 26 files / 47 tests PASS; real comments PG 25 files / 104 tests PASS; both independent server-SIGKILL phases PASS (RTK `e23b89c8a2b4`).
  - [x] Existing packed lazy/types/bundlers/consumer-topology matrix 10 files / 63 tests PASS (RTK `0bb04bd0b972`).
  - [x] Built/packed final archive SHA-256 `80df0a45f34fb2b4ea28103d497a9fa596aea9712c4ac9fcf67c35a65d9f1596`; archive identity and consumer lock/SRI are pinned in `evidence/installed-module.md`.
  - [x] Installed unchanged M1 corpus/all-kind vectors, single-session transactions, independent 1,592,112-byte history/four fragments/ten bounded seal calls, original receipt/read-only recovery, current revocation, full-runtime HTTP and actual purge PASS; ordinary hidden-preparation command sample 8.1 ms.
  - [x] Clean bare/disabled/missing-peer isolation and every exported-leaf import PASS with the exact selected peers. Actual consumer production lock/tree/audit retained; zero vulnerabilities.
  - [x] CI repeats real PG/crash/installed qualification and retains reports, using the manifest guard's exact output archive. It builds the unchanged workspace peer before root prerequisites relink it. No runtime import uses checkout adapters or a host driver dependency.
  - [x] Version 0.19.0 rechecked above public npm and remote main 0.16.0; PR #679's 0.18.0 ordering retained. No rebase occurred during this relaunch.
  - [x] Mechanical branch C1 and whole-branch scope C2 PASS; `git diff --check` PASS; frozen comments M1, Compose, application source/schema/routes and live-generation paths unchanged. EX8 changes only root Make prerequisites and an existing Docker build order; linear history has zero merge commits.
  - [x] Isolated PostgreSQL/network/volume removed; `make down ps API_PORT=9620 UI_PORT=5820 MAILDEV_UI_PORT=1720 ENV=test-cm-comments-m2` confirms no remaining branch Compose service.
  - [x] API/UI/E2E source/tests unchanged; EX8's build definitions are validated through cold API typecheck/image CI. Package-local source/PG/installed acceptance completes synthetic host UAT. Actual Immo data/cutover and delivery remain host/owner work.
  - [x] Final gate step 1: draft PR #684 uses this exact BRANCH.md body; the consolidated linear branch is pushed and supersession links from #666/#669/#670/#671/#667 are preserved. Subsequent corrections refresh the same PR/body.
  - [ ] Final gate step 2: verify completed CI on the pushed candidate and resolve any failure; record the final run/result in `.h2a/build/cm_comments_m2_report.md`.
  - [ ] Final gate step 3: storage co-owner review, BRANCH.md removal, merge/publication and actual delivery remain owner actions. This builder stops after its final validation/handoff and never performs them.
