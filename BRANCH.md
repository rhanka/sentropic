# Feature: BR37 — Document AI workflow flake on main (post-PR171)

## Objective
Document the AI test flake observed on `main` after PR #171 merge, using the existing AI Flaky Allowlist procedure. No code change; produce signature record + capture user sign-off.

## Scope / Guardrails
- Scope limited to `BRANCH.md` documentation only.
- No source code edits, no test edits, no rule edits.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`).
- Branch development happens in isolated worktree `tmp/fix-ai-workflow-ci-flake`.
- `ENV=<env>` must be last argument of every make command.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `api/**`
  - `ui/**`
  - `e2e/**`
  - `rules/**`
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - None (no code change planned).
- **Exception process**:
  - Declare exception ID `BR37-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- None at creation.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

- Context:
  - Main run: `26335021025` (https://github.com/rhanka/sentropic/actions/runs/26335021025)
  - Head SHA: `548655eee59c06d680de6b495ae3e4a6c5ac2f06a` (merge of PR #171 `fix/publish-package-triggers`)
  - PR #171 itself only changed `.github/workflows/ci.yml` (publish-trigger filters). No `api/**` change. The AI workflow code path is unchanged vs the previous green main on the same `api/**`.
  - CI matrix group: `test-api-unit-integration (ai, initiative-generation-async,executive-summary-sync)`
  - Failing test file: `api/tests/ai/initiative-generation-async.test.ts`
  - Allowlist coverage: `api/tests/ai/**` is listed in `rules/testing.md` AI Flaky Allowlist (non-blocking when documented with signature + sign-off).
  - Impact vs main: unrelated to PR #171 changes (workflow-only, no API code touched). Treated as candidate for `flaky accepted`.

- Exact command (CI matrix equivalent, locally reproducible):
  - `make test-api-ai SCOPE="tests/ai/initiative-generation-async.test.ts tests/ai/executive-summary-sync.test.ts" API_TEST_WORKERS=1 ENV=test-ai-workflow-ci-flake`

- Observed failure signatures on commit `548655eee59c06d680de6b495ae3e4a6c5ac2f06a`:
  - Signature 1 (first attempt, job `77527335851`):
    - Test: `AI Workflow - Complete Integration Test > should accept the org-aware list schema with explicit org_ids`
    - Error: `AssertionError: expected false to be true`
    - Assertion: `expect(anyWithOrg).toBe(true)` at `api/tests/ai/initiative-generation-async.test.ts:514`
    - Root cause class: provider/model nondeterminism — the LLM returned a list where no item carried an organization ID for the two-org input. Workflow path only auto-assigns an org when exactly one org is allowed; with two orgs the assignment depends on the model output, which is non-deterministic for `gpt-4.1-nano`.
  - Signature 2 (rerun, job `77527926376`):
    - Test: `AI Workflow - Complete Integration Test > should complete full AI workflow: organization enrichment + initiative generation`
    - Error: `Error: Test timed out in 120000ms` at `api/tests/ai/initiative-generation-async.test.ts:248`
    - Upstream log: `Erreur de parsing JSON pour la liste: Error: Request was aborted.` then `Job <uuid> failed: Error: Erreur lors du parsing de la réponse de l'IA pour la liste`
    - Root cause class: provider/network nondeterminism — the live LLM request was aborted before the list response was fully streamed; `generateInitiativeList()` has no abort/parse fallback (unlike `generateInitiativeDetail()`), so the upstream workflow stalled until vitest's 120s timeout.

- Strict criterion check:
  - The acceptance rule requires at least one success on the same commit + same command.
  - On commit `548655eee59c06d680de6b495ae3e4a6c5ac2f06a`, both attempts of the `ai` matrix group failed (different signatures, both classifiable as provider/network/model nondeterminism).
  - No successful run of this exact matrix group has been observed on this commit.
  - User sign-off requested explicitly under this exception, with rationale: both failures are provider/network/model nondeterminism (not test logic or code regression on this branch), and the underlying `api/**` code was unchanged by PR #171.

- Deferred follow-ups (not in scope of this BR37, candidates for a future fix branch):
  - Add a provider abort/parse fallback in `api/src/services/context-initiative.ts::generateInitiativeList()` analogous to `generateInitiativeDetail()`.
  - Or convert `api/tests/ai/initiative-generation-async.test.ts` into a deterministic workflow runtime test (mock at `contextInitiative`/`contextOrganization`/`contextMatrix`/`executiveSummary` boundary, mirroring `api/tests/api/initiatives-workflow-runtime.test.ts`).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (documentation-only, single file)
- [ ] **Multi-branch**
- Rationale: Single-file doc change, no test or code edits, no parallel workstreams.

## UAT Management (in orchestration context)
- N/A — no UI/API change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Confirm worktree `tmp/fix-ai-workflow-ci-flake` clean on branch `fix/ai-workflow-ci-flake`.
  - [x] Confirm base commit `548655eee59c06d680de6b495ae3e4a6c5ac2f06a` (PR #171 merge).
  - [x] Confirm allowlist coverage for `api/tests/ai/**` in `rules/testing.md`.
  - [x] Define scope: documentation only, no code/test edit.

- [ ] **Lot 1 — Document AI workflow flake signatures**
  - [x] Record CI run URL, job IDs, commit SHA, and exact local command in `BRANCH.md`.
  - [x] Record Signature 1 (assertion `anyWithOrg` on org-aware list test).
  - [x] Record Signature 2 (`Request was aborted` + 120s timeout on full workflow test).
  - [x] Classify both signatures as provider/network/model nondeterminism.
  - [x] Note that strict "at least one success on same commit" criterion is NOT met (both attempts failed); explicit user sign-off requested under this exception.
  - [x] List deferred follow-ups (provider fallback or deterministic test rewrite).
  - [x] Capture explicit user sign-off (status: `signed-off` 2026-05-23).
  - [ ] Lot gate: no test/lint/typecheck run (no code touched).

- [ ] **Lot N — Final**
  - [ ] After user sign-off: push branch, open PR with this `BRANCH.md` as body, await CI (no API job affected; PR carries only `BRANCH.md`).
  - [ ] Once PR CI green and sign-off recorded, remove `BRANCH.md` and merge.

## Deferred to future BR
- Add abort/parse fallback in `generateInitiativeList()` (mirror `generateInitiativeDetail()`).
- Or rewrite `api/tests/ai/initiative-generation-async.test.ts` deterministically using `vi.spyOn` mocks at the LLM boundary, following `api/tests/api/initiatives-workflow-runtime.test.ts`.

## User sign-off
- Requested by: AI (BR37 author).
- Subject: accept `api/tests/ai/initiative-generation-async.test.ts` failures on main run `26335021025` as `flaky accepted` despite no success observed on the same commit, on the basis that both signatures are provider/network/model nondeterminism unrelated to PR #171.
- Status: `signed-off`.
- Sign-off record:
  - User: Fabien Antoine (fabien.antoine@gmail.com)
  - Date: 2026-05-23
  - Decision: `flaky accepted`
  - Notes: Both failure signatures classified as provider/network/model nondeterminism. PR #171 only changed `.github/workflows/ci.yml` (publish-trigger filters), no `api/**` code change, so failures are unrelated to that branch. Strict criterion (at least one success on same commit) not met; accepted under explicit exception. Follow-ups deferred to a future BR (provider abort/parse fallback in `generateInitiativeList()` or deterministic rewrite of the test).
