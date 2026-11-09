# Deploy: preprod builder installWorkspaces for radar-immobilier

## Objective
Scope the preprod artifact builder dependency install of `rhanka/radar-immobilier` to the artifact build workspaces (`ui`, `packages/radar-domain`, `packages/radar-scoring`, `packages/radar-sources`) now that #985 supports `installWorkspaces`; the full monorepo install OOMs a builder pod (P1 job d8bbbd1e, `install_failed:oom`).

## Scope / Guardrails
- Config-only change: the preprod overlay builder repository entry and its pinned copy in the bundle check.
- Make-only workflow, no direct Docker commands.
- Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `deploy/ci/artifact-content/bundle-checks.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `ui/**`
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
- [ ] Preprod: immo republishes P1 and « Classement des signaux » on their new artifact commits after the deploy.

## Plan / Todo (lot-based)
- [x] Lot 1 — Add `installWorkspaces` to `ARTIFACT_BUILDER_REPOSITORIES_JSON` (preprod overlay + bundle check pin).
- [ ] Lot 2 — CI green, merge, deploy-preprod, P1 republish.
