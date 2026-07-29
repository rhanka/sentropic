# Fix: CI preprod deploy image-existence guard

## Objective
- [x] Stop `deploy-preprod` from applying an image tag that was never pushed to the registry (silent ImagePullBackOff on sentropic-preprod on every main push). Assert both content-hash image manifests exist BEFORE `kubectl apply` — a control that PREVENTS, not one that DETECTS after the cluster fails.

## Scope / Guardrails
- [x] CI-only, single file `.github/workflows/ci.yml` (job `deploy-preprod`). No app code, no infra, no prod change.
- [x] Reuses existing `make check-api-image` / `check-ui-image` (docker manifest inspect || exit 1) with the same `$(API_VERSION)`/`$(UI_VERSION)` the deploy pins, and the same registry creds as the publish jobs (`DOCKER_USERNAME=nologin`, `DOCKER_PASSWORD=SCW_SECRET_KEY`).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `BRANCH.md`, `.github/workflows/ci.yml`.
- **Forbidden Paths**: everything else.
- **Conditional Paths**: none.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**

## Provenance
- [x] Root cause reported by `claude:poc-k8s` during SCW→OVH migration: my CI deployed `sentropic-api:d02a22` (NotFound) → preprod 502 on every push. Requested control = assert manifest exists before set image. Owner GO (2026-07-28) to fix it myself (bounded fix in my own ci.yml, distinct from the GHCR migration routed to the architect).

## Plan / Todo (lot-based)
- [x] **L0 — Add the guard step** in `deploy-preprod`, after kubeconfig decode, before deploy: `make check-api-image check-ui-image` with the registry creds; fail loud if either manifest is absent.
- [x] **L1 — Validate**: ci.yml parses as YAML; step ordering = checkout → decode kubeconfig → assert images → deploy.

## Feedback Loop
- [x] The changes-filter `api`/`ui` already SUPERSET the `API_VERSION`/`UI_VERSION` input paths (verified), so this is NOT a filter-mismatch case. The exact reason `d02a22` was pinned without a push (publish skip/failure vs tag derivation) is not fully root-caused from CI logs; the guard is the catch-all that turns any such case into a loud CI failure instead of a silent preprod breakage.
- [ ] Follow-up (deploy-plane / architect): the digest-pin from the GHCR migration binds deploy↔push at the root; this guard is the interim preventive control.

## Final validation
- [x] YAML valid; single-file additive change (+14 lines); no forbidden path touched.
- [ ] After merge to main (owner-gated): a main push triggers publish (build+push current images) then deploy-preprod's guard passes → preprod deploys → poc-k8s re-verifies 200.
