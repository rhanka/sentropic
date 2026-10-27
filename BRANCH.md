# Branch: feat/cluster-mesh-engram-e5 — Continuous ownership through commit (lot E5)

## Objective

G-P1 integration: ownership stays validated continuously through the effective
COMMIT/ROLLBACK, not only before returning from the callback. Same neutral
`CanonicalInstanceOwnershipV1` contract and guards (frozen, reuse only);
terminal reader revocation; late-window revocation/loss refusal; nested
contributions; caught inner error poisoning; retry/replay; saved-reader
refusal; stale release never clears a successor (assert on the full row).
Base: E4 (`origin/feat/cluster-mesh-engram-e4` @ `2e929e103`) merged with E3
(`origin/feat/cluster-mesh-engram-e3` @ `6615fae07`); merge commits only.
Pack-only `0.23.0-dev.8`. Engram stays `0.21.1`; P3 manifest unchanged (STOP
if a change would alter it).

## Scope / Guardrails

- MUST reuse `CANONICAL_INSTANCE_OWNERSHIP_CONTRACT`, handles and
`CanonicalOwnershipError` codes from `src/storage/instance-ownership.ts`
(frozen file, import only). NO new ownership contract.
- Production scope: `postgres/{transactions,ordinary-transactions,core,scope}.ts`
plus `postgres/errors.ts` (r1 fix: COMMIT-time lease-trigger refusal P0001
maps to `terminal-loss`; no other classification change). No new SQL asset,
no manifest change, no 008/007 checksum change.
- Existing SQLite/Comments/E2/E3/E4 tests keep passing; shared corpus keeps
registry semantics identical (additive cases only).
- Tests first; `ENV=test-e2-int` as the last make argument; `make commit MSG="type: …"`
(<150 lines, `git add` specific files, no AI trailers). Never `ENV=dev`. 0 Python.
- Disk is tight: reuse `ENV=test-e2-int` images; `make down ENV=test-e2-int`
only if this session owns the compose project.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/postgres/transactions.ts` (G-P1: final validation through COMMIT/ROLLBACK; error passthrough, no ownership retry)
  - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (G-P1: post-hook contributor + ownership re-validation on the committing session; nested tx poisoning; replay)
  - `packages/cluster-mesh/src/storage/postgres/core.ts` (G-P1 wiring only: expose final validation on the committing session; no transaction rewiring beyond E5)
  - `packages/cluster-mesh/src/storage/postgres/scope.ts` (admission reads: saved-reader refusal; no new surface)
  - `packages/cluster-mesh/src/storage/postgres/errors.ts` (r1: deferred-trigger P0001 `instance lease not live` at COMMIT maps to `CanonicalOwnershipError('terminal-loss')`; nothing else reclassified)
  - `packages/cluster-mesh/tests/storage/postgres-instance-guard.spec.ts` (r1: trigger-backstop test aligned to the terminal-loss contract)
  - `packages/cluster-mesh/tests/storage/postgres-instance-admission.spec.ts` (new: continuous ownership admission through real commits)
  - `packages/cluster-mesh/tests/storage/instance-corpus.ts` (additive case: stale release cannot clear its successor)
  - `packages/cluster-mesh/tests/storage/postgres-authority.spec.ts` (extend: late-window grant revocation/loss)
  - `packages/cluster-mesh/tests/storage/postgres-transactions.spec.ts` (extend: waits, nested contributions, caught inner error poisoning, retry/replay)
  - `packages/cluster-mesh/tests/storage/postgres-crashes.spec.ts` (extend: crash + ownership continuity, retry after SIGKILL)
  - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.8 only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `packages/engram/**` (stays 0.21.1)
  - `packages/cluster-mesh/src/storage/instance-ownership.ts` (frozen, reuse only)
  - `packages/cluster-mesh/src/storage/sqlite/**`
  - Any second ownership contract or artifacts-coordinator reuse.
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None. If the neutral contract needs a change (epoch domain note), STOP and coordinate instead of inventing a PG contract.

## Plan / Todo (lot-based)

- [x] Lot E5-0 — setup: worktree `tmp/worktrees/mem-e5`, branch `feat/cluster-mesh-engram-e5`; merge E3 into E4 base (merge commit); this BRANCH.md; pack-only `0.23.0-dev.8`; draft PR to `feat/engram-e2-integration`.
- [x] Lot E5-1 — tests first (red): new `postgres-instance-admission.spec.ts` (9 tests: live admission, late takeover, saved-reader refusal, in-commit takeover lockout, stale release vs successor/missing row with full-row readback, lock-timeout retry, in-window revoke ordering, COMMIT-time lapse refusal, taken-over non-released release no-op); corpus case `stale release cannot clear its successor`; authority/transactions/crashes extensions.
- [x] Lot E5-2 — implementation (green): E4 lock + deferred trigger as the final validation (no extra post-hook pass: the guard renews before the caller hook, the COMMIT itself validates via the trigger); E5 `withPgTxTimeouts` bounds wrapper pre-work; COMMIT-time trigger refusal maps to `terminal-loss`; release bypasses renewal (predicate-guarded no-op); no new SQL; neutral contract untouched.
- [ ] Lot E5-3 — gates: full `test-cluster-mesh SCOPE=tests/storage` green on `ENV=test-e2-int`; typecheck green; lint green; scope-check; `make commit` per file group (<150 lines); push; draft PR; CI green; no merge.

## Feedback Loop

- Blocker: if E2/E3 move under this branch (new 008 occupant, changed scope.ts hooks), stop and coordinate — do not renumber or rewire around them.
- E4 baseline: opt-in retained lease + G-P0b hook run before the caller hook on the committing session; COMMIT-time races map to `instance-busy`; open-time refusal is `open-refused`.
- Delivered E5 design (differs from the first E5-2 draft, recorded here): no extra post-hook re-validation pass. Final validation IS the COMMIT: the E4 row lock (renewal UPDATE holds it to COMMIT) blocks takeover/revoke in-window, the deferred trigger re-checks liveness at COMMIT, and the trigger refusal maps to `terminal-loss`. E5 adds bounded wait timeouts so the pre-work cannot hang.
- Late windows are hook-driven in tests (custom `onCommitPossession` on another connection), armed to the data commit only. The single bounded post-renewal lapse sleep (1000 ms lease / 2500 ms sleep) resolves one way only (the trigger fires at COMMIT): no lease-timing races.
- r1 fixes: P2-1 in-window revoke ordering + COMMIT lapse mapped to `terminal-loss` (errors.ts, guard spec aligned); P2-2 release bypasses the renewal so the SQL predicate runs (taken-over non-released handle is a silent no-op per the neutral registry); P2-3 this receipts section + English commits from here on (the five pre-review `mem-e5:` subjects stay: pushed history, merge-only branch, no rebase).
- AI CI job red-on-main is out of scope for this lot's gate (E5 gate = cluster-mesh lanes green).

## E5 execution receipts (`ENV=test-e2-int`, `CM_PG_URL=postgresql://app:app@postgres:5432/app`)

- `make test-cluster-mesh SCOPE=tests/storage CM_PG_URL=... ENV=test-e2-int` — exit 0: Test Files 77 passed | 1 skipped (78); Tests 492 passed | 4 skipped (496).
  - `SCOPE=tests/storage/postgres-instance-admission.spec.ts` — 9 passed (incl. r1: in-window revoke ordering, COMMIT-time lapse refusal, taken-over non-released release no-op).
  - `SCOPE=tests/storage/postgres-instance-guard.spec.ts` — 15 passed (r1: trigger backstop aligned to `terminal-loss`).
  - `postgres-transactions.spec.ts` 7 passed; `postgres-authority.spec.ts` 3 passed; neutral corpus 10 passed (in-lane counts).
  - `CM_PG_CRASH_PHASE=seed` then `=verify` on `postgres-crashes.spec.ts` — 2 passed | 2 skipped each phase (chain survives, takeover moves to the next epoch).
- `make typecheck-cluster-mesh ENV=test-e2-int` — exit 0.
- `make lint-cluster-mesh ENV=test-e2-int` — exit 0.
- `make scope-check ENV=test-e2-int` — exit 0, `PASS C2 (sentropic)` (Allowed Paths widened for `errors.ts` + guard spec, r1).
