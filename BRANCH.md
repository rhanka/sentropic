# Feature: Durable memory acceptance (E9)

## Objective

- [ ] Qualify approved plan row E9 through the shipped E7 bindings; current status `blocked: E7-fenced-writers`. Worktree `tmp/worktrees/mem-e9`, branch `feat/cluster-mesh-engram-e9`, draft PR targeting `feat/engram-e2-integration`.
- [ ] Run real PostgreSQL memory Stage B through installed Engram 0.21.1, its exact `['read','write']` binding and E7's separate host maintenance binding. Host snapshot/journal reads are `blocked: E7`. Pack-only reservation `0.23.0-dev.10`; P3 re-pin and CI PG wiring belong to the integration lane.

## Scope / Guardrails

- MUST reuse the neutral memory contract and `CanonicalOwnershipError` codes (frozen files, import only). NO new ownership contract, NO second PG ownership contract.
- Production scope: `src/engram-memory/{binding,postgres,host-maintenance}.ts` only (postgres.ts: host driver/pool injection; binding.ts: public host assembly; host-maintenance.ts: host-only maintenance ports). Neither the `maintain` grant nor the maintenance ports escape through Engram's neutral `['read','write']` handle (runtime/type denial).
- E8-answers obligations: durable host-issued evidence (candidate→store/scope/invocation-or-continuation mapping, envelope binding, reservation/terminal/ambiguous state, receipt/cursor reconciliation); continuation grant needs fresh host authn/authz checked against retained authority (copied fields never grant); proof-only recovery path (authorized capture-proof reads, admission-outcome recovery, journal replay) that refuses unknown/foreign access and any second effect. Refusing on an empty ledger is correct until rehydration.
- Existing `binding-compatibility`/`binding-errors` keep passing; shared corpus semantics unchanged (additive cases only).
- Tests first; `ENV=test-e2-int` as the last make argument; `make commit MSG="type: …"` (<150 lines, `git add` specific files, no AI trailers). Never `ENV=dev`. 0 Python.
- Disk is tight: reuse `ENV=test-e2-int` images; `make down ENV=test-e2-int` only if this session owns the compose project.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/tests/engram-memory/memory-corpus.ts`
  - `packages/cluster-mesh/tests/engram-memory/memory-*.ts`
  - `packages/cluster-mesh/tests/engram-memory/memory-*.mjs`
  - `packages/cluster-mesh/tests/engram-memory/durable-memory.spec.ts`
  - `packages/cluster-mesh/tests/engram-memory/qualification.mk`
  - `packages/cluster-mesh/tests/engram-memory/candidate-scope.spec.ts` (inherited E8)
  - `packages/cluster-mesh/tests/engram-memory/host-scope-binding.ts` (inherited E8)
  - `packages/cluster-mesh/tests/engram-memory/scope.spec.ts` (inherited E8)
  - `packages/cluster-mesh/tests/storage/postgres-memory.spec.ts`
  - `packages/cluster-mesh/src/engram-memory/binding.ts` (new: public host assembly, Engram `['read','write']` handle only)
  - `packages/cluster-mesh/src/engram-memory/postgres.ts` (extend: host PG driver/pool injection, identity/qualification checks)
  - `packages/cluster-mesh/src/engram-memory/host-maintenance.ts` (new: host-only fence/checkpoint/poison/retry/resync/snapshot ports)
  - `packages/cluster-mesh/src/engram-memory/ledger.ts` (new only if the durable host-evidence ledger cannot live in host-maintenance.ts; smallest file that holds)
  - `packages/cluster-mesh/tests/engram-memory/postgres-driver-injection.spec.ts` (new: positive installed driver calls, missing/weak driver refusal, no fallback)
  - `packages/cluster-mesh/tests/engram-memory/host-maintenance-binding.spec.ts` (new: host-only checkpoint/resync/snapshot/fence; runtime/type denial through the memory handle; revoked/foreign maintain refusal)
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts` (extend: Engram handle stays `['read','write']`)
  - `packages/cluster-mesh/tests/engram-memory/binding-errors.spec.ts` (extend: typed host-seam failures)
  - `packages/cluster-mesh/tests/engram-memory/pg-host.ts` (extend fixture only: host assembly + maintenance authority)
  - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.10 only)
  - `packages/cluster-mesh/assets/storage/engram-memory/C6-FREEZE.md` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-asset-inventory.json` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/engram-memory/neutral-equivalence.json` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/postgres/007-consumed-counters.sql` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/postgres/008-instance-ownership.sql` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/001-projections.sql` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/engram-memory/commit-result-recovery.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/engram-memory/contract.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/engram-memory/neutral-contract.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/engram-memory/postgres-queries.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/engram-memory/projection.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/atomic.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/backend.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/contracts.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/codec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/commit-results.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/core.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/effects.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/installed.ts` (BR9-EX3 exact memory chain count adaptation)
  - `packages/cluster-mesh/src/storage/postgres/manifests.ts` (BR9-EX3 exact memory chain count adaptation)
  - `packages/cluster-mesh/src/storage/postgres/errors.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/index.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/instance-guard.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/instance-ownership.ts` (inherited E1 bytes only, E7 untouched; BR7-EX2)
  - `packages/cluster-mesh/src/storage/instance-ownership.ts` (inherited E1 bytes only, E7 untouched; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/journal.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/migrations.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/protocol.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/queries.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/readers.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/roots.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/scope.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/snapshots.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/postgres/transactions.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/src/storage/u64.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/comments-fragment-vectors.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/engram-memory/contract-vectors.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/engram-memory/neutral-contract-types.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/engram-memory/postgres-registration.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/engram-memory/projection.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/engram-memory/queries.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/fixtures/reserved-versions.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/modules/registry.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/packaging/prepare-artifacts.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/atomic-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/chain-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/commit-result-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/commit-result-process.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/common-rule/contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/common-rule/vectors.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/instance-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/pg-open-child.mjs` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-authority.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-crashes.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-instance-admission.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-instance-guard.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-instance-multiprocess.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-instance-ownership.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-memory.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-replay.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-result-recovery.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-transactions.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/postgres-u64.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/read-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/representation-contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/u64-contract.spec.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `packages/cluster-mesh/tests/storage/u64-corpus.ts` (inherited base lots E0-E6 only; BR7-EX2)
  - `PLAN.md` (inherited base lots E0-E6 only; BR7-EX2)
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json` (inherited base lots E0-E6 only; BR7-EX2)
  - `tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json.sha256` (inherited base lots E0-E6 only; BR7-EX2)
- **Exception process**:
  - [x] BR7-EX2: r1 qualification scope — the stacked diff base...HEAD carries 76 unknown paths plus the frozen `instance-ownership.ts` files (inherited bytes) from base lots E0-E6; E7 authors none of them. Docs-only declaration, no implementation authorized. Rollback: drop these annotation lines.
  - [x] BR7-EX3: P1-5 activates the conditional `002-*.sql` path — new file `assets/storage/postgres/engram-memory/002-host-ledger.sql` (sha256 `e4dc0805…63d6d9b`, memory-only `memory_host_ledger` table, requires 001) authored by E7; `migrations.ts` untouched and `engram-memory/manifest.json` registration deferred to E2-writer coordination (E2 owns the migration single-writer; the P1-5 test applies the asset SQL directly). Rollback: delete the 002 file.
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `packages/engram/**` (stays 0.21.1)
  - `packages/cluster-mesh/src/storage/instance-ownership.ts` (frozen, reuse only)
  - `packages/cluster-mesh/src/storage/sqlite/**`
  - `packages/cluster-mesh/assets/storage/postgres/001-008*.sql` (published, byte-identical)
  - `packages/cluster-mesh/assets/storage/engram-memory/001-projections.sql` (E6, byte-identical)
  - Any second ownership contract or artifacts-coordinator reuse.
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/002-*.sql` (new memory-only ledger asset ONLY if host-evidence durability needs it; E2 owns `migrations.ts` single-writer — STOP and coordinate before touching it).

## Plan / Todo (lot-based)

- [x] Lot E9-0 — read approved plan and binding sections 7–10; mechanically check branch; merge E8 into E7; retain inherited scope declarations; freeze Engram/P3 bytes.
- [x] Lot E9-1a — initial tests first: `memory-corpus.ts`, `durable-memory.spec.ts`; real PostgreSQL required, initial run fails because the campaign fixture is not implemented yet. This is a scaffolding failure, not an invariant proof.
- [x] Lot E9-1b — complete explicit profile/case inventory, zero skip/todo; failure controls assert the intended invariant.
- [x] Lot E9-2 — PostgreSQL fixture: `memory-pg-host.ts`, `memory-neutral.ts`; neutral wire translation, real transactions and queries, separate host maintenance runner, injected driver, installed constructor and E8 candidate liaison.
  - [x] Neutral transaction and query wire bridge preserves JSON values and exact decimal counters; kernel-backed commit identity index, no replay cache.
  - [x] Initial real-PG fixture opens installed Engram 0.21.1 with exact read/write and durable canonical ownership. First execution exposes a real capture-proof wire-shape mismatch in the installed validator; no bytes rewritten by the bridge.
- [x] Lot E9-3 — Stage B: capture/completion/admission/read, immutable proofs after destruction/replay, bounded snapshots/outbox, checkpoint/resync/fence/poison/retry, original receipts after crash/reopen, u64 crossings/exhaustion, G3 ownership, C4 recovery and C7 scope refusals.
  - [x] Initial five-case real-PG run passes after the two evidenced wire fixes; add engine acceptance/rejection traces through E8's authoritative candidate liaison and actual key destruction.
  - [x] Engine traces pass (7/7); add host checkpoint/resync/snapshot and poison/retry with independent maintain checks, plus host read/maintain grant without write. No read/write/maintain grant enters the campaign.
  - [x] Host maintenance positive cases pass (9/9); add independent-process contention and real SIGKILL before/after COMMIT, own peer TCP pool and elapsed durable lease, original-result lookup in a new epoch.
  - [x] Actual SIGKILL paths and process contention execute; correct two test-carrier errors (canonical source sequence and frozen `created_cursor` name). Add C5 sparse high-water cases at safe/signed/u64 boundaries through the same neutral PG handle.
  - [x] Add same-handle second constructor, durable store/scope binding and independent memory-token revocation cases before changing acquisition behavior.
  - [x] Resume: 20 real-PG cases pass at `1b8b36290`; add bounded accepted snapshot/outbox and a deferred-COMMIT rollback probe. Snapshot assertions retain the historical document set and eligibility digest; the observation cursor follows the current head under frozen Engram semantics.
  - [x] Bounded reads and SQL-trigger rollback pass (23/23 at `422ac36c3`); complete inventory enforcement, engine proof-only replay after destruction/reopen, terminal-loss discrimination and runtime/migration facts.
  - [x] Test-first expansion: 170/173 pass (18 memory files, zero skipped). Three deliberate new failures expose missing terminal-authority rehydration in the campaign liaison and foreign-scope lookup refusal precedence. Wire E7's existing durable ledger and bind-scope checks in the fixture; frozen Engram/P3 stay unchanged.
  - [x] Fixture correction: apply E7's unchanged 002 ledger asset directly (as its existing tests do), retain seal/admission evidence through its PG API, and authorize terminal proof recovery only against current host authority plus the retained store/scope/principal/invocation. Explicitly reject foreign neutral grants before fence lookup.
  - [x] All 18 memory files pass: 173/173, zero skipped/todo, including 24 Stage B cases. Profile counts: atomic 8, chains 3, boundaries 3, outbox 3, fenced writers 6; one additional inventory case. Runtime: Node 24.21.0 x64, PostgreSQL 17.11, serializable and synchronous_commit=on. Fix the lint-reported extra assertion in fixture cleanup before final quality gates.
- [x] Lot E9-4 — `test-cluster-mesh` scoped memory and PostgreSQL lanes; typecheck/lint; mechanical scope gate before each `make commit`; every authored commit under 150 lines; no AI trailers.
- [x] Final build exits 0; retained Stage B at `c5ef55b64` passes 24/24 with zero skip/todo. Campaign and cleanup both exit 0; log SHA-256 `9dbc013e793f3c4e829cf16e4431676f3dd5960e9ad975b3ceec3aa725f2c5f1` in `tmp/memory-stage-b/`. The final report-only commit changes no tested package bytes.
- [x] Lot E9-5 — retain campaign facts and counts per profile; push retry every ten minutes until successful; draft PR from this file; record CI; do not merge or publish.
  - [x] Author source `68783a1f6`: memory 18 files / 173 passed; Stage B 24 passed / zero skip/todo. Atomic 8, immutable chains 3, immutable boundaries 3, scope outbox 3, fenced writers 6, plus inventory 1.
  - [x] Supplementary storage regressions: 78 passing files / 502 passed; `postgres-crashes.spec.ts` has 4 phase-selected server-crash tests outside this invocation. E9's separate SIGKILL-before/after-COMMIT cases both execute and pass; no E9 case is skipped.
  - [x] `make typecheck-cluster-mesh lint-cluster-mesh ENV=test-e2-int` exits 0; local and E7-base stacked mechanical scope both PASS C2. Every E9 author commit is below 150 changed lines.
  - [x] Retained logs/status/hashes: `tmp/memory-e9-receipts/`; runtime Node 24.21.0 x64 and PostgreSQL 17.11, serializable transactions, synchronous_commit=on. Compose PG data is tmpfs: this campaign proves process death/reopen, not host power-loss durability. Native backend and Engram semantic profile digests are retained separately.
  - [x] Reproduce: `make -f Makefile -f packages/cluster-mesh/tests/engram-memory/qualification.mk memory-stage-b ENV=test-e2-int`. This target takes the shared lock, starts only existing Compose PostgreSQL, retains source/log hashes, then tears down the owned stack and releases the lock on success or failure.
  - [x] Engram remains pinned to 0.21.1; pack-only mesh version 0.23.0-dev.10; no P3/candidate edits. The inherited pre-candidate bytes are unchanged from E7 (`2b85ff28b6fe06bda0abcdc19255f61a1ed1e4b7cfbb40c2e881c98dd234424b`); they are historical bytes, not a newly generated P3 claim. The externally frozen candidate remains `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10`.
  - [x] Push succeeds at 08:26 UTC after ten-minute retries; remote author head `e6495b6799887da41a7057adcee01366c7185a44` verified by `git ls-remote`. Draft [PR #790](https://github.com/rhanka/sentropic/pull/790) targets `feat/engram-e2-integration`, mergeable=true. [CI 40473787086](https://github.com/rhanka/sentropic/actions/runs/40473787086) is queued on that head; no CI-green claim, merge, publication, consensus review or E10 installed mesh-tarball qualification is made by this author report.

## Orchestration Mode (AI-selected)

- [x] Mono-branch: one E9 author, merge-only integration, no delegated implementation.

## UAT Management (in orchestration context)

- [x] Library-only work; no application, browser, Chrome or VSCode changes or interactive UAT.
- [x] Reuse existing `ENV=test-e2-int` PostgreSQL stack and pinned Node 24 image; no image build. Docker lock held only while campaign commands run and released between steps.
- [x] Never tear down a shared stack owned by another session. Test schemas are private and removed by their fixtures.

## Feedback Loop

- [x] r1 corpus disposition: preserve all 23 behavioral cases and the inventory case; every behavioral case depends on the fixture handle and is explicitly `blocked: E7-fenced-writers`. The three host maintenance cases additionally carry `blocked: E7` for snapshot/journal reads. Skips represent unmet source dependencies, never accepted profile evidence; the zero-skip qualification gate remains open.
- [x] P2-2: remove the fixture-issued `memory-host-reader` token entirely. Snapshot and journal reads bind only `binding.maintainGrant`; current E7 cannot authorize those reads. Retain the positive corpus and extend its revoked-authority probe to journal replay; enable it only against E7's shipped host assembly.
- [x] r1 receipt guard: refuse any dirty tree, record exact HEAD/tree, verify both remain unchanged after the campaign, and fail qualification if the inventory reports blocked cases. A successful inventory check cannot turn the 23 blocked scenarios into accepted evidence.
- [ ] Integration rerun: after the separate CI PG/P3 lane lands and the conductor integrates E9, rerun the same corpus on the clean committed integration head. E7 fenced-writer and host-read blockers remain open until its shipped bindings are wired; no implementation is authorized here.
- [x] r1 disposition supersedes the historical campaign completion claims above: fixture semantics do not qualify the shipped host assembly; no five-profile or `fenced-writers-v1` qualification is claimed.
- [x] P2-1 reproduced and corrected for the historical tree: clean committed `02c626ca471ac5d051cda9eee991ff16bcc28ab8`, memory 18 files / 173 passed, zero skip/todo; `exit=0 cleanup=0`. Receipt `tmp/memory-e9-r1/committed-173/`, campaign SHA-256 `33e39849eca323a2dc9072c243763305f05e1846bb6a0d42e16a1d83545b85d8`; this is not a receipt for subsequent revisions.
- [x] BR9-EX1 reverted in r1: `postgres.ts` restored to E7 `ee654ace2`; E6 owner suggestion: validate frozen Engram snake-case K7/K8 proofs without rewriting stored bytes, retaining first-proof immutability. Verification: real-PG installed capture/completion/admission/replay.
- [x] BR9-EX2 reverted in r1: `projection.ts` restored to E7 `ee654ace2` (including the E9 ordinal adaptation); E6 owner suggestion: derive journal intent metadata from the frozen event payload, whose DTO lacks `intent_hash`. Verification: real-PG capture and conflicting/original replay. Both suggestions delivered to `s-conductor` via h2a.
- [x] BR9-EX3 reverted in r1: E9 changes in `postgres/{effects,manifests,readers,scope}.ts` restored to E7 `ee654ace2`; no E9 production diff remains. E2 owner suggestion: exact-u64 chain count/position allocation and reads, checked exhaustion, with all three C5 real-PG crossings as acceptance. Delivered to `s-conductor` via h2a.
- [x] E2 constraint: `chainRecordKey` pads to 16 digits while u64 positions reach 20; exact-key lookup only above 10^16, no lexical/range ordering assumption. Owner decides representation; E9 does not change it.
- Blocker: if E2/E3/E6 move under this branch (new migration writer, changed `migrations.ts`, moved `scope.ts` hooks), stop and coordinate — do not renumber or rewire around them.
- Base refs: E5 `8bad820e9` (E5-1/E5-2 done, E5-3 CI pending on #787 for structural E2-base reasons, not code); E6 `9b476e20d` (projection/resync, memory PG assets, `postgres-memory.spec.ts` in the E2 real-PG lane).
- Pack-only `0.23.0-dev.9` resolves the merge conflict (E5 `dev.8` vs E6 `dev.5`); version fields only, rollback both fields together. Known dev-bump gate friction (release-only `satisfiesRange`) tolerated until #774, as in E5/E6.
- Engram 0.21.1 DTOs frozen; memory files unchanged at 0.21.2, so the E8 answers hold.
- E7 gate = engram-memory lanes + PG storage lanes green (E9 runs the five-profile acceptance later, not here).
- AI CI job red-on-main is out of scope for this lot's gate.
- Slices landed: PG provider check, host assembly, fail-closed maintenance ports, ledger + continuation + proof-only, positive host calls through the injected pool, neutral-handle denial; binding-compatibility pinned.
- E7 receipts (ENV=test-e2-int, CM_PG_URL=postgresql://app:app@postgres:5432/app, head `aba2cbb97`): `SCOPE=tests/engram-memory` 16 files 122 passed, 0 todo; `SCOPE=tests/storage` 78 passed | 1 skipped files, 502 passed | 4 skipped; typecheck/lint exit 0; scope-check PASS C2. CI rerun pending.
