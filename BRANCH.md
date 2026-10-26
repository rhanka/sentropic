# Feature: W2.a compiled app MCP registry

## Objective
- [x] Compile one cluster-mesh provider registry with exact APP-P1 public names for W4.

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
  - `api/vitest.config.ts`
  - `api/tsconfig.json`
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
- [x] BR02-EX2: one workspace artifacts type graph for the new mesh builtin import resolves the conflicting API/private and workspace 0.2.1 frozen types; API typecheck and lint pass. Bounded api/tsconfig.json path mapping; runtime locks remain W2.b; rollback removes mapping.
- [x] BR02-EX1: Vitest root aliases resolve new registry leaves as index.ts/subpath (ENOTDIR). Add exact mesh/platform leaf aliases in api/vitest.config.ts; test-only impact; rollback removes those aliases.
- [x] BR02-EX1 pins all test artifacts imports to workspace dist, matching the mesh loader and keeping HTTP/MCP on one profile instance. Root lock installs an API-private artifacts copy; its profile WeakSet refuses cross-copy profiles. Production physical resolution remains W2.b's required gate.
- [x] W2.b owns route mounting, identity/dispatch integration and root/API lock reconciliation.
- [x] W4 consumes the returned compiled registry exact-name map without sanitization.
- [x] Compiled order: `artifacts_ensure`, `artifacts_get`, `artifacts_list`, `artifacts_publish`.
- [ ] Independent review and final CI receipts remain required; no inherited review approves this diff.

## AI Flaky tests
- [x] No AI calls, accepted flakes or timeout increases.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, one author; independent review only at the final commit.

## UAT Management (in orchestration context)
- [x] Compilation only; web/Chrome/VSCode flows belong to W2.b/W4/W5; no UI or E2E changes.

## Plan / Todo (lot-based)
- [x] Lot 0: mechanical branch check; freeze scope, dependencies, environment and contract.
- [x] Lot 1: tests first in `api/tests/api/app-mcp-registry.test.ts`; missing-module red captured in `/tmp/app-w2a-module-red.log` after BR02-EX1.
- [x] Lot 2: implement `api/src/services/mcp/cluster-registry.ts` using mesh modules, builtin and facade.
- [x] Lot 3: same test file covers exact names, explicit selection/config, collisions, missing peers, profile/schema/policy integrity and atomic refusal.
- [x] Lot 4: focused API suite, API typecheck/lint, relevant registry and MCP regressions; cleanup.
  - [x] API typecheck; lint 0 errors/219 warnings; focused registry 17/17: `/tmp/app-w2a-types-coherence.log`, `/tmp/app-w2a-final-focused.log`.
  - [x] API regressions: `api/tests/api/{app-mcp-registry,artifacts-host-publication,artifacts-host-migrations,mcp-resource-server,cluster-mesh-mcp-singleton,cluster-mesh-namespace-inventory}.test.ts`: 74/74, `/tmp/app-w2a-regressions.log`.
  - [x] Consumed mesh registry suite: `packages/cluster-mesh/tests/mcp-registry.spec.ts`: 4/4, `/tmp/app-w2a-mesh-registry.log`.
  - [x] API stack reached healthy before tests; all steps cleaned with locked make down; final make ps has no services. No AI calls or skips.
- [x] Lot 5 authoring: push and draft PR #785 against `feat/app-cm-integration`; PR body is this file; no merge.
  - [ ] Exact-head remote CI receipt: workflow_dispatch required for this integration base; confirm success in the PR before acceptance.
  - [ ] Independent review dispatch awaits owner OK required by `rules/subagents.md`; no reviewer verdict or consensus claimed.
