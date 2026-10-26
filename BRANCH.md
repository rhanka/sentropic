# Feature: W2.a compiled app MCP registry

## Objective
- [ ] Compile one cluster-mesh provider registry with exact APP-P1 public names for W4.

## Scope / Guardrails
- [x] Base W1.b #780 `8fca05df3`; mesh 0.22.4; merge only, never rebase.
- [x] Worktree `tmp/worktrees/app-w2a`, branch `feat/app-cm-w2a`; draft against `feat/app-cm-integration`; no merge.
- [x] Read Docker lock, full plan-v2, contract-v9 registry boundaries, W0 host fit and W1.b contract.
- [x] Make-only; Docker builds/tests/start under shared flock; down after every step.
- [x] `ENV=test-app-w2a` last; API/UI/Maildev ports 8794/5180/1087 if needed; no owner environment.
- [x] Tests first; specific staging; scope-check before make commit; authored commits below 150 lines.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/mcp/cluster-registry.ts`
  - `api/tests/api/app-mcp-registry.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `plan/**`
  - `.track/**`
  - `api/src/routes/**`
  - `api/package*.json`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`
- [x] Exception process: BR02-EXn records reason, impact and rollback before scope expansion.

## Feedback Loop
- [x] W2.b owns route mounting, identity/dispatch integration and root/API lock reconciliation.
- [x] W4 consumes the returned compiled registry exact-name map without sanitization.
- [ ] Independent review and final CI receipts remain required; no inherited review approves this diff.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent review only at the final commit.

## UAT Management (in orchestration context)
- [x] Compilation only; web/Chrome/VSCode flows belong to W2.b/W4/W5; no UI or E2E changes.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check; freeze scope, dependencies, environment and contract.
- [ ] Lot 1: tests first in `api/tests/api/app-mcp-registry.test.ts`; capture missing-module red.
- [ ] Lot 2: implement `api/src/services/mcp/cluster-registry.ts` using mesh modules, builtin and facade.
- [ ] Lot 3: same test file covers exact names, explicit selection/config, collisions, missing peers, profile/schema/policy integrity and atomic refusal.
- [ ] Lot 4: focused API suite, API typecheck/lint, relevant registry and MCP regressions; cleanup.
- [ ] Lot 5: independent review; push, draft PR from this file, exact-head CI green; report names and SHA.
