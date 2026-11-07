# Feature: fix GHSA-jpvv-r467-5p4w across Hono runtimes

## Objective
- [ ] Upgrade runnable adapter copies, regress path traversal and report current production exposure; deliver one READY hotfix PR.

## Scope / Guardrails
- [x] Branch fix/hono-node-server-ghsa-jpvv from origin/main; worktree tmp/worktrees/hono-cve.
- [x] ENV=test-hono-cve; API_PORT=9695 UI_PORT=5895 MAILDEV_UI_PORT=1795; raw HTTP tests need no service ports.
- [x] Make only; Docker via docker-slot.sh; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Production inspection is read-only; no deployment, merge or publication authorized.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `apps/llm-gateway/package.json`
  - `packages/cluster-mesh/tests/**/package-lock.json`
  - `packages/cluster-mesh/tests/engram-memory/installed-consumer-package-lock.json`
  - `scripts/ci/consumer-locks.json`
  - `scripts/ci/tool-locks.json`
  - `scripts/security/hono-node-server*`
  - `.security/vulnerability-register.yaml`
  - `tools/memory-mcp-l5/artifacts/**`
  - `Makefile` (BRHONO-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (not required)
- **Exception process**:
  - [x] BRHONO-EX1: add only Docker regression/dependency verification targets to Makefile; owner-requested image proof needs reproducible checks. Rollback reverts those targets.

## Feedback Loop
- [ ] Conductor, designated Track writer, imports this request and .tmp/rv/hono-cve.md; this lane maintains the mergeable source.
- [ ] Local image builds blocked above 90% disk; scoped container checks proceed and image verification remains explicit.

## AI Flaky tests
- [x] No flaky allowance or timeout increase.

## Orchestration Mode (AI-selected)
- [x] Single hotfix branch; independent code review under current owner model policy.

## UAT Management (in orchestration context)
- [ ] Raw HTTP regression: literal/encoded backslashes and public/protected positive controls.

## Plan / Todo (lot-based)
- [ ] **Dependency remediation**: pin one 2.1.6 adapter in root/API/fixtures/tool closures; preserve historical evidence.
- [ ] **Regression and artifact proof**: vulnerable failure, fixed success; npm ls root/API/runtime/content; actual import resolution.
- [ ] **Security handoff**: production exposure register, review, scope, push, one READY PR, state and EXIT.
