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
only. No new SQL asset, no manifest change, no 008/007 checksum change.
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
- [ ] Lot E5-1 — tests first (red): new `postgres-instance-admission.spec.ts` (continuous commit validation, late-window loss/revocation incl. hook-driven window, saved-reader refusal, nested contributions, caught inner error poisoning, retry/replay, stale release vs successor/missing row with full-row readback); corpus case `stale release cannot clear its successor`; authority/transactions/crashes extensions.
- [ ] Lot E5-2 — implementation (green): post-hook final re-validation on the committing session (contributors + ownership after the last caller code); release path verified safe (DELETE+INSERT guarded by row match — pin, change only if a red test proves otherwise); no new SQL; neutral contract untouched.
- [ ] Lot E5-3 — gates: full `test-cluster-mesh SCOPE=tests/storage` green on `ENV=test-e2-int`; typecheck green; lint green; scope-check; `make commit` per file group (<150 lines); push; draft PR; CI green; no merge.

## Feedback Loop

- Blocker: if E2/E3 move under this branch (new 008 occupant, changed scope.ts hooks), stop and coordinate — do not renumber or rewire around them.
- E4 baseline: opt-in retained lease + G-P0b hook run before the caller hook on the committing session; COMMIT-time races map to `instance-busy`; open-time refusal is `open-refused`.
- Late windows are hook-driven in tests (custom `onCommitPossession` that revokes/takes over on another connection), never sleeps — deterministic by construction.
- AI CI job red-on-main is out of scope for this lot's gate (E5 gate = cluster-mesh lanes green).
