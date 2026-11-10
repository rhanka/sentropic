# Fix: artifact builder accepts a host-made fast-forward in remote-host mode

## Objective
Stop failing a verified build-only job with `builder_unavailable:fast_forward_remote_host` when the host LiveService advanced the artifact branch by fast-forward: in remote-host mode the controller confirms, read-only, that the branch head is the new head and the previous verified head is its ancestor (P1 job 87e48c35, 09/11: install/prepare/build/verify ok, then refused at `observeHead`).

## Scope / Guardrails
- api only: `api/src/services/artifacts/live/forge.ts` (remote-host forge port), its README line and its unit test.
- Make-only workflow, no direct Docker commands.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `api/src/services/artifacts/live/forge.ts`
  - `api/src/services/artifacts/live/README.md`
  - `api/tests/unit/artifacts-live/product-builder.test.ts`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - none

## Feedback Loop
- [ ] none

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**

## UAT Management (in orchestration context)
- [ ] Preprod: immo republishes P1 (412418f7) after the deploy; the job reaches `published`.

## Plan / Todo (lot-based)
- [x] Lot 1 — Remote-host `fastForward` confirms a host-made fast-forward read-only (head === after && before reachable); divergence -> false (`git_diverged` at the caller); tests for accept, moved head and rewritten history.
- [ ] Lot 2 — CI green, review, merge, deploy-preprod, P1 republish.
