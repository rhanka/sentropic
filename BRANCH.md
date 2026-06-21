# BR-55a — k8s deploy: kustomize base + overlays/prod (drop K8S_INGRESS gate)

## Objective
First implementation lot of the deployment-plane (ARCH-17 / BR-55, ratified in
`spec/SPEC_DECISION_DEPLOYMENT_PLANE.md`). Refactor `deploy/k8s/` from flat numbered
manifests into a **kustomize base + `overlays/prod`**, move the ingress into the overlay
(removing the `K8S_INGRESS=1` gate), and switch `make k8s-deploy` to `kubectl apply -k`.
Operator-independent; faithful (no prod change) — unblocks preprod/validation overlays
(BR-55b/e) and per-release image pinning (BR-55c/d).

## Scope / Guardrails
- Make-only, Docker-first. English. Prod-faithful: NO change to the live cluster.

## Branch Scope Boundaries
- **Allowed**: `deploy/k8s/**`, `Makefile`, `BRANCH.md`
- **Forbidden**: everything else.
- **BR55a-EX1** (Makefile, default-forbidden): `k8s-deploy`/`k8s-undeploy` must switch from
  per-file `kubectl apply -f` (+ the K8S_INGRESS conditional) to `kubectl apply -k deploy/k8s/overlays/prod`.
  Impact: those two targets only. Rollback: revert the targets to the per-file applies.

## Plan / Todo
- [x] `git mv` 10/15/20/30/35/40/70 → `deploy/k8s/base/`, strip `metadata.namespace` (overlay sets it).
- [x] `git mv` 60-ingress → `deploy/k8s/overlays/prod/ingress.yaml` (namespace stripped).
- [x] `base/kustomization.yaml` (resources) + `overlays/prod/kustomization.yaml` (`namespace: sentropic`, base + ingress; image pins deferred to BR-55c/d).
- [x] Makefile `k8s-deploy`/`k8s-undeploy` → `kubectl apply -k` / `delete -k`; K8S_INGRESS gate removed.
- [x] README updated (kustomize layout + ingress-in-overlay; gate gone).
- [x] **GATE: zero-diff** — `kubectl kustomize deploy/k8s/overlays/prod | kubectl diff -f -` against the LIVE cluster = EMPTY (exit 0) → refactor is faithful, prod unchanged.
- [ ] PR → CI green → merge. (Image still `:main`, matching live; BR-55c/d pin per-release.)

## Deferred (later BR-55 lots)
- Per-release immutable image pin in the overlay (BR-55c/d).
- preprod / validation overlays + the cross-repo poc-k8s baselines (BR-55b0/b/e, gated on OQ0, issue #341).
- README's older env-specific runbook examples still show `K8S_INGRESS=1` (now an ignored no-op; superseded by the new "Layout" note) — full doc sweep deferred.
