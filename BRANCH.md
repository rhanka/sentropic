# Feature: A-LIVE W2 sentropic-side egress policies (wagon feat/alive-netpol, train 1b)

## Objective
- [ ] Pin the Sentropic share of the W2 policy split (plan r3.6/r3.7): `artifact-content` egress TCP 5173 to labelled workers, and the API controller's egress to the npm relay :4873 and the Kubernetes API, in the preprod and prod overlays, with the default-deny intact.
- [x] Add the A-LIVE W9 live edge ingress: `artifact-content` TCP 8791 from the same-environment immo content host (`radar-api` reader pods), `radar-immobilier` -> `sentropic` and `radar-immobilier-preprod` -> `sentropic-preprod`, with a render test.
- [x] Pin the SG4b handoff egress: the API reaches the same-environment immo ingress on TCP 443 (platform Traefik LB, in-cluster websecure 8443 hop) in both overlays, without an API Egress policy.

## Scope / Guardrails
- [x] Branch feat/alive-netpol from origin/main 3f1027496; worktree tmp/worktrees/alive-netpol; ENV=test-alive-netpol.
- [x] Live edge fix lane: ENV=test-netpol-fix.
- [x] Wagon only: no PR, no version bump, no lock or manifest regeneration.
- [x] Make only; no Python, attribution trailers, CI skips, reruns or CI polling.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/ci/artifact-content/network.selftest.mjs`
  - `deploy/ci/artifact-content/bundle.selftest.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/**`
  - `deploy/k8s/base/**`
  - `deploy/k8s/overlays/**`
- **Conditional Paths (allowed with declared exception)**:
  - `deploy/k8s/README.md` under BR88N-EX1.
  - `deploy/k8s/overlays/prod/artifact-content-live-edge-networkpolicy.yaml`, `deploy/k8s/overlays/preprod/artifact-content-live-edge-networkpolicy.yaml` and the matching `resources` line in both overlay `kustomization.yaml` files under BR88N-EX2.

## Feedback Loop
- [x] BR88N-EX1: `deploy/k8s/README.md` documents the egress posture. Reason: operators and k8s need the rule that an API Egress policy isolates the API. Impact: documentation only, no rendered object changes. Rollback: revert the README hunk.
- [x] BR88N-EX2: one additive Ingress NetworkPolicy per overlay for the W9 live edge. Reason: s-archi netpol review add 1 and W9 review item 4; immo's content host must reach `artifact-content` internally. Impact: `artifact-content` TCP 8791 admits only the same-environment `radar-api` pods; no other object changes. Rollback: delete both policy files and their `resources` lines.
- [ ] attention: the immo content host is the `radar-api` reader pod (labels from radar-immobilier origin/main cc9f7ce2c `deploy/k8s/30-api.yaml`). If W10 moves it to a dedicated component, this selector must follow. The immo egress side is owned by k8s and immo.
- [x] attention: the API Egress policy is not added. The app namespaces carry an ingress-only default-deny (poc-k8s contract and live, 2026-11-07), so an API Egress policy limited to the relay and the Kubernetes API would cut Postgres, DNS, the IdP and providers. The tests pin the controller paths instead.
- [x] attention: `artifact-content` egress to workers on TCP 5173 is already on main (fdd3e6164) and already qualified; this wagon keeps it unchanged.
- [x] attention: the SG4b handoff egress (API -> immo ingress TCP 443) needs no policy because the API is not egress-isolated; the tests pin the LB 443 path and the in-cluster Traefik websecure 8443 hop.
- [ ] attention: the prod worker namespace is not named yet (k8s K1-prod), and `BUILDER_NAMESPACE` is fixed in `api/src/services/artifacts/live/pods.ts`. Prod content egress still targets `sentropic-artifact-builders`.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: wagon branch integrated by the train 1b lane, one CI per train.

## UAT Management (in orchestration context)
- [ ] No UI change; acceptance is the train CI and the Q1 deny probes.

## Plan / Todo (lot-based)
- [x] Lot 0: baseline `make test-artifact-content-manifests ENV=test-alive-netpol` green on main.
- [x] Lot 1: controller egress reachability, open-policy guard and API-isolation rejection cases; README posture; `make test-artifact-content-manifests ENV=test-alive-netpol` 127 PASS, 0 failures (31/31 node tests).
- [x] Lot 2: W9 live edge ingress per overlay; exact-shape, mutation and reachability tests; `make test-artifact-content-manifests ENV=test-netpol-fix` 140 PASS, 0 failures (31/31 node tests).
- [x] Lot 3: SG4b handoff egress reachability and an API-allowlist rejection case; README note.
- [ ] Lot N: push the wagon branch; train 1b integrates it.
