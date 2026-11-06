# train 2026-11-06: public GHCR migration

## Objective
- [ ] Remove the former container registry completely, preserve recovery/live/candidate image digests in public GHCR packages, and qualify one READY PR. The conductor reviews and merges; this lane never deploys prod.

## Scope / Guardrails
- [x] Owner decision 2026-11-06 ~18:00 and 2026-07-17 (poc-k8s docs/migrations/ovh-tenant-readiness.md §C1): public ghcr.io/rhanka/sentropic-{api,ui,e2e}; no OVH registry exists.
- [x] Base 165ce5b932206bcd89e6374f5b80d970cd1d19b6; branch train/2026-11-06-ghcr; worktree tmp/worktrees/train-2026-11-06-ghcr.
- [x] Make-only; ENV=test-ghcr-1106 last; API_PORT=9480 UI_PORT=5680 MAILDEV_UI_PORT=1580; no local image build, Python, CI rerun, skip marker or attribution trailer.
- [x] Copy remotely on GitHub runners only; source access is temporary and read-only. Never print credentials. Never delete cluster Secret objects.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in .security/ci-lockfile-policy.json.
- [x] Track source artifact: conductor is the designated .track writer and imports this request, owner decision, lots and final receipts from this plan/report.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `plan/done/2026-11-06-train.md`
  - `deploy/k8s/**`
  - `deploy/ci/**`
  - `scripts/ci/**`
  - `scripts/publish-*-image.sh`
  - `scripts/security/daily/*.test.mjs`
  - `api/src/scripts/cm-preprod-contract.ts`
  - `api/tests/unit/auth/cm-preprod-*.test.ts`
  - `ui/tests/utils/sentropic-infra-contract.test.ts`
  - `e2e/tests/fixtures/spec-concat.md`
  - `docs/**`
  - `spec/*.md`
  - `plan/done/37*-BRANCH_feat-deploy-poc-k8s*.md`
  - `README.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/drizzle/*.sql`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` under BRGHCR-EX1
  - `.github/workflows/**` under BRGHCR-EX2

## Feedback Loop
- [x] GHCR-REF2 — Base workloads, both tier overlays, recovery pins and sync CronJobs now use GHCR; historical baseline URLs follow the owner-requested repository-wide removal.
- [x] GHCR-REF1 — Switch A4 authorization contracts, identity/artifact render fixtures and source API digest validation to GHCR.
- [x] BRGHCR-EX1 — Owner explicitly requests Make registry migration/guard/copy entry points; impact: image delivery only; rollback: revert this train. Local mechanical scope uses the installed host harness via .tmp/ghcr-ops.mk to avoid a forbidden local build.
- [x] BRGHCR-EX2 — Owner explicitly requests GHCR-only CI with packages:write; temporary remote-copy workflow is deleted after completion; impact: container registry only; rollback: revert this train without changing cluster Secrets.
- [ ] Preserve BR-82 tested-artifact joins; remote published config digest equals the loaded/tested image ID; manifest digest is recorded before deployment.
- [ ] Public package visibility: attempt supported API; if unsupported, record exact owner click and verify anonymous pulls after the owner applies it.

## AI Flaky tests
- [x] No exception accepted; no retry or timeout increase, assertion weakening or gate removal.

## Orchestration Mode (AI-selected)
- [x] Mono-branch dated train, one PR; independent consolidated code review per common lane rules.

## UAT Management (in orchestration context)
- [ ] Registry migration is qualified by manifest/config digest comparisons, anonymous pulls, rendered bundles, and exact-head CI. Prod receives no write from this lane.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**: read common/master/workflow rules, create origin/main worktree, pass harness branch check, enumerate references and credential names without values.
- [ ] **Lot 1 — Delivery**: GHCR-only registry configuration, GITHUB_TOKEN packages:write, immutable tested-byte publication and public visibility evidence.
- [ ] **Lot 2 — Preservation**: read named live prod Deployments; remote-copy recovery api:f2313a/ui:434fe5, live prod digests and candidate 165ce5b93; record source=destination digests and remove temporary source access.
- [ ] **Lot 3 — References**: migrate base/prod/preprod/A4, identity-sync, OAuth job, artifact-content, tests and historical docs; remove public-image pull-secret references.
- [ ] **Lot 4 — Guard and scoped checks**: repository-wide forbidden-host guard including hidden tracked files; existing image/release receipt suites; identity/artifact/A4 render suites; workflow contract tests. Reuse existing container images only.
- [ ] **Lot 5 — Review/CI/handoff**: independent final-diff review; one READY PR and attempt-1 CI green; exact prod adoption procedure and approval requirement; .tmp/rv/ghcr-migration.md; make down-volumes cleanup. Conductor merges and owns Track import.
