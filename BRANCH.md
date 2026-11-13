# Feature: S1-C1 artifact-content execution-node data plane

## Objective
- [ ] Deliver the approved S1-C1 mTLS data-plane transport and D7-A CSP profile.

## Scope / Guardrails
- [x] Worktree `tmp/worktrees/s1-c1`; branch `feat/s1-c1-artifact-content-data-plane` from origin/main.
- [x] Make-only, Docker-first; no VM, cluster, merge or deployment.
- [x] ENV=feat-s1-c1; API_PORT=9145, UI_PORT=5345, MAILDEV_UI_PORT=1245 checked free.
- [x] Existing k8s path remains the configurable hot rollback, as explicitly required by the packet.
- [x] No signing or heartbeat implementation: S1-B0a owns both.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `apps/artifact-content/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.github/workflows/**`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/**`
- [x] Exceptions: none.

## Feedback Loop
- [ ] C1-AGENT: agent owner must implement `/v1/ports/:port/*` and signed custody verification; absent from service.ts at the baseline. Acceptance: contract integration tests with HTTP/WS expiry and revocation; no live qualification claimed here.
- [ ] C1-ISSUER: S1-B0a must fulfil the narrow issuer/route-resolution interface; startup must fail closed without it.
- [x] Track single-writer: conductor imports this mergeable BRANCH.md; this concurrent lane does not append `.track`.

## AI Flaky tests
- [x] No AI tests or flaky exceptions.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no implementation delegation or integration into main.

## UAT Management (in orchestration context)
- [x] Hermetic contract qualification only; no production or browser UAT claim.

## Plan / Todo (lot-based)
- [x] Lot 0: read binding packet/spec/agent code; mechanically check branch and record isolated ports.
- [x] Lot 1: issuer interface, env validation, mTLS transport and bounded custody lifetime.
- [x] Lot 2: wire live HTTP/HMR and supervisor relay; retain k8s selection.
- [ ] Lot 3: D7-A opt-in CSP and worker query admission.
- [ ] Lot 4: hermetic `data-plane.test.ts`, `data-plane-upgrade.test.ts`, `data-plane-config.test.ts`; existing live/relay/config regressions; typecheck and lint.
- [ ] Lot 5: README contract/env documentation, independent code review, scoped validation.
- [ ] Lot 6: push, PR, exact-head CI, report and done marker; no merge/deploy.
