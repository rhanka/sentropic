# Feature: llm-gateway xhigh reasoning pass-through

## Objective
Stop the `@sentropic/llm-gateway` Codex transport from downgrading `xhigh` reasoning to `high`. Owner decision (WP16): `xhigh` is passed through unchanged to the Codex backend.

## Scope / Guardrails
- Scope limited to the `@sentropic/llm-gateway` Codex reasoning-effort mapping, its test, the gateway spec wording, and the package/lock version bump.
- Make-only validation; `ENV` last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/codex.ts`
  - `packages/llm-gateway/tests/codex.test.ts`
  - `packages/llm-gateway/package.json`
  - `spec/SPEC_EVOL_LLM_GATEWAY.md`
  - `package-lock.json`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - unrelated packages/api/ui

## Feedback Loop
- `context`: grounded in a planning-only diagnosis of the WP16 `--gw` gateway incident. Two bugs, two owners: (1) Anthropic->Codex context loss lives in the a2a-cli h2a-runtime (`proxy-openai.ts`), out of scope here and relayed to that lane; (2) `xhigh`->`high` downgrade lives ONLY in this package (`codex.ts` + spec + test) and is fixed here.

## Plan / Todo (lot-based)
- [x] **Lot 1 — xhigh pass-through**
  - [x] Remove `mapCodexReasoningEffort` + `CodexMappedReasoningEffort`; pass `reasoning` through unchanged in `prepareCodexResponsesRequest`.
  - [x] Update `tests/codex.test.ts` (pass-through assertions).
  - [x] Update `spec/SPEC_EVOL_LLM_GATEWAY.md` (no-downgrade wording).
  - [x] Bump `@sentropic/llm-gateway` 0.2.1 -> 0.3.0 + lock sync.
  - [x] `make typecheck-llm-gateway` — PASS.
  - [x] `make test-llm-gateway` — PASS (9 files / 72 tests).
  - [x] `make build-llm-gateway` — PASS.

- [ ] **Lot N — Final validation**
  - [ ] scope-check.
  - [ ] Commit via `make commit`, push, PR.
