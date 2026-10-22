# Feature: #861 L1 — compile selection and effective profile

## Objective
- [ ] Implement spec r2 section 6 L1: immutable selection, effective profile and ordered command identity.

## Scope / Guardrails
- Scope limited to packages/artifacts/** declaration shapes, docs, and unit vectors.
- Public host API names are explicitly excluded until spec r2 is forwarded.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development happens in isolated worktree `tmp/worktrees/artifacts-861`.
- Automated test campaigns run on dedicated environments (`ENV=test-artifacts-861`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off).
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `packages/artifacts/src/profile/**`
  - `packages/artifacts/src/server/command-identity.ts`
  - `packages/artifacts/tests/capability-profile.test.ts`
  - `packages/artifacts/tests/command-identity.test.ts`
  - `packages/artifacts/tests/parameters.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `packages/cluster-mesh/**`
  - `packages/mcp-platform/**`
  - `packages/mcp-auth/**`
  - `.github/workflows/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] L0-EXCLUDE-1 (acknowledge): public host API names (coordinator/outcome method names, host binding names) stay unfrozen until spec r2 is forwarded; L0 freezes shapes and vectors only
- [ ] L0-Q0 (attention): i-cond Q0 inventory (due 22 Oct 12:00 Toronto) not yet forwarded; integrate on arrival as amendment without changing frozen shapes unless r2 requires it
- [ ] L0-R2 (attention): Opus review requires spec r2 (host API naming vs radar suite, consumer baselines 0.1.2, race/isolation, error-code mapping, CR-1..CR-5); do not freeze contested names in L0
- [x] L0-CI (acknowledge): CI run 39720063546 failed on the 0.2.0-rc.1 package.json bump (probe version equality, mesh eresolve against frozen range); L0 restructured to docs plus vectors plus l0-freeze with no src or version change, bump deferred to L1

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: L0 is a single declaration-freeze lot with no parallel implementation workstreams.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- No UI changes in L0; no UAT checkpoints apply.

## Plan / Todo (lot-based)
