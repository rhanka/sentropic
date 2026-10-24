# Feature: #861 L4 publication and collection

## Objective
Wire publication finalization through the L3 coordinator ports: guard after waits with a lifecycle/ACL predicate, no split success, shared-blob cleanup and purge deletion claims.

## Scope / Guardrails
- Scope limited to the L4 exclusive write set below; never edit L0/L1/L2/L3/L5-L9 files.
- r2 spec is binding (S2/L4 row, §§3.1 A4-A6); L0/L1/L2/L3 shapes are read-only inputs.
- L3 coordinator implementation changes are out of scope and returned to its owner.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/worktrees/861-L4`, branch `feat/artifacts-861-L4`, base `origin/feat/artifacts-861-L3` plus L1+L2 merges (no rebase).
- Automated test campaigns on `ENV=test-861-l4` (lowercase, last argument); never `ENV=dev`.
- 0 Python, one Docker build at a time machine-wide, disk tight.
- Atomic commits via `make commit MSG="..."` only, <150 lines, `git add` specific files, no AI attribution trailers.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/server/publication.ts`
  - `packages/artifacts/src/server/object-intents.ts`
  - `packages/artifacts/src/server/lifecycle.ts`
  - `packages/artifacts/src/server/gc.ts`
  - `packages/artifacts/tests/publication-authorization.integration.test.ts`
  - `packages/artifacts/tests/publication.test.ts`
  - `packages/artifacts/tests/crash-recovery.test.ts`
  - `packages/artifacts/tests/gc-races.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/artifacts/src/server/commit/**`
  - `packages/artifacts/src/adapters/postgres-commit.ts`
  - `packages/artifacts/src/testing.ts`
  - `packages/artifacts/src/profile/**`
  - `packages/artifacts/src/server/command-identity.ts`
  - `packages/artifacts/src/server/failures.ts`
  - `packages/artifacts/src/server/outcome-projection.ts`
  - `packages/artifacts/src/server/service.ts`
  - `packages/artifacts/src/server/authorized-replay.ts`
  - `packages/artifacts/src/server/http.ts`
  - `packages/artifacts/src/server/mcp*.ts`
  - `packages/artifacts/src/server/idempotency.ts`
  - `packages/artifacts/src/adapters/postgres.ts`
  - `packages/artifacts/src/adapters/s3.ts`
  - `packages/artifacts/src/index.ts`
  - `packages/artifacts/l0-freeze/**`
  - `packages/artifacts/package.json`
  - `package-lock.json`
  - `packages/cluster-mesh/**`
  - `.github/workflows/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`

## Plan / Todo (lot-based)
- [x] R1 P1-1/P1-2: retain unknown-COMMIT references; pin active preparations (publication regressions red then green).
- [x] **Lot 0 — Worktree, base merges, scope**
  - [x] Worktree `tmp/worktrees/861-L4` from `origin/feat/artifacts-861-L3`, branch `feat/artifacts-861-L4`
  - [x] Merge `origin/feat/artifacts-861-L1` and `origin/feat/artifacts-861-L2` (no rebase)
  - [x] Lot-exclusive BRANCH.md, scope-check green
- [ ] **Lot 1 — Guarded publication through L3 ports**
  - [ ] Tests first: `tests/publication-authorization.integration.test.ts` (guard after waits, lifecycle/ACL predicate, revocation race, no split success, same-key replay)
  - [ ] `publication.ts`: finalized publish via injected L3 coordinator (caller locks, provisional release+CAS+refs, guard with lifecycle/ACL predicate, intent completion)
  - [ ] Lot gate: typecheck, lint, unit, `publication-authorization` + `publication` suites green
- [ ] **Lot 2 — Shared-blob cleanup and purge claims**
  - [ ] Tests first: `gc-races.test.ts` extensions (shared digest retained, unreferenced deleted, pinned retained, claimed blocks new refs) + purge end-to-end
  - [ ] `gc.ts`/`lifecycle.ts`: durable exclusive deletion claims, claim-aware collect, purge dereference flow
  - [ ] `crash-recovery.test.ts`: pending intent reconcile without promotion, denied-attempt cleanup keeps committed refs
  - [ ] Lot gate: full L4 suites green
- [ ] **Lot 3 — Push, draft PR on feat/artifacts-861-L3, report**
  - [ ] Push branch, open DRAFT PR targeting `feat/artifacts-861-L3` (do not merge)
  - [ ] Report PR number and head SHA
