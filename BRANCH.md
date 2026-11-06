# chore: registry retention

## Objective
- [x] Complete the owner-approved 2026-11-06 nc-reg cleanup and propose retention for the next dated train; no PR or automation activation.

## Scope / Guardrails
- [x] Base origin/main: `165ce5b932206bcd89e6374f5b80d970cd1d19b6`; branch `chore/registry-retention`; worktree `tmp/registry-retention`.
- [x] Keep live preprod/prod workloads and Pod images/digests, recovery images, main candidates, ten newest tags per repository and all origin/main overlay/pin references.
- [x] Delete only other sentropic-* tags created before `2026-10-01T00:00:00Z`; save exact sized lists before mutation.
- [x] Make-only, no Python, credentials by variable name only, read-only Kubernetes access, existing scw CLI/API.
- [x] ENV=test-registry-retention; no Compose services or ports allocated; reuse existing images without building.
- [x] No versions, locks, fixtures, APP-P1 pins, L5 manifests or workflow changes; proposal only.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/runbooks/registry-retention.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `plan/**`
- [x] No scope exception required; ignored operational evidence stays in `.tmp/rv/registry-retention*`.

## Feedback Loop
- [x] Design handoff: Astra MAX author; Argon high review's six required corrections incorporated: conditional absence, full digest closure, rollback templates, coordinated bounded deletes, isolated credentials and three storage metrics. No closure round, per owner policy; activation belongs to the next dated train.
- [ ] Track handoff: designated conductor imports this request, owner approval, cleanup outcome, proposal and acceptance from this file and `.tmp/rv/registry-retention.md`; this concurrent lane never appends `.track/events.jsonl`.

## AI Flaky tests
- [x] Not applicable: documentation proposal and direct operational verification; no application change.

## Orchestration Mode (AI-selected)
- [x] Single wagon; no PR; the integration lane carries the next dated train's consolidated review, versions and CI.

## UAT Management (in orchestration context)
- [x] Application UAT not applicable; qualify exact registry actions and retained workload/pod images directly.

## Plan / Todo (lot-based)
- [x] Lot 0 — Read common/master/workflow rules; create isolated wagon at origin/main and pass mechanical branch check.
- [x] Lot 1 — Save 302-tag exact sized inventory: KEEP 156, DELETE 146; read both namespaces and resolve all manifest/index references.
- [x] Lot 2 — Delete 146 tags (API 82, UI 46, E2E 18); retain all 156 KEEP tags/manifests; live 19 workloads/15 Pods unchanged, zero collisions; registry storage reduced by 51,342,281,964 bytes.
- [x] Lot 3 — Review `docs/runbooks/registry-retention.md`, pass scope/diff checks, commit bounded changes and push wagon without a PR.
- [x] Lot 4 — Finish report and source-artifact Track/train handoff; `make down-volumes ENV=test-registry-retention` PASS. Conductor import remains explicitly pending above; no lane services, image builds or disk-hygiene target at this baseline.
