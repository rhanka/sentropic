# Feature: Prod A4 operator path (T1 prod A4 prerequisite)

## Objective
- [ ] Give the prod namespace `sentropic` the same fenced A4 operator procedure as preprod: tier-parameterized operator (`A4_TIER`), shared `components/a4-wiring`, `overlays/prod-a4`, prod S2S issuer/resource, tier-bound email-code HMAC ring names and product verifier, and a prod runbook (inventory 3.1.1, 3.1.5, 3.1.8).

## Scope / Guardrails
- [x] Branch feat/prod-a4-operator from origin/main c22163106; worktree tmp/worktrees/t1-prod-a4-operator; ENV=test-t1-operator; API_PORT=9283 UI_PORT=5483 MAILDEV_UI_PORT=1183 (no stack started by this wagon); never ENV=dev; end with `make down-volumes ENV=test-t1-operator` if a stack was started.
- [x] Make-only; no Python; no attribution trailers; no version bump, lock or fixture regeneration (train lane); no PR (train T1 assembles).
- [x] Preprod behavior unchanged: every preprod format, namespace, ring ref and verifier keeps working (existing tests only gain `A4_TIER=preprod`).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/ci/preprod-a4/**`
  - `deploy/ci/artifact-content/tests.mk`
  - `deploy/k8s/components/a4-wiring/**`
  - `deploy/k8s/overlays/preprod-a4/kustomization.yaml`
  - `deploy/k8s/overlays/preprod/a4-runtime/launch.mjs`
  - `deploy/k8s/overlays/prod/kustomization.yaml`
  - `deploy/k8s/overlays/prod/patch-api-config.yaml`
  - `deploy/k8s/overlays/prod-a4/**`
  - `api/src/scripts/cm-preprod-checkpoint.ts`
  - `api/src/scripts/cm-preprod-contract.ts`
  - `api/src/scripts/cm-preprod-state.ts`
  - `api/tests/unit/auth/cm-preprod-*.test.ts`
  - `docs/runbooks/prod-a4-cutover.md`
  - `docs/runbooks/preprod-a4-cutover.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `ui/**`
  - `packages/**`
  - `api/drizzle/**`
  - `api/**` (except the listed scripts and unit tests)
  - `deploy/**` (except the listed paths)
  - `.github/workflows/**`
  - `scripts/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None required.
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] None.

## AI Flaky tests
- Acceptance rule: Accept only non-systematic provider/network/model nondeterminism as `flaky accepted` (at least one success on the same commit and command). Not applicable so far.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**
- Rationale: T1 wagon; the train lane merges it with the other wagons into one train branch with one PR and one CI.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Tier-parameterized operator**
  - [x] `guards.mjs`: `tiers` map (tier/namespace/origin), `tierOf(env)` fail-closed, `kubectl(config, args, input, namespace)` namespace-allowlisted, `assertAuthorization`/`assertRequest` tier-bound (format + namespace + `emailCodeActiveKeyRef` ring tier).
  - [x] `execution.mjs`, `run.mjs`, `ops.mjs`, `verify.mjs`, `verification-boundary.mjs`: every call runs in the tier namespace; health probe uses the tier origin.
  - [x] `targets.mk`: `k8s-prod-a4-{action,verify,custody,prepare}` twins; `export override A4_TIER` fixed by the target name (never overridable); manifests render covers `prod-a4`.
- [x] **Lot 2 — Shared wiring and prod overlay**
  - [x] A4 patches move `overlays/preprod-a4/*.yaml` → `components/a4-wiring/` (+ `CM_A4_NAMESPACE` downward-API env on api and auth-idp); `preprod-a4` consumes the component; `custody-pvc.yaml` drops the hardcoded namespace.
  - [x] New `overlays/prod-a4` (namespace `sentropic`, same wiring + runtime, live prod pins until the cutover IaC change).
  - [x] `overlays/prod/patch-api-config.yaml`: prod S2S `OAUTH_SERVICE_ISSUER_URL`/`OAUTH_SERVICE_RESOURCE_URI` (A4 release only).
- [x] **Lot 3 — API contract tier and ring per tier**
  - [x] `cm-preprod-contract.ts`: `a4Tier(namespace)`, `prod-a4-*` formats, tier-cross-check on format/namespace/`emailCodeActiveKeyRef`.
  - [x] `launch.mjs`: ring tier follows the pod namespace (`CM_A4_NAMESPACE`); unknown or foreign namespace refused.
  - [x] `inspectPreprod` verifier follows the request namespace (prod: `sent-tech.ca`).
- [x] **Lot 4 — Prod runbook**
  - [x] `docs/runbooks/prod-a4-cutover.md`: bindings table, prerequisites (T1/T1-ops/T2 gates, tenant checks, G7 stopped), execution, post-verification IaC change, A5 acceptance.
  - [x] `docs/runbooks/preprod-a4-cutover.md`: canonical-procedure pointer, tier-bound inputs, request `emailCodeActiveKeyRef` row.
- [ ] **Lot 5 — Validation**
  - [ ] `docker-slot.sh make test-preprod-a4 ENV=test-t1-operator` (node suite incl. `tier.test.mjs`).
  - [ ] `docker-slot.sh make test-preprod-a4-manifests ENV=test-t1-operator` (renders prod/preprod/preprod-a4/prod-a4 + bundle selftests).
  - [ ] `docker-slot.sh make test-preprod-a4-api ENV=test-t1-operator` (typecheck, lint, build, bundle CLI check).
  - [ ] `docker-slot.sh make test-artifact-content-manifests ENV=test-t1-operator` (renders preprod-a4 + prod-a4).
  - [ ] Argon read-only review `.h2a/reviews/t1-feat-prod-a4-operator-argon.md` (Opus unavailable: quota; resume lane).
