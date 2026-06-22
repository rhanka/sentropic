# Feature: Preprod kustomize overlay + isolated preprod tier (BR-55b / ARCH-17)

## Objective
Materialize the PREPROD tier of the deployment-plane (SPEC_DECISION_DEPLOYMENT_PLANE.md, RATIFIED) as a `deploy/k8s/overlays/preprod/` kustomize overlay that mirrors `overlays/prod` but targets the isolated `sentropic-preprod` namespace (baseline owned by poc-k8s, k8s-ops #37/#39): re-stamps the shared `base/` (rbac, networkpolicy, postgres, api, auth-idp, ui, pgbackup) into `sentropic-preprod`, adds the preprod public ingress (D4 NESTED hosts `preprod.sentropic.sent-tech.ca` → ui + `preprod.auth.sent-tech.ca` → auth-idp), and patches the non-secret api/auth-idp ConfigMaps to the preprod hosts + an ISOLATED WebAuthn RP ID (D11R: preprod = synthetic users, distinct RP ID, fully isolated from prod). Realizes D1 (separate preprod ns), D3 (separate preprod Postgres = base StatefulSet re-stamped → own PVC), D6 (per-tier distinct secrets). EXPLICITLY OUT: `cd.yml` main→preprod auto-deploy + the publish-only staleness fix (BR-55c), `release-prod.yml` + D7/D8/D9 (BR-55d), the validation tier + federation + scrub import + D15 (BR-55e). The per-ns SealedSecrets (distinct KEK/DB/signing-keys, D6) are operator-authored by poc-k8s per ns (like prod 05/06/07), coordinated here, NOT authored in this PR. ZERO change to `overlays/prod` or `base` (prod must not move — the decoupling invariant).

## Scope / Guardrails
- Scope limited to a NEW `deploy/k8s/overlays/preprod/` overlay + the README doc; no change to `base/` or `overlays/prod/`.
- Mirror the proven `overlays/prod` pattern line-by-line; diverge only where the tier requires it (namespace, hosts, RP-ID isolation).
- Make-only workflow; no direct Docker commands; kustomize render validation only (no live apply from this branch — preprod deploy lands with cd.yml in BR-55c).
- NEVER touch prod: the preprod overlay is additive; `kubectl apply -k overlays/prod` output must be byte-identical before/after.
- Root `ENV=dev` reserved for the user. This branch ships only static manifests (no dev stack).
- Ports (branch nn=55, slot 0): API `9275`, UI `5475`, Maildev UI `1375` — allocated by convention, UNUSED (manifests-only branch, no `make dev`).
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `deploy/k8s/overlays/preprod/**` (new overlay: kustomization, ingress, ConfigMap patches)
  - `deploy/k8s/README.md` (document the preprod overlay alongside prod)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `deploy/k8s/base/**` (shared base — re-stamped, never mutated by a tier)
  - `deploy/k8s/overlays/prod/**` (prod must not move — the decoupling invariant)
  - `.github/workflows/**` (`cd.yml` main→preprod = BR-55c; `release-prod.yml` = BR-55d)
- **Conditional Paths (allowed only with explicit BR55b-EXn exception)**:
  - none anticipated (kustomize render validated without a Makefile target; if one is genuinely needed → BR55b-EX with rationale)

## Feedback Loop
- `acknowledge` (BR55b-FORK-1 — hosts D4, architect-confirmed): D4 RATIFIED = NESTED → 2 ingresses `preprod.sentropic.sent-tech.ca` (ui) + `preprod.auth.sent-tech.ca` (auth-idp), mirroring prod. Architect (ARCH-17) confirmed NESTED, no owner simplification post-D4; poc-k8s's casual FLAT `preprod.sent-tech.ca` answered an erroneous ACK (poc-k8s does not own naming). Built NESTED; poc-k8s to be corrected on the DNS records (two A records) at ingress-ready ping.
- `acknowledge` (BR55b-FORK-2 — WebAuthn RP-ID isolation, architect verdict = (b), CODE-VERIFIED): architect grepped origin/main — the api runs a LIVE WebAuthn path (`webauthn-adapter.ts`, `webauthn-authentication.ts:89,209`, `webauthn-config.ts:36` reads WEBAUTHN_RP_ID, routes register/login/credentials) → option (c) "vestigial" was FALSE. Verdict (b): api `WEBAUTHN_RP_ID=preprod.sentropic.sent-tech.ca` (registrable suffix of its origin + isolated from prod); (a) parent `sent-tech.ca` REJECTED (not isolated). auth-idp `WEBAUTHN_RP_ID=preprod.auth.sent-tech.ca`. Two distinct RP IDs, each isolated from prod; preprod users synthetic so cross-surface passkey non-portability is a non-issue. Architect escalated to 39etc IN PARALLEL (non-blocking): the api's live WebAuthn path contradicts the pure BR-39 IdP-standalone model — if a migration removes WebAuthn from the api, preprod flips to (c); else (b) holds.
- `acknowledge` (poc-k8s handoff): #37+#39 MERGED on k8s-ops main — ns `sentropic-preprod`+`sentropic-validation` live (quota/limitrange/netpol default-deny + `sentropic-registry` pull-secret); per-tier creds `KUBE_CONFIG_DATA_PREPROD/VALIDATION` (namespace-scoped, prod inaccessible) for BR-55c. Shared Traefik LB 51.159.11.157 + cert-manager `letsencrypt-prod`. poc-k8s posts the Cloudflare A record(s) on my ingress-ready ping.
- `acknowledge` (D6 secret boundary): distinct KEK/DB/signing-key SealedSecrets are operator-authored per ns by poc-k8s (mirrors prod 05/06/07, intentionally not in repo tooling) — coordinated, not authored in this PR.
- `acknowledge` (no Namespace / netpol re-stamp): base has NO Namespace resource and its `allow-traefik-to-{ui,auth-idp}` netpols are ns-agnostic (namespaceSelector `traefik`) → `namespace: sentropic-preprod` transformer + base netpols suffice; no `$patch:delete`, no extra netpol.

## AI Flaky tests
- N/A — manifests-only branch; validation is `kustomize build` render correctness + prod zero-diff, no test suite.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one cohesive overlay addition; single render-validation cycle)
- [ ] **Multi-branch**
- Rationale: a single additive overlay, no independent sub-workstream.

## UAT Management (in orchestration context)
- No UI surface in this PR. Validation = `kustomize build overlays/preprod` renders cleanly + `overlays/prod` render byte-identical before/after (prod-untouched proof). Live preprod bring-up + smoke is exercised by BR-55c (`cd.yml`) once the overlay merges.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Worktree `tmp/deploy-preprod` from `origin/main` (1c6867942, post-#352); `cp ../../.env .env`.
  - [x] Read SPEC_DECISION_DEPLOYMENT_PLANE.md + base/overlays-prod manifests FROM the worktree.
  - [x] Co-design packet to architect (FORK-1 hosts, FORK-2 RP-ID, C1–C5) — ARCH-17 accountability.

- [x] **Lot 1 — preprod overlay (architect FORK verdicts in hand)**
  - [x] `overlays/preprod/kustomization.yaml`: `namespace: sentropic-preprod`; resources `../../base` + `ingress.yaml`; `patches` (strategic-merge) for the api + auth-idp ConfigMaps.
  - [x] `overlays/preprod/ingress.yaml`: two Ingresses (D4 nested) — `preprod.sentropic.sent-tech.ca` → ui:http, `preprod.auth.sent-tech.ca` → auth-idp:http; cert-manager `letsencrypt-prod`, Traefik websecure.
  - [x] `overlays/preprod/patch-api-config.yaml` + `patch-auth-idp-config.yaml`: preprod host overrides (AUTH_CALLBACK_BASE_URL, OAUTH_ISSUER_URL, UI_BASE_URL, CORS_ALLOWED_ORIGINS) + WebAuthn RP-ID isolation per FORK-2 verdict (b).
  - [x] `deploy/k8s/README.md`: document the preprod overlay (hosts, isolation, operator secret boundary).

- [ ] **Lot N — Final validation**
  - [x] `kubectl kustomize overlays/preprod` renders without error; asserted ns (22× sentropic-preprod, 0 prod leak) + 2 nested hosts + isolated RP-IDs (api=preprod.sentropic, idp=preprod.auth) + api CM merge (12 base keys preserved + 3 overrides).
  - [x] Prod zero-diff: `kubectl kustomize overlays/prod` builds, hosts unchanged (sentropic/auth.sent-tech.ca), ns=sentropic — base/prod untouched.
  - [ ] PR with `BRANCH.md` body; CI green.
  - [ ] **HOLD merge for architect ARCH-17 sign-off** (FORK-1 + FORK-2 resolved); on GO + CI green: remove BRANCH.md, push, merge (D2 preprod-only). Then ping poc-k8s for the Cloudflare A record(s) + report conductor for track.
