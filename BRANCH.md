# Feature: Train 2026-11-07 (hono GHSA fixes + SCA CI gate + CI10 speedups)

## Objective
- [ ] One train, one PR, one CI: carry the GHSA-jpvv hono fixes (#938), the SCA CI gate (#940) and the ten-minute CI speedups (#939, plus the e2e load wagon) with every gate intact.
- [x] Wagons: fix/hono-node-server-ghsa-jpvv, feat/ci-sca-gate, train/2026-11-07-ci10, perf/ci10-e2e-load (merge commits, no rebase of published trains).

## Scope / Guardrails
- [x] Branch feat/ci-sca-gate; worktree tmp/worktrees/ci-sca-gate; ENV=test-sec-train.
- [x] Make only; Docker via docker-slot.sh; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Scoped local checks only; full suites run in the PR CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/package-lock.json`
  - `apps/llm-gateway/package.json`
  - `packages/auth-hono/package.json`
  - `packages/chat-server/package.json`
  - `packages/cluster-mesh/package.json`
  - `packages/comments/package.json`
  - `packages/connector-host/package.json`
  - `packages/flow/package.json`
  - `packages/llm-gateway/package.json`
  - `packages/mcp-platform/package.json`
  - `packages/cluster-mesh/tests/**/package-lock.json`
  - `packages/cluster-mesh/tests/**/package.json`
  - `packages/cluster-mesh/tests/engram-memory/installed-consumer-package-lock.json`
  - `packages/cluster-mesh/tests/storage/comments-deps.package-lock.json`
  - `scripts/ci/**`
  - `scripts/security/hono-node-server*`
  - `scripts/security/sca-gate*.mjs`
  - `.github/workflows/ci.yml`
  - `.github/workflows/security-sca-daily.yml`
  - `.security/vulnerability-register.yaml`
  - `tools/memory-mcp-l5/artifacts/**`
  - `api/vitest.config.ts`
  - `api/ci/unit-shards*`
  - `spec/ci-cd-ten-minutes/**`
  - `spec/SPEC_STUDY_CI_CD_TEN_MINUTES.md`
  - `plan/70-BRANCH_test-ci-ten-minute-proof.md`
  - `docs/ci/registry-egress.md`
  - `Makefile` (BRHONO-EX1, BRHONO-EX2, BRSCA-EX1, BR84-EX2)
  - `deploy/k8s/overlays/prod/**`, `deploy/ci/idp-identity-sync/bundle-checks.mjs`, `deploy/ci/artifact-content/bundle.selftest.mjs`, `deploy/ci/preprod-a4/bundle.selftest.mjs` (BRPIN-EX1)
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `packages/*/src/**`
  - `api/drizzle/*.sql`
- **Conditional Paths (allowed with declared exception)**:
  - `.github/workflows/ci.yml` under BR84-EX1, BR84b-EX1 and BRSCA-EX1.

## Feedback Loop
- [x] BRHONO-EX1: add only Docker regression/dependency verification targets to Makefile. Rollback reverts those targets.
- [x] BRHONO-EX2: resolve hono 4.13.17 in every lock and raise the ^4.13.16 floor only in private manifests (api, apps/llm-gateway, packages/connector-host); published package manifests keep their recorded hono ranges because a range change on a published version requires a version bump (CI package-candidates). One `lock-hono-4-13-17` Makefile target applies the pinned bump. Rollback reverts manifests, locks and target.
- [x] BRPIN-EX1: pin the deployed hono-fixed prod api and auth-idp image digests in the prod overlay (and the export cronjob / self-test expectations that mirror the api pin) so a later manifest apply cannot restore the vulnerable digests. Rollback restores the previous digests recorded in .tmp/rv/hono-prod-real.md.
- [x] BRSCA-EX1: Makefile test-security-sca-gate targets and ci.yml/daily workflow wiring; owner asked for a real SCA gate in CI (07/11). Rollback reverts targets, job and workflow.
- [x] BR84-EX1: owner-authorized CI workflow changes (toolbox static, parallel qualification, shards); keep every gate. Rollback: revert workflow and Makefile together.
- [x] BR84-EX2: capture, report, dispatch, dossier and toolbox targets in the Makefile. Rollback: restore recipes.
- [x] BR84-EX3: dossier tsconfig, ESLint/Playwright configuration, edge renderer and diagram generator source archive; dossier only.
- [x] BR84b-EX1: CI matrix, needs and exact toolbox cache changes of the unit graph. Rollback: revert workflow changes with wiring tests.
- [x] BR84b-EX2: cache and shard check targets. Rollback: restore Makefile recipes.
- [ ] Conductor Track handoff: import request, deliverables and evidence with the designated writer.
- [ ] Acceptance requires the measured critical path under 600s on the exact head; missing receipts stay to measure.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: security and CI wagons integrated into one dated train with one CI.

## UAT Management (in orchestration context)
- [x] Raw HTTP regression for GHSA-jpvv: vulnerable 1.19.17 fails, fixed 2.1.6 passes.
- [ ] Exact-head pull_request CI timing and SCA gate result retained in .tmp/rv/train-security.md.

## Plan / Todo (lot-based)
- [x] Lot 1: hono fix, SCA gate and CI10 train merged on feat/ci-sca-gate.
- [x] Lot 2: scoped make checks green (inventory 15/15, SCA gate 0 unregistered, hono lock, expected-results 28/28, ci-dag 10/10).
- [x] Lot 3: SCA gate script and make target (all locks covered, component-aware register match, mode validation, pagination, sanitized output) with unit tests for the advisory path and scheduled/PR routing.
- [x] Lot 4: SCA CI job, daily issue workflow and register entries (daily workflow passes the validated scheduled mode).
- [x] Lot 5: prod image digest pins and prod register entries resolved with deployment evidence.
- [ ] Lot 6: push, retitle PR #940, close #938 and #939.
- [ ] Lot N: Final validation: exact-head CI green; remove BRANCH.md at merge.
