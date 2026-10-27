# Feature: Durable memory acceptance (E9)

## Objective

- [x] Qualify approved plan row E9 after local E7 `ee654ace2` and E8 `4eaeacd85`, using merge commits only. Worktree `tmp/worktrees/mem-e9`, branch `feat/cluster-mesh-engram-e9`, draft PR targeting `feat/engram-e2-integration`.
- [x] Run real PostgreSQL memory Stage B through installed Engram 0.21.1, its exact `['read','write']` binding and E7's separate host maintenance binding. Pack-only reservation `0.23.0-dev.10`; P3 and candidate archive `26a0edd50c338f30593d22ae1f06ac13d82f5557f18558750659bcfefec64c10` stay frozen.

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
- [ ] Lot E9-1b — complete explicit profile/case inventory, zero skip/todo; failure controls assert the intended invariant.
- [ ] Lot E9-2 — PostgreSQL fixture: `memory-pg-host.ts`, `memory-neutral.ts`; neutral wire translation, real transactions and queries, separate host maintenance runner, injected driver, installed constructor and E8 candidate liaison.
- [ ] Lot E9-3 — Stage B: capture/completion/admission/read, immutable proofs after destruction/replay, bounded snapshots/outbox, checkpoint/resync/fence/poison/retry, original receipts after crash/reopen, u64 crossings/exhaustion, G3 ownership, C4 recovery and C7 scope refusals.
- [ ] Lot E9-4 — `test-cluster-mesh` scoped memory and PostgreSQL lanes; typecheck/lint; mechanical scope gate before each `make commit`; every authored commit under 150 lines; no AI trailers.
- [ ] Lot E9-5 — retain campaign facts and counts per profile; push retry every ten minutes until successful; draft PR from this file; record CI; do not merge or publish.

## Orchestration Mode (AI-selected)

- [x] Mono-branch: one E9 author, merge-only integration, no delegated implementation.

## UAT Management (in orchestration context)

- [x] Library-only work; no application, browser, Chrome or VSCode changes or interactive UAT.
- [x] Reuse existing `ENV=test-e2-int` PostgreSQL stack and pinned Node 24 image; no image build. Docker lock held only while campaign commands run and released between steps.
- [x] Never tear down a shared stack owned by another session. Test schemas are private and removed by their fixtures.

## Feedback Loop

- Blocker: if E2/E3/E6 move under this branch (new migration writer, changed `migrations.ts`, moved `scope.ts` hooks), stop and coordinate — do not renumber or rewire around them.
- Base refs: E5 `8bad820e9` (E5-1/E5-2 done, E5-3 CI pending on #787 for structural E2-base reasons, not code); E6 `9b476e20d` (projection/resync, memory PG assets, `postgres-memory.spec.ts` in the E2 real-PG lane).
- Pack-only `0.23.0-dev.9` resolves the merge conflict (E5 `dev.8` vs E6 `dev.5`); version fields only, rollback both fields together. Known dev-bump gate friction (release-only `satisfiesRange`) tolerated until #774, as in E5/E6.
- Engram 0.21.1 DTOs frozen; memory files unchanged at 0.21.2, so the E8 answers hold.
- E7 gate = engram-memory lanes + PG storage lanes green (E9 runs the five-profile acceptance later, not here).
- AI CI job red-on-main is out of scope for this lot's gate.
- Slices landed: PG provider check, host assembly, fail-closed maintenance ports, ledger + continuation + proof-only, positive host calls through the injected pool, neutral-handle denial; binding-compatibility pinned.
- E7 receipts (ENV=test-e2-int, CM_PG_URL=postgresql://app:app@postgres:5432/app, head `aba2cbb97`): `SCOPE=tests/engram-memory` 16 files 122 passed, 0 todo; `SCOPE=tests/storage` 78 passed | 1 skipped files, 502 passed | 4 skipped; typecheck/lint exit 0; scope-check PASS C2. CI rerun pending.
