# Branch: feat/cluster-mesh-engram-e7 — Host memory and maintenance bindings (lot E7)

## Objective

E7 after E3/E5/E6: host-owned memory bindings in `src/engram-memory/{binding,postgres,host-maintenance}.ts` with public host assembly and fixtures. Inject the host-owned PG driver/pool; Engram receives exactly `['read','write']`, while a distinct host-issued `maintain` grant/binding owns fence access/checks, consumer checkpoint/poison/retry, resync and snapshot maintenance. Provide the durable ledger, the continuation grant and proof-only recovery required by the E8 answers (gr-conductor). Base: E5 (`origin/feat/cluster-mesh-engram-e5` @ `b982026cd`) merged with E6 (`origin/feat/cluster-mesh-engram-e6` @ `9b476e20d`); merge commits only. Pack-only `0.23.0-dev.9`. Engram stays `0.21.1`; P3 manifest unchanged (STOP if a change would alter it).

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
  - `packages/cluster-mesh/src/engram-memory/binding.ts` (new: public host assembly, Engram `['read','write']` handle only)
  - `packages/cluster-mesh/src/engram-memory/postgres.ts` (extend: host PG driver/pool injection, identity/qualification checks)
  - `packages/cluster-mesh/src/engram-memory/host-maintenance.ts` (new: host-only fence/checkpoint/poison/retry/resync/snapshot ports)
  - `packages/cluster-mesh/src/engram-memory/ledger.ts` (new only if the durable host-evidence ledger cannot live in host-maintenance.ts; smallest file that holds)
  - `packages/cluster-mesh/tests/engram-memory/postgres-driver-injection.spec.ts` (new: positive installed driver calls, missing/weak driver refusal, no fallback)
  - `packages/cluster-mesh/tests/engram-memory/host-maintenance-binding.spec.ts` (new: host-only checkpoint/resync/snapshot/fence; runtime/type denial through the memory handle; revoked/foreign maintain refusal)
  - `packages/cluster-mesh/tests/engram-memory/binding-compatibility.spec.ts` (extend: Engram handle stays `['read','write']`)
  - `packages/cluster-mesh/tests/engram-memory/binding-errors.spec.ts` (extend: typed host-seam failures)
  - `packages/cluster-mesh/tests/engram-memory/pg-host.ts` (extend fixture only: host assembly + maintenance authority)
  - `packages/cluster-mesh/tests/engram-memory/host-type-denial.spec.ts` (new: typechecked type-denial cases, one intended error each; BR7-E7A)
  - `packages/cluster-mesh/vitest.config.ts` (extend: vitest `typecheck.include` scoped to the E7 denial spec only; BR7-E7A)
  - `packages/cluster-mesh/tsconfig.test.json` (extend: include the E7 denial spec in the dedicated test tsconfig; BR7-E7A)
  - `packages/cluster-mesh/assets/storage/postgres/engram-memory/manifest.json` (extend: register the E7 002 host-ledger asset; BR7-EX3; E2 owns migration content, E7 registers its own asset row)
  - `packages/cluster-mesh/tests/engram-memory/postgres-registration.spec.ts` (extend: pin the memory chain tail at 002 instead of 001; BR7-E7B — intent unchanged, two tail assertions only)
  - `packages/cluster-mesh/tests/storage/installed-bare.mjs` + `packages/cluster-mesh/tests/storage/pack-only-dev-gate.mjs` (new, test-only) + `packages/cluster-mesh/tests/storage/pack-only-dev-gate.spec.ts` (new, test-only) + `packages/cluster-mesh/tests/storage/postgres.mk` (extend: CM_PACK_ONLY_PIN wiring only; BR7-E7D — adopts the #774 gate verbatim, product code untouched)
  - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.9 only)
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
  - [x] BR7-E7A: r2 P1-A wires the E7 type-denial spec into the typecheck (vitest `typecheck.include` scoped to that spec + `tsconfig.test.json` include). No other suite is typechecked; Makefile/CI wiring unchanged. Rollback: revert the three annotated lines.
  - [x] BR7-E7B: r2 P1-E registers 002 in the memory manifest; the inherited tail pins move 001→002 (two assertions, intent unchanged). Rollback: revert the manifest entry and the two pins.
  - [x] BR7-EX3: P1-5 activates the conditional `002-*.sql` path — new file `assets/storage/postgres/engram-memory/002-host-ledger.sql` (sha256 `e4dc0805…63d6d9b`, memory-only `memory_host_ledger` table, requires 001) authored by E7; `migrations.ts` untouched; r2 P1-E registers the row in `engram-memory/manifest.json` (see BR7-E7B). Rollback: delete the 002 file and the manifest row.
  - [x] BR7-E7D: r6 CI comments gate — adopts the #774 `pack-only-dev-gate` (exact pair cluster-mesh + `<reservedNext>-dev.N`, `incompatible_version` accepted only then) verbatim in `tests/storage/` + `CM_PACK_ONLY_PIN` wiring in `postgres.mk`; reverts the r5 range widening and semver rule so the #767 refusal contract stands unchanged. Test-only, no product code. Rollback: revert the four annotated files.
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

- [x] Lot E7-0 — setup: worktree `tmp/worktrees/mem-e7`, branch `feat/cluster-mesh-engram-e7`; merge E6 into E5 base (merge commit); this BRANCH.md; pack-only `0.23.0-dev.9`; draft PR to `feat/engram-e2-integration`.
- [x] Lot E7-1 — tests first: `postgres-driver-injection.spec.ts` (4 passed, 0 todo: provider required, identity/floor, positive installed calls, no-fallback with usable pool); `host-maintenance-binding.spec.ts` (12 passed, 7 todo: assembly, neutral-handle denial, fail-closed ports, ledger/continuation/proof-only); extended binding-compatibility (handle pinned) + `pg-host.ts` (`memoryHostComposed`). `binding-errors` (G1-sqlite-scoped) untouched: E7 typed failures live in the E7 specs, no duplication.
- [x] Lot E7-2 — implementation: `binding.ts` assembly + continuation grants; PG provider check in `postgres.ts`; `host-maintenance.ts` fail-closed ports; `ledger.ts` (record/read/continuation/terminal/proof-only) per E8 answers; no `maintain` escape. Durable PG backing deferred to the conditional 002 asset (needs E2-writer coordination).
- [ ] Lot E7-3 — gates: engram-memory lanes + PG storage lanes green on `ENV=test-e2-int`; typecheck green; lint green; scope-check; `make commit` per file group (<150 lines); push; draft PR; CI green; no merge.

## Feedback Loop

- Blocker: if E2/E3/E6 move under this branch (new migration writer, changed `migrations.ts`, moved `scope.ts` hooks), stop and coordinate — do not renumber or rewire around them.
- Base refs: E5 `8bad820e9` (E5-1/E5-2 done, E5-3 CI pending on #787 for structural E2-base reasons, not code); E6 `9b476e20d` (projection/resync, memory PG assets, `postgres-memory.spec.ts` in the E2 real-PG lane).
- Pack-only `0.23.0-dev.9` resolves the merge conflict (E5 `dev.8` vs E6 `dev.5`); version fields only, rollback both fields together. Known dev-bump gate friction (release-only `satisfiesRange`) tolerated until #774, as in E5/E6.
- Engram 0.21.1 DTOs frozen; memory files unchanged at 0.21.2, so the E8 answers hold.
- E7 gate = engram-memory lanes + PG storage lanes green (E9 runs the five-profile acceptance later, not here).
- AI CI job red-on-main is out of scope for this lot's gate.
- Slices landed: PG provider check, host assembly, fail-closed maintenance ports, ledger + continuation + proof-only, positive host calls through the injected pool, neutral-handle denial; binding-compatibility pinned.
- E7 receipts (ENV=test-e2-int, CM_PG_URL=postgresql://app:app@postgres:5432/app, head `3cadffdc4`): `SCOPE=tests/engram-memory` 18 files 133 passed, Type Errors none; `SCOPE=tests/storage` 78 passed | 1 skipped files, 502 passed | 4 skipped; typecheck/lint exit 0; scope-check PASS C2. R2 P1-A–E implemented; CI run pending on the head.
