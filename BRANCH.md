# Feature: WP16 llm-gateway Codex semantics rectification

## Objective
Rectify the Sentropic/remote ownership boundary for llm-gateway and port the minimal Codex OAuth semantics into Sentropic. This unblocks remote by making Sentropic the durable owner of gateway provider semantics while remote remains a launcher/session shim.

## Scope / Guardrails
- Scope limited to llm runtime OpenAI/Codex streaming semantics, focused tests, and the llm-gateway spec.
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
  - `api/src/services/llm-runtime/index.ts`
  - `api/tests/unit/llm-runtime-stream.test.ts`
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
- `acknowledge`: owner required immediate active work and 5-minute loop until remote unblock; worktree created and Task #23 is in progress.
- `attention`: remote mirror `apps/llm-gateway` remains outside this repo; closure requires remote removal/deprecation after Sentropic PR lands.

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
- Rationale: single focused rectification branch touching one runtime surface, one unit test file, and one spec.

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
  - [x] Read the relevant `.mdc` files and `README.md`.
  - [x] Create/confirm isolated worktree `tmp/feat-<slug>` and run development there.
  - [x] Capture Makefile targets needed for debug/testing.
  - [x] Define environment mapping (`test-wp16-llm-gateway-codex-semantics`).
  - [x] Confirm command style: `make ... <vars> ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.
  - [x] Validate scope boundaries (`Allowed/Forbidden/Conditional`) and declare `BRxx-EXn` exceptions if needed.

- [ ] **Lot 1 — Codex gateway semantics rectification**
  - [x] Preserve OpenAI Responses `response.completed.response.usage` into stream `done.data.usage`.
  - [x] Flatten Codex system/developer text blocks into `instructions` instead of JSON-stringifying blocks.
  - [x] Add unit coverage for Codex OAuth Responses mode, usage propagation, `xhigh`→`high`, `store:false`, instructions, and max-output omission.
  - [x] Freeze Sentropic/remote boundary and Codex OAuth backend contract in `spec/SPEC_EVOL_LLM_GATEWAY.md`.
  - [ ] Lot gate:
    - [ ] `make typecheck-api REGISTRY=local ENV=test-wp16-llm-gateway-codex-semantics` — blocked before branch code by `build-mcp-auth` exit 137 (container killed/OOM-like); scoped unit test below is green
    - [x] **API tests**
      - [x] Updated `api/tests/unit/llm-runtime-stream.test.ts`
      - [x] Scoped run: `make test-api SCOPE=tests/unit/llm-runtime-stream.test.ts REGISTRY=local ENV=test-wp16-llm-gateway-codex-semantics` — 1 file passed, 61 passed / 1 skipped
    - [x] **UI tests (TypeScript only)**: not impacted.
    - [x] **E2E tests**: not impacted for runtime unit rectification.
    - [x] No UAT required; backend runtime semantics only.

- [ ] **Lot N-1 — Docs consolidation**
  - [x] Integrated behavior into `spec/SPEC_EVOL_LLM_GATEWAY.md`.

- [ ] **Lot N — Final validation**
  - [ ] Typecheck & Lint
  - [ ] Retest API scoped unit file.
  - [ ] Record final h2a status to remote.
  - [ ] Create/update PR using `BRANCH.md` text as PR body if requested.
