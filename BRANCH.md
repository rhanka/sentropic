# Feature: Enable MCP resource server in preprod (rollout condition A)

## Objective
Rollout condition A for owner UAT of the Gmail/Drive MCP resource server (L4, PR #489): set `MCP_RESOURCE_SERVER_ENABLED: "true"` in the preprod api ConfigMap so the surface (OFF by default, `api/src/routes/api/mcp.ts`) is exposed in preprod only. Overlay-only change — API_VERSION stays `b98669`, no new image publish required.

## Scope / Guardrails
- Scope limited to `deploy/k8s/overlays/preprod/patch-api-config.yaml` (one ConfigMap key) + `BRANCH.md`.
- No app code, no image, no prod change. Prod stays default-off.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/patch-api-config.yaml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `deploy/k8s/base/**`, `deploy/k8s/overlays/prod/**`
  - `api/**`, `ui/**`, `packages/**`, `Makefile`, `docker-compose*.yml`

## Feedback Loop
- `BR-MCP-FLAG-NOTE1` (deploy-plane): overlay-only ConfigMap change. `kubectl apply -k deploy/k8s/overlays/preprod` updates the ConfigMap but does NOT restart the api pods (Deployment spec unchanged; ConfigMap referenced by name, api image tag stays `b98669`). poc-k8s must run a one-time `kubectl rollout restart deploy/api -n sentropic-preprod` (preprod-scoped KUBECONFIG) to apply. Verify: `GET https://preprod.sentropic.sent-tech.ca/api/v1/mcp/.well-known/oauth-protected-resource` returns 200 (was 404). Status: acknowledge.

## Lot 1 — enable the flag
- [x] Add `MCP_RESOURCE_SERVER_ENABLED: "true"` to the preprod api ConfigMap patch (with rollout-restart note)
- [ ] Merge (conductor gates) → poc-k8s `kubectl apply -k` + `rollout restart deploy/api -n sentropic-preprod`
- [ ] Verify PRM well-known 200 in preprod
