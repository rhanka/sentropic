# Feature: Claude Code OAuth upstream fail-closed contract

## Objective
Stop documenting/executing the false Claude Code OAuth path where `sk-ant-oat...` is sent as an Anthropic API bearer/key. Model the durable gateway-owned path: Claude Code OAuth tokens are enrollment/refresh credentials only; gateway must mint/refresh an executable Claude API key before dispatch.

## Scope / Guardrails
- Scope limited to llm-mesh auth contract, tests, llm-gateway dependency/version bump if needed, lockfile, and gateway spec.
- Do not change remote `gw-*` session token semantics.
- Do not implement speculative network calls to Claude Code private endpoints without verified contract/test seam.
- Fail closed until executable material exists.

## Branch Scope Boundaries
- Allowed:
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
  - `packages/llm-gateway/package.json`
  - `package-lock.json`
  - `spec/SPEC_EVOL_LLM_GATEWAY.md`
  - `BRANCH.md`
- Forbidden:
  - `Makefile`
  - `.github/workflows/**`
  - runtime API files unrelated to the package contract

## Feedback Loop
- Remote hotfix confirmed that Claude Code OAuth `sk-ant-oat...` was incorrectly treated as an Anthropic API credential.
- Architecture GO: llm-gateway/llm-mesh own provider transport/account policy; remote owns local activation/config UX.

## Plan
- [x] Identify false executable path in llm-mesh `validateAdapterAuthSource`.
- [x] Change `claude-code-account` validation to fail closed for raw OAuth token and accept only gateway-minted executable API key material.
- [x] Add tests for raw `sk-ant-oat` rejection and minted API key header shape.
- [x] Update spec with Claude Code OAuth boundary.
- [x] Bump packages/lockfile.
- [ ] Open PR and validate in CI.

## Validation
- `make ...`: blocked in this environment by Docker socket permission.
- `npm run typecheck --workspace @sentropic/llm-mesh`: blocked in this worktree because local dependencies are absent (`tsc: not found`).
- CI validation required.
