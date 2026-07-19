# Feature: BR-72 DEPTH Lot 1 — GitHub connector LIVE end-to-end proof

## Objective
Make the `@sentropic/mcp-connector-github` connector work END-TO-END against the REAL GitHub API
(`https://api.github.com`) through a minimal in-memory broker. First real-network path in the BR-72
connector program (deliberate deviation from the read-only proofs' synthetic-fixture rule): proves one
connector actually invokes a live API through the Sentropic `AppConnectorProviderAdapter` contract.

## Scope / Guardrails
- Scope limited to `packages/mcp-connector-github/**` (live-* additions) + one additive Makefile target.
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); this branch never touches it.
- Branch development happens in isolated worktree `tmp/br72-depth-github`.
- Existing synthetic-fixture unit tests (`tests/github.test.ts`, `tests/github-write.test.ts`) kept intact.
- The live path (`live-*.ts`, `scripts/smoke-github-live.mjs`) makes REAL network calls ON PURPOSE.
- Never log or echo a token value (`getSecret('githubToken')` result never appears in audit/logger output).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/mcp-connector-github/src/live-executors.ts`
  - `packages/mcp-connector-github/src/live-adapter.ts`
  - `packages/mcp-connector-github/src/live-broker.ts`
  - `packages/mcp-connector-github/scripts/smoke-github-live.mjs`
  - `packages/mcp-connector-github/tests/github-live.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `packages/mcp-connector-github/src/adapter.ts`, `fixtures.ts`, `manifest.ts`, `write-*.ts`, `index.ts`, `experimental.ts` (existing read-only/write proof — untouched)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` — see `BR72-EX1` below.
- **Exception process**:
  - `BR72-EX1`: add `smoke-mcp-connector-github-live` Docker target (mirrors `typecheck-mcp-connector-github`'s
    container pattern; installs `tsx@4.19.2` ad hoc to run the TS-sourced smoke; passes `GITHUB_TOKEN` through
    from the host env when set). Reason: DoD requires a `make`-only, Docker-first runnable path for the live
    smoke (Make-Only + Docker-First mandate — no direct `node`/`npx` on host). Impact: purely additive target,
    no existing target modified. Rollback: revert the Makefile hunk; no other target depends on it.

## Feedback Loop
- `BR72-EX1` — status: `applied`. Additive `smoke-mcp-connector-github-live` Makefile target for the DoD-required
  live smoke. No existing target changed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single orthogonal lot, single final test cycle)
- Rationale: one connector, one lot, no sub-workstreams.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Live executors + adapter + minimal broker + smoke**
  - [x] `src/live-executors.ts` — real `fetch` executors for `get_repository`, `search_repositories`,
    `get_current_user`, `get_file_contents` against `https://api.github.com`; typed `GithubLiveApiError`
    on non-2xx; never logs the token.
  - [x] `src/live-adapter.ts` — `githubLiveAdapter: AppConnectorProviderAdapter`; `readResource`/`invokeTool`
    call the live executors; token from `ctx.getSecret('githubToken')` (gracefully handles `''`).
  - [x] `src/live-broker.ts` — `invokeGithubLive(capabilityRef, input, opts?)`: constructs an in-memory
    `StpConnectorContext` (stub principal/tenant/connectorInstanceId/session; `getSecret` resolves
    `opts.token ?? process.env.GITHUB_TOKEN ?? ''`; `audit.emit` → redacted `console.error`; `logger` =
    `console`) and dispatches to `readResource`/`invokeTool` per the capability's manifest kind.
  - [x] `scripts/smoke-github-live.mjs` — real-network smoke: `get_repository(octocat/Hello-World)`,
    `search_repositories(q="sentropic")`, and `get_current_user` when `GITHUB_TOKEN` is set. Exit non-zero
    on any real API failure.
  - [x] `tests/github-live.test.ts` — hermetic unit tests for `live-broker`/`live-adapter` with a mocked
    global `fetch` (no real network): URL/header construction, token forwarding, missing-token fast-fail,
    resource-vs-tool dispatch, non-2xx error mapping, unknown-capability error.
  - [x] `Makefile` — `smoke-mcp-connector-github-live` target (`BR72-EX1`).
  - [x] Lot gate:
    - [x] `make typecheck-mcp-connector-github` → exit 0
    - [x] `make test-mcp-connector-github ENV=test-br72-depth` → exit 0 (36 tests: 10 + 20 pre-existing + 6 new)
    - [x] `make smoke-mcp-connector-github-live` → exit 0, REAL `api.github.com` data (see below)

## Live Smoke Evidence (real `api.github.com`, no `GITHUB_TOKEN` set)
```
[smoke-github-live] get_repository(octocat/Hello-World) — REAL api.github.com...
[smoke-github-live] get_repository OK: {
  full_name: 'octocat/Hello-World',
  stargazers_count: 3727,
  description: 'My first repository on GitHub!'
}
[smoke-github-live] search_repositories(q="sentropic") — REAL api.github.com...
[smoke-github-live] search_repositories OK: { total_count: 1, first_item_full_name: 'rhanka/sentropic' }
[smoke-github-live] GITHUB_TOKEN not set — skipping get_current_user (requires auth).
[smoke-github-live] ALL LIVE CALLS SUCCEEDED.
```

## Deferred to BR-72 (later lots)
- `get_current_user` real-token verification (needs a `GITHUB_TOKEN`; conductor to run when available).
- Live coverage for `list_my_repositories`, `check_pull_request_merged`, `compare_commits` (currently
  `not_implemented_live` in `live-adapter.ts` — out of this lot's brief-defined scope of 4 capabilities).
- Production broker residence / real secret-store wiring (architect D4 decision, deferred repo-wide).
