# Branch: feat/cluster-mesh-engram-e4 — Canonical PostgreSQL acquisition (lot E4)

## Objective

Implement the EXISTING `CanonicalInstanceOwnershipV1` durably in PostgreSQL:
new `src/storage/postgres/instance-*.ts` backed by additive core migration
`008-instance-ownership`, reusing `CANONICAL_INSTANCE_OWNERSHIP_CONTRACT`
name/version/meaning/digest, `CanonicalInstanceHandle` and
`CanonicalOwnershipError` codes (no second PG ownership contract, no
artifacts-coordinator reuse). G-P0a/G-P0b retained session, durable u64 epoch,
journal/scope↔store identity, installed guard assets/catalog checks.
E2 = #765 core 007; E4 reserves core **008** (recorded below).

## Scope / Guardrails

- MUST reuse `CANONICAL_INSTANCE_OWNERSHIP_CONTRACT` name/version/meaning/digest, handles and `CanonicalOwnershipError` codes from `src/storage/instance-ownership.ts` (frozen file, import only).
- NO second PostgreSQL ownership contract. NO artifacts-coordinator reuse.
- Engram stays `0.21.1`; P2/P2+P3 manifests unchanged; stop if an authored change alters them.
- Additive SQL only, chained `requires` on `007-consumed-counters@1`; `generate-pg-manifest.mjs` + `manifest.json` stay in sync (checksums pinned by specs).
- Existing SQLite tests pass; the shared corpus keeps registry semantics identical.
- Tests first; `ENV=test-e2-int` as the last make argument; `make commit MSG="type: …"` (<150 lines, `git add` specific files, no AI trailers). Never `ENV=dev`. 0 Python.

## Branch Scope Boundaries (MANDATORY)

- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/cluster-mesh/src/storage/postgres/instance-ownership.ts` (new)
  - `packages/cluster-mesh/src/storage/postgres/instance-guard.ts` (new)
  - `packages/cluster-mesh/assets/storage/postgres/008-instance-ownership.sql` (new)
  - `packages/cluster-mesh/assets/storage/postgres/manifest.json` (008 entry only)
  - `packages/cluster-mesh/tests/storage/generate-pg-manifest.mjs` (008 file entry only)
  - `packages/cluster-mesh/tests/storage/instance-corpus.ts` (new shared corpus)
  - `packages/cluster-mesh/tests/storage/instance-ownership.spec.ts` (corpus reuse only, same outcomes)
  - `packages/cluster-mesh/tests/storage/postgres-instance-ownership.spec.ts` (new)
  - `packages/cluster-mesh/tests/storage/postgres-instance-guard.spec.ts` (new)
  - `packages/cluster-mesh/tests/storage/postgres-module-migrations.spec.ts` (hypothetical 008→009 only)
  - `packages/cluster-mesh/tests/storage/postgres-reattest.spec.ts` (last ordinal 7→8 only)
  - `packages/cluster-mesh/tests/storage/postgres-u64-migration.spec.ts` (length 7→8 + 008 block only)
  - `packages/cluster-mesh/tests/storage/postgres-manifest.spec.ts` (reverted to E2: opt-in leaves existing kernels unchanged)
  - `packages/cluster-mesh/tests/storage/postgres-publication.spec.ts` (reverted to E2: same reason)
  - `packages/cluster-mesh/tests/storage/postgres-corpus.spec.ts` (reverted to E2: same reason)
  - `packages/cluster-mesh/tests/storage/postgres-lifecycle.spec.ts` (reverted to E2: same reason)
  - `packages/cluster-mesh/src/storage/postgres/core.ts` (open wiring only: opt-in lease acquire in the open tx, per-kernel driver wrapper install, conditional G-P0b hook; no transaction rewiring)
  - `packages/cluster-mesh/src/storage/postgres/protocol.ts` (`canonicalOwnership` opt-in option only; memory kernel only)
  - `packages/cluster-mesh/src/storage/postgres/index.ts` (expose kernel ownership only)
  - `packages/cluster-mesh/src/storage/postgres/errors.ts` (CanonicalOwnershipError passthrough in classifyPgFailure only)
  - `packages/cluster-mesh/tests/storage/postgres-instance-multiprocess.spec.ts` (new: two OS processes, crash then takeover after lease expiry)
  - `packages/cluster-mesh/tests/storage/pg-open-child.mjs` (new: child opener helper for the multiprocess spec)
  - `packages/cluster-mesh/package.json` + `package-lock.json` (pack-only 0.23.0-dev.7 only)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `api/**`
  - `ui/**`
  - `apps/**`
  - `packages/engram/**` (stays 0.21.1)
  - `packages/cluster-mesh/src/storage/instance-ownership.ts` (frozen, reuse only)
  - `packages/cluster-mesh/src/storage/sqlite/**`
  - `packages/cluster-mesh/src/storage/postgres/ordinary-transactions.ts` (G-P1 wiring belongs to E5)
  - Any second ownership contract or artifacts-coordinator reuse.
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None. Downstream coordination (integration order of #765 vs this PR) is recorded in the PR body, not exercised here.
- **Exception process**:
  - Declare `BRCM-E4-EXn` with reason, impact and rollback before any scope expansion.
  - [x] `BRCM-E4-EX0`: reserved core migration number **008** (`008-instance-ownership`), next free after E2's 007 (`#765`). Impact: one additive asset + manifest entry chained on 007; rollback: drop the file and the manifest entry. No renumbering.

## Plan / Todo (lot-based)

- [x] Lot E4-0 — setup: this BRANCH.md; harness branch check; pack-only `0.23.0-dev.7` (`package.json` + lock); record core 008 reservation (EX0 above).
- [x] Lot E4-1 — tests first (red): `instance-corpus.ts` shared registry semantics; parameterize `instance-ownership.spec.ts` (same outcomes); new `postgres-instance-ownership.spec.ts` (two processes/copies, same principal, aliases, different store_id for one journal, exactly one live holder, prompt refusal, release/reacquire, exact u64 epoch advance, terminal loss); new `postgres-instance-guard.spec.ts` (G-P0a open, G-P0b commit guard, journal/scope↔store identity, installed asset/catalog checks, contract digest + error codes unchanged).
- [x] Lot E4-2 — 008 migration + manifest sync: `008-instance-ownership.sql` (ownership table, exact u64 epoch, additive only); `manifest.json` 008 entry; generator entry; pinned-spec updates (module hypothetical→009, reattest ordinal→8, u64 length→8 + 008 block).
- [x] Lot E4-3 — implementation (green): `instance-ownership.ts` (durable acquire/verify/release/mark-terminal/current, exact u64, `CanonicalOwnershipError` codes); `instance-guard.ts` (G-P0a retained-session open, G-P0b commit decision guard); wire open path only (no transaction rewiring — E5).
- [ ] Lot E4-4 — gates: full `test-cluster-mesh SCOPE=tests/storage` green on `ENV=test-e2-int`; scope-check; `make commit` per file group (<150 lines); push; draft PR to `feat/engram-e2-integration`; CI green; no merge.

## Feedback Loop

- Blocker: if E2's #765 lands on the integration branch with a different 008 occupant, stop and coordinate (requires-chain conflict) — do not renumber.
- Resync R1: merged `origin/feat/cluster-mesh-engram-e2` at `09cff1f8b` (merge commit `41071d16d`); 007 checksum re-derived from E2 (`545e6f92…`); 008 stays chained after it.
- R1 redesign (Opus r1 CHANGES): opt-in `canonicalOwnership` (intended for the memory kernel; composition owns the allow-list; Comments/M2 behavior unchanged, no 008 requirement); lease-based retained session (`holder_until`) with prompt `instance-busy` refusal (no supersede, no queue); in-commit-tx guard via per-kernel driver wrapper + AsyncLocalStorage session (no second tx, no pool deadlock); renewal piggyback on RW txs; deferred lease trigger in 008 as installed final backstop + catalog verification (`tgenabled='O'` born, `'A'` accepted; binding; deferral).
- R2 fixes (Opus r2 CHANGES): open-time catalog refusal is `open-refused` (registry/SQLite parity; the catalog check runs before installation attestation so a missing/tampered catalog never surfaces as schema drift); COMMIT-time serialization races map to `instance-busy` at the opt-in open boundary; the two-OS-process spec opens real opt-in kernels through the same `.js→.ts` loader as the SQLite spec (plus `--experimental-transform-types`); corpus verdicts come from production (durable-row newness, real commit guard, DELETE+INSERT setup — the backstop rejects any UPDATE committing a dead lease).
- Code mapping (neutral-contract parity, corpus-passing): superseded/released/unknown holder → `stale-epoch`; explicit terminal or expired-unclaimed lease → `terminal-loss`; live second opener → `instance-busy`; open-time refusal → `open-refused`; PG surfaces `CanonicalOwnershipError` unwrapped (passthrough in `classifyPgFailure`).
- No deferred "final event" table: the guard's renewal UPDATE inside the commit tx is the in-tx enforcement (row-match atomicity, no TOCTOU); the deferred trigger re-checks liveness at COMMIT. No flush-code changes (E5 owns transactions).
- Watch: `postgres-module-migrations.spec.ts` hypothetical must track the real latest core (009 while this branch owns 008).
- Qualification limits (lease semantics): the holder renews only on read-write transactions (default TTL 5 min); a read-only or idle holder past TTL may be taken over and then reads as `stale-epoch`/`terminal-loss`. The deferred trigger rejects any UPDATE committing a dead lease, including test setup — seed/terminate rows via DELETE+INSERT, never UPDATE.
- Qualification limits (replica mode): 008 creates a plain constraint trigger, born `tgenabled='O'` — skipped under `session_replication_role=replica`, so the backstop only guards the primary. E4 is single-primary by design (no replicas; writes never go to a standby), and the in-tx renewal UPDATE stays the primary guard. Pinned by `pg ownership catalog enablement` mock tests (`'O'`/`'A'` accept, `'D'`/`'R'`/missing refuse as `open-refused`). Requiring `'A'` (`ENABLE ALWAYS`) would change the 008 checksum — decided against; revisit if replicas ever enter scope.
- AI CI job red-on-main is out of scope for this lot's gate (E4 gate = cluster-mesh lanes green).

## Gate receipts (r3, head `d8132b821` + r3 commits)

All commands run as `flock /home/antoinefa/.cache-tmp/sentropic-docker.lock make <target> ... ENV=test-e2-int` (`ENV` last, never `ENV=dev`):
- `make test-cluster-mesh SCOPE=tests/storage CM_PG_URL=postgresql://app:app@postgres:5432/app ENV=test-e2-int` → Test Files 75 passed | 1 skipped (76); Tests 470 passed | 2 skipped (472). Includes `postgres-instance-multiprocess.spec.ts` 2/2 (real kernels, deterministic expiry injection, no sleeps), `postgres-instance-guard.spec.ts` 15/15 (incl. 5 `pg ownership catalog enablement` mock rows), `postgres-instance-ownership.spec.ts` 15/15, shared corpus neutral + PG green.
- `make typecheck-cluster-mesh ENV=test-e2-int` → exit 0, no TS errors.
- `make lint-cluster-mesh ENV=test-e2-int` → exit 0, clean (covers the new `tests/storage/pg-open-child.mjs`).
- `make scope-check ENV=test-e2-int` → PASS C2 before every commit.
- CI on the pushed head: PR #779 draft → `feat/engram-e2-integration`, do not merge.
