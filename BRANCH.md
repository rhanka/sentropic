# Feature: llm-gateway Codex Responses contract

## Objective
Publish the reusable Codex OAuth/Responses semantics in `@sentropic/llm-gateway` so remote can consume the Sentropic-owned gateway package instead of carrying provider semantics in `remote/apps/llm-gateway`.

## Scope / Guardrails
- Scope limited to `@sentropic/llm-gateway` Codex contract helpers, package tests, version bump, lockfile, and llm-gateway spec.
- One migration max in `api/drizzle/*.sql` (not applicable).
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/top-ai-ideas-fullstack` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in isolated worktree `tmp/feat-<slug>` (even for one active branch).
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- UAT qualification branch/worktree must be commit-identical to the branch under qualification (same HEAD SHA; no extra commits before sign-off). If subtree/sync is used, record source and target SHAs in `BRANCH.md`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `package-lock.json`
  - `spec/SPEC_EVOL_LLM_GATEWAY.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- `acknowledge`: owner clarified the API-only port is insufficient; reusable gateway semantics must be shipped in the published `@sentropic/llm-gateway` package for remote.
- `blocked`: local Docker is unavailable (`permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`), so `make lock-root` / `make test-llm-gateway` cannot run locally. CI must validate.

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
- Rationale: focused package contract change touching one package, tests, lockfile, and spec.

## UAT Management (in orchestration context)
- **Mono-branch**: UAT is performed on the integrated branch only (after each lot, when UI changes exist).
- **Multi-branch**: no UAT on sub-branches; UAT happens only after integration on the main branch.
- UAT checkpoints must be listed as checkboxes inside each relevant lot (no separate UAT section).
- Execution flow (mandatory):
  - Develop and run tests in `tmp/feat-<slug>`.
  - Push branch before UAT.
  - Run user UAT from root workspace (`~/src/top-ai-ideas-fullstack`, `ENV=dev`).
  - Switch back to `tmp/feat-<slug>` after UAT.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read the relevant rules and spec.
  - [x] Create/confirm isolated worktree and run development there.
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [ ] **Lot 1 — Published Codex contract helpers**
  - [x] Add exported Codex Responses backend constant and helpers to `@sentropic/llm-gateway`.
  - [x] Cover ChatGPT backend URL, instructions flattening, xhigh→high, max_output_tokens omission, input id stripping, and usage propagation in package tests.
  - [x] Bump `@sentropic/llm-gateway` to `0.2.0`.
  - [x] Update root lockfile version entries for the package bump.
  - [ ] Lot gate:
    - [ ] `make test-llm-gateway ENV=test-llm-gateway-codex-contract` — blocked locally by Docker socket permission; CI required.

- [x] **Lot N-1 — Docs consolidation**
  - [x] Update `spec/SPEC_EVOL_LLM_GATEWAY.md` to freeze boundary and published package contract.

- [ ] **Lot N — Final validation**
  - [ ] Push branch and open PR.
  - [ ] Verify CI package validation and publish job readiness.
  - [ ] Merge, then verify `@sentropic/llm-gateway@0.2.0` is published.
  - [ ] Notify remote to consume `@sentropic/llm-gateway@0.2.0` and remove/deprecate its mirror.
