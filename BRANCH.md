# Feature: Claude Code account enrollment (gateway parity with Codex)

## Objective
Give the LLM gateway a first-class Claude Code account enrollment flow (OAuth authorization-code + PKCE), at parity with the existing Codex device-code enrollment, so pooled Claude accounts can be registered/refreshed instead of only imported as raw tokens.

## Scope / Guardrails
- Scope limited to `api/` provider-connection + Claude Code auth services, their routes, and unit tests.
- No new DB migration (enrollment state in `settings`; connected account in existing `llm_provider_accounts`).
- Make-only workflow, no direct Docker commands.
- Root workspace reserved for user dev/UAT (`ENV=dev`); this branch develops in `tmp/feat-wp16-claude-code-gateway-enrollment`.
- Automated tests run on isolated docker (`make typecheck-api` / `make test-api`), never on root `dev`.
- `ENV=<env>` passed as the last `make` argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/claude-code-provider-auth.ts`
  - `api/src/services/provider-connections.ts`
  - `api/src/services/llm-account-transports.ts`
  - `api/src/routes/api/settings.ts`
  - `api/tests/unit/**`
  - `tmp/feat-wp16-claude-code-gateway-enrollment/BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/*.sql` (not expected; zero migrations)
  - `.github/workflows/**`

## Lots
- [x] Lot 1 — `claude-code-provider-auth.ts`: PKCE pair, `startClaudeCodeAuthorization` (authorize URL + verifier + state), `exchangeClaudeCodeAuthorizationCode` (authorization_code grant).
- [x] Lot 2 — `provider-connections.ts`: `start/complete/disconnectClaudeCodeEnrollment` + secret/connection helpers + `toAnthropicProviderState`; wire `listProviderConnections`.
- [x] Lot 3 — `settings.ts`: `/provider-connections/anthropic/enrollment/{start,complete,disconnect}` routes + zod schemas (complete carries `authorizationCode`).
- [x] Lot 4 — Stale `defaultModelId` fix `claude-sonnet-4-6` → `claude-sonnet-5` (`llm-account-transports.ts` + `provider-connections.ts`).
- [x] Lot 5 — Unit tests (mocked fetch) for auth + enrollment; `make typecheck-api` PASS; scoped unit `make test-api-unit SCOPE=claude-code-enrollment` PASS (9/9); CI #392 green (one unrelated AI flake, see below).
- [ ] Lot 6 — UAT (with owner): live Claude Code login (paste-code) from root; confirm authorize URL / redirect / scopes; verify pooled account served to a `--gw` subagent without spend-limit.

## Feedback Loop
- BRxx-EXn: none yet.
- Note: OAuth authorize URL / redirect URI / scopes are set as named constants and MUST be confirmed during Lot 6 UAT (owner-side live login).

## AI Flaky tests
- Accept only non-systematic provider/network nondeterminism as `flaky accepted`, with same-commit success + owner sign-off. No additive timeouts.
- `flaky accepted` (pending owner sign-off): CI #392 run `29111773306`.
  - Command: `make test-api-ai` (shard `ai, chat-sync,executive-summary-auto,comment-assistant`).
  - File: `api/tests/ai/executive-summary-auto.test.ts` > "should automatically trigger executive summary generation when all initiatives are completed".
  - Signature: `AssertionError: expected false to be true`, root cause `DrizzleQueryError ... unsupported Unicode escape sequence` (`json_errsave_error`) on `UPDATE initiatives SET data=...` — model emitted a NUL escape the jsonb column rejects.
  - Non-systematic: same-commit `gh run rerun --failed` → shard PASS (job `86428204120`).
  - Unrelated to this branch: no change to executive-summary generation, initiatives jsonb writes, or the model used by these tests (the modelId fix only affects the enrolled claude-code transport path, never exercised in CI).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single coherent auth feature, one final test cycle)
- [ ] **Multi-branch**
- Rationale: one tightly-coupled feature (auth service → enrollment service → routes → tests); no independent CI needed.

## UAT Management
- Mono-branch: UAT on the integrated branch after Lot 5, from root workspace (`ENV=dev`), owner-driven live login.
- Ports: no dev stack required for this branch (api-only unit tests in isolated docker); if a dev stack is needed for UAT, allocate API 9540 / UI 5740 / Maildev 1340 and keep `VITE_API_BASE_URL` aligned.
