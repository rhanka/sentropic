# Feature: W4.a trusted catalog context

## Objective
- [ ] Carry trusted request and turn authority through discovery, model selection and execution.

## Scope / Guardrails
- [x] Base W2.b d0ce8aeb0; merge commits only; worktree tmp/worktrees/app-w4a.
- [x] ENV=test-app-w4a last; API/UI/Maildev ports 8797/5183/1090; Docker flock and teardown.
- [x] Tests first; selective atomic make commits under 150 lines; no trailers.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/catalog/**`
  - `api/src/services/skills/catalog.ts`
  - `api/src/services/skills/foundation-executor.ts`
  - `api/src/services/chat-service.ts`
  - `api/src/routes/namespaces/catalog*.ts`
  - `api/tests/services/catalog/**`
  - `api/tests/api/catalog-auth-context.test.ts`
  - `api/tests/api/cluster-mesh-catalog.test.ts`
  - `api/tests/unit/foundation-executor.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`
  - `.track/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `.github/workflows/**`

## Plan / Todo (lot-based)
- [x] Lot 0: read Docker lock, full plan-v2, W0 context contract; mechanical branch check.
- [ ] Lot 1: freeze file-level tests and implementation plan before code.
