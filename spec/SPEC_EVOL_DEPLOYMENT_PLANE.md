# SPEC_EVOL_DEPLOYMENT_PLANE — main→preprod CD + tag→prod promotion (matchID-style)

Status: STUDY (design + decisions), ARCH-17, BR-55, scope: foundations, draft
<DATE> (2026-06). This is a design study, NOT an implementation: it carries no
workflow YAML, no Makefile changes, no manifests — only the target design and
the decisions to ratify. Implementation is split into follow-up BRs (section 7).

Low design risk: this is a **port of the matchID deployment pattern**
(`/home/antoinefa/src/matchID/matchID/.github/workflows/`: `cd.yml`,
`release-prod.yml`, `cd-k8s.yml`, `k8s-smoke.yml`) onto sentropic's existing
stack. The novel work is sentropic-specific, not the pipeline shape.

## 1. Objective + ratified decoupling

Replace sentropic's **manual** k8s production deploys with a two-stage,
matchID-style pipeline:

- **merge to `main` → auto-deploy to PREPROD** (continuous delivery, no human
  gate). Same artifact that passed CI on the merge commit lands on a preprod
  namespace within minutes.
- **a RELEASE TAG → promote the SAME artifact to PROD**, gated by an explicit
  rhanka signature + recette attestation. Prod never rebuilds; it re-points at
  the byte-identical image already running in preprod.

This is the owner-ratified decoupling already recorded in the role-structure
decision (MEMORY: *Role structure h2a*, RATIFIED rhanka 2026-06-11):
> "Prod/main decoupling: main→preprod CD, prod=gated same-artifact promotion +
> rhanka signature; loose-coupling semver vN/vN+1 for auth/foundation/ui↔apps."

The deployment plane makes that ratified policy executable. It does **not**
re-open the policy; it implements it.

## 2. Why now (the concrete pain)

Today, merging to `main` does NOT update production. The CI image-publish and
k8s-deploy stages are gated and skip on every real main merge (section 3), so a
human must build, push, and `make k8s-deploy` by hand. The cost is live and
current:

- **PR #316 (auth-ui 0.4.0, DS-native IdP) and #319 are merged to `main` but
  NOT live on `auth.sent-tech.ca`** — because CI did not publish the `:main`
  image alias and `deploy-k8s` was skipped, so the running pods still serve the
  pre-#316 image. Closing this gap is the entire point of ARCH-17.

## 3. Current state (gaps, with file refs)

### 3.1 One workflow does everything; publish + deploy are gated off
- A single `.github/workflows/ci.yml` runs validation, build, test, publish, and
  deploy. There is no `cd.yml`/`release-prod.yml` split.
- `publish-api-image` (`ci.yml:1082`) and `publish-ui-image` (`ci.yml:1046`)
  push `${REGISTRY}/sentropic-{api,ui}:${VERSION}` (a content sha-hash, see
  `Makefile:34-35` `API_VERSION`/`UI_VERSION`) plus a moving `:main` alias
  (`ci.yml:1072-1080`, `ci.yml:1108-1116`). They are gated on
  `needs.changes.outputs.{api,ui}=='true' && github.ref=='refs/heads/main'` and
  chained behind the full e2e/security gauntlet — on recent merges they did not
  run, so `:main` is stale.
- `deploy-k8s` (`ci.yml:1405`) `needs: [publish-api-image, publish-ui-image]`
  and runs `make k8s-deploy ... ENV=ci-k8s`. Because it depends on the (skipped)
  publish jobs and applies plain manifests, **it is SKIPPED on every main run**
  → production is deployed MANUALLY.

### 3.2 Single namespace, no preprod, no overlays
- One namespace `sentropic` (+ `sentropic-remote` for remote agents). No
  preprod namespace exists.
- Plain manifests in `deploy/k8s/`: `10-rbac`, `15-networkpolicy`, `20-postgres`,
  `30-api`, `35-auth-idp`, `40-ui`, `60-ingress`, `70-pgbackup-cronjob`. No
  kustomize base/overlay split. `make k8s-deploy` (`Makefile:2448`) applies the
  files in order and `rollout restart`s the deployments.
- Namespace is hard-coded into each manifest (`namespace: sentropic` in every
  `metadata`, e.g. `30-api.yaml:5`, `20-postgres.yaml:5`, `60-ingress.yaml:16`)
  — there is no namespace parameterization to retarget at preprod.

### 3.3 Moving tag, not digest promotion
- Deployments pull the **moving `:main` tag** (`30-api.yaml:78`,
  `35-auth-idp.yaml:98`, and the ui deployment) with `imagePullPolicy: Always`.
  There is no immutable digest pinning and no "promote the exact artifact"
  concept — a pod restart can silently pick up a different `:main`.

### 3.4 The api image bundles the IdP; api+IdP+UI all share one DB
- The `sentropic-api` image **bundles the auth-idp entrypoint and its static
  login/consent screens** (`35-auth-idp.yaml:1-12,98-103`): auth-idp runs from
  the SAME image via a `command:` override (`node apps/auth-idp/dist/index.js`,
  `workingDir: /workspace`). One image artifact = both api and IdP.
- The **api pod owns DB migrations at boot** (`35-auth-idp.yaml:9-12`: the IdP
  "runs NO migration"). api, auth-idp, and ui (nginx → /api) all hit the SAME
  in-cluster `postgres` StatefulSet (`20-postgres.yaml`) and share the
  `sentropic-api` Secret (incl. `OAUTH_SIGNING_KEK`, which MUST be identical
  across api and IdP — `35-auth-idp.yaml:10-12`).

### 3.5 Secrets: one bundle, no per-env separation
- A single `.env` feeds `make k8s-bundle-secret` (`Makefile:2478`) which
  `kubectl create secret` the namespace Secrets (`sentropic-postgres`,
  `sentropic-api`). In prod the live IdP runs from a **SealedSecret** (MEMORY:
  *BR-39 full roadmap* — main history was rewritten to purge SealedSecret blobs,
  redeployed via PR #254). There is no per-env (preprod vs prod) secret split.

### 3.6 Platform facts (constraints, not gaps)
- Registry: Scaleway `rg.fr-par.scw.cloud/nc-reg/`. Cluster: SCW `poc-...`.
- Ingress only applied when `K8S_INGRESS=1` (`Makefile:2459-2461`); the
  `60-ingress.yaml` host blocks (`sentropic.sent-tech.ca` `:28`,
  `auth.sent-tech.ca` `:63`) are gated out of the default deploy path.
- TLS via cert-manager `letsencrypt-prod` ClusterIssuer (DNS-01, Cloudflare
  solver, zone `sent-tech.ca`); shared Traefik + SCW LoadBalancer from the
  poc-k8s platform stack. WebAuthn RP ID is the parent domain `sent-tech.ca`
  (portable across every `*.sent-tech.ca` subdomain — `30-api.yaml:23-29`).
- CI already holds a kubeconfig as GH secret `KUBECONFIG_B64`
  (`ci.yml:1413`) and runs `db-backup-prod` against the live cluster
  (`ci.yml:1024-1035`, `Makefile:2027`) — so cluster credentials in CI are an
  established pattern.

## 4. Target design (matchID flow mapped to sentropic)

### 4.1 Pipeline shape (the port)
Three workflows, mirroring matchID:

- **`ci.yml` (unchanged role)** — on `pull_request`: validate, build, test. No
  deploy. (matchID `ci.yml`.) Keep sentropic's existing per-package validation +
  e2e gauntlet here.
- **`cd.yml` (NEW)** — on `push: main` (+ `workflow_dispatch`): build the api +
  ui images at `:${VERSION}` (content hash), push them, then a `deploy-preprod`
  job kustomize-applies the **preprod overlay** to the **`sentropic-preprod`**
  namespace, waits rollout, runs smoke. AUTO, no gate. (matchID `cd.yml` →
  `deploy-dev` on `matchid-dev`.) This is where the current gated/skipped
  `publish-*-image` + `deploy-k8s` logic moves and becomes ungated for preprod.
- **`release-prod.yml` (NEW)** — `workflow_dispatch` ONLY (inputs:
  `release_kind` [app / rollback], `app_ref` default `main`, `final_prod_tag`
  auto-allocated, `attestation`). Resolves the image **already built** at
  `app_ref`, promotes it **by digest** to the **`sentropic-prod`** namespace
  (the existing `sentropic` namespace, see D2), runs comprehensive smoke
  (DB/migration, healthcheck, public healthcheck, TLS), then creates + pushes an
  annotated git **release tag** with metadata. (matchID `release-prod.yml`.)
- **`cd-k8s.yml` (optional, NEW)** — config-only deploy: on `push: main`
  touching `deploy/k8s/**`, re-apply manifests at the current image tags to
  preprod (matchID `cd-k8s.yml`). Useful so manifest tweaks don't require an
  image rebuild. **Deferred to a later lot** (nice-to-have).
- **`k8s-smoke.yml` (optional, NEW)** — validate manifests/overlays in a local
  k3d/k3s cluster on `deploy/k8s/**` changes (matchID `k8s-smoke.yml`). Folds
  into sentropic's existing `security-iac` IaC scan or stands alone. **Deferred.**

### 4.2 Trigger note (workflow split vs single-file)
matchID keeps `ci.yml` PR-only and `cd.yml` main-only. sentropic's current
`ci.yml` is BOTH (`push:main` and `pull_request`, `ci.yml:4-7`). The port moves
the `push:main` responsibilities (build/publish/deploy-preprod) into `cd.yml`
and leaves `ci.yml` as PR-only validation. **No legacy fallback** (MASTER rule):
the gated `publish-*-image`/`deploy-k8s` jobs are DELETED from `ci.yml`, not left
dual-pathed.

### 4.3 Image-digest promotion (build once, promote by digest)
- `cd.yml` builds + pushes `sentropic-{api,ui}:${VERSION}` once and captures the
  **image digest** (`docker buildx ... --metadata-file` or
  `docker manifest inspect`) into the run output / a deploy record.
- Preprod deploys reference the **immutable digest** (or `:${VERSION}`), NOT
  `:main`. The `:main` moving alias is RETIRED for deploy (it may remain as a
  human convenience tag only).
- `release-prod.yml` resolves the digest at `app_ref` and pins prod deployments
  to that **exact digest** — no rebuild. This is the "same artifact" guarantee
  the ratified policy requires. (matchID promotes by resolved image version;
  digest pinning is the stricter sentropic choice — see D5.)

### 4.4 Preprod namespace + overlay (resolve the K8S_INGRESS gate)
- Refactor `deploy/k8s/` into a kustomize **base** (namespace-agnostic) +
  **overlays/preprod** and **overlays/prod**. Each overlay sets `namespace:`,
  the image tag/digest (`images:` transformer, exactly as matchID's
  `cd.yml:721-727` appends), the public hosts, and the env-specific ConfigMap
  values (issuer URLs, WEBAUTHN_ORIGIN, AUTH_CALLBACK_BASE_URL).
- **Move `60-ingress.yaml` INTO the overlays** (preprod hosts in
  `overlays/preprod`, prod hosts in `overlays/prod`). This RESOLVES the
  `K8S_INGRESS=1` gate (`Makefile:2459-2461`): ingress is always part of the
  rendered overlay, not a conditional side-flag. The gate exists today only to
  keep ingress out of non-prod applies — overlays make it structural, so the
  flag is deleted.
- ConfigMap deltas per env (the values that DIFFER between preprod and prod):
  `OAUTH_ISSUER_URL`, `UI_BASE_URL`, `AUTH_CALLBACK_BASE_URL`, `WEBAUTHN_ORIGIN`,
  `CORS_ALLOWED_ORIGINS`, ingress hosts/TLS secret names. `WEBAUTHN_RP_ID` stays
  `sent-tech.ca` in BOTH (parent registrable domain → a passkey enrolled on
  prod stays valid on preprod and vice-versa; this is deliberate, see Risks).

### 4.5 Per-env secrets
- Split the single `.env` → `make k8s-bundle-secret` path into per-env secret
  material (preprod vs prod), keyed by namespace. Prod keeps SealedSecrets
  (existing pattern); preprod gets its own SealedSecret or CI-created secret
  (D6). Critically, **preprod and prod MUST NOT share `OAUTH_SIGNING_KEK` or DB
  credentials** — they are separate trust domains (see D3/D6/Risks).

### 4.6 The api-bundles-IdP fact
- Because api + auth-idp ship in ONE image, a single image promotion moves BOTH
  api and IdP together — this is a feature for the deployment plane (one digest,
  one promotion). The overlay just runs the same image twice (api default CMD +
  IdP `command:` override, as today `35-auth-idp.yaml:103`). No change to the
  bundling; the plane treats `(api,ui)` as the two artifacts and IdP rides the
  api artifact.

### 4.7 Migrations on preprod (the shared-DB hazard)
- The api pod runs migrations at boot against its namespace's postgres. With a
  **separate preprod DB** (D3 recommendation), preprod migrations run first on
  preprod data and are observed there before prod promotion — preprod becomes a
  real migration canary. Boot-migration ordering (api rolls before IdP,
  `Makefile:2453-2456`) is preserved per-namespace.
- Prod promotion of the SAME image re-runs the same migration code at boot on
  prod data. matchID's prod release takes an ES snapshot first
  (`release-prod.yml` `ensure-prod-snapshot`); sentropic's analogue is the
  existing pre-deploy `db-backup-prod` (`Makefile:2027`) — `release-prod.yml`
  MUST back up prod PG before applying (see D7/D8/Risks).

### 4.8 Preprod domains; don't break the live prod IdP
- Preprod gets its own hosts so it never collides with live prod:
  `sentropic-preprod.sent-tech.ca` and `auth-preprod.sent-tech.ca` (D4). Both
  resolve to the same Traefik LB, get their own cert-manager certs + DNS A
  records, exactly as the prod hosts do today (`60-ingress.yaml:8-11,45-46`).
- The live prod IdP `auth.sent-tech.ca` is UNTOUCHED until `release-prod.yml`
  runs an explicit, gated promotion. main merges only ever move preprod hosts.

### 4.9 Smoke + rollback
- **Preprod smoke** (in `cd.yml`, blocking the run's success but not prod):
  rollout Available for api/auth-idp/ui; `/api/v1/health` (api) and `/healthz`
  (IdP, `35-auth-idp.yaml:114`); a public curl through the preprod ingress;
  OIDC discovery `/.well-known/openid-configuration` 200 on the preprod IdP host.
- **Prod smoke** (in `release-prod.yml`, blocking the tag): same set against the
  prod hosts + TLS `certificate/...-tls` Ready + JWKS 200 (mirrors matchID's
  comprehensive smoke `release-prod.yml:577-715`).
- **Rollback**: `release_kind: rollback` promotes the PRIOR prod tag's digest
  (re-pin + rollout) and restores the pre-deploy PG backup if a migration must
  be reverted (D9). matchID rollback restores the prior snapshot
  (`release-prod.yml:117-119`); sentropic's analogue is the PG dump.
- **Release tag**: on prod smoke success, `release-prod.yml` creates + pushes an
  annotated tag carrying metadata (prod tag, app_sha, api/ui digests,
  attestation ref, run id) — matchID `publish-release-prod-metadata`
  (`release-prod.yml:774-844`).

## 5. Decisions to ratify (batched)

Each decision: options + recommendation. Reversible ones can be taken solo;
blocking/irreversible ones (D3 preprod DB, D6 secrets, D7 prod gate) want the
batched-packet owner review.

### Batch A — environment shape

**D1 — Preprod env existence & isolation level.**
- (a) Separate namespace `sentropic-preprod` with its OWN postgres + secrets +
  ingress hosts (full isolation). **[recommended]**
- (b) Same namespace, second set of deployments (cheaper, no isolation).
- (c) Ephemeral per-PR preview envs (most matchID-distant, heaviest).
- Recommendation: **(a)**. Cheapest path to a real CD safety net; matches
  matchID's `matchid-dev` vs `matchid-prod` namespace split. Costs one extra PG
  PVC + quota headroom on the poc cluster (verify headroom before committing).

**D2 — Prod namespace identity.**
- (a) Keep the existing live `sentropic` namespace AS the prod env (overlay
  `overlays/prod` targets `namespace: sentropic`). **[recommended]**
- (b) Rename to `sentropic-prod` (clean symmetry, but a disruptive migration of
  a LIVE namespace — DNS, secrets, PVC).
- Recommendation: **(a)**. Zero-disruption; prod IS the current namespace,
  preprod is the new one. Symmetry is cosmetic and not worth migrating live data.

**D3 — Preprod database.**
- (a) Separate preprod postgres StatefulSet in `sentropic-preprod` (own PVC, own
  data, real migration canary). **[recommended]**
- (b) Shared DB with prod (forbidden: preprod boot-migrations would mutate prod
  schema; a bad migration on a main merge would hit prod data — unacceptable
  given api owns boot-migrations).
- Recommendation: **(a)**. (b) defeats the entire decoupling. Seed preprod from a
  scrubbed prod dump on first init (optional, D8).

### Batch B — naming, tags, artifact

**D4 — Preprod domain naming.**
- (a) `sentropic-preprod.sent-tech.ca` + `auth-preprod.sent-tech.ca`.
  **[recommended]**
- (b) `*.preprod.sent-tech.ca` nested subdomain (needs wildcard cert / extra
  DNS-01 config).
- Recommendation: **(a)**. Flat, consistent with the existing flat hosts; one A
  record + one cert each, reuses the same Cloudflare DNS-01 solver. Needs owner
  validation per MEMORY *No unvalidated naming*.

**D5 — Prod tag policy & image immutability.**
- (a) Date tags `vYYYY.MM.DD.N` (matchID scheme, `release-prod.yml:23,139`) +
  promote by **immutable digest**. **[recommended]**
- (b) Semver `vN.M.P` release tags.
- Recommendation: **(a)** for the deploy/release TAG (operational, date-ordered,
  auto-allocated — matches matchID and the owner's `vN/vN+1` loose-coupling
  framing) PLUS digest pinning for the artifact. npm package semver
  (auth/chat/etc.) is a SEPARATE concern and stays as-is. Confirm date-tag vs
  semver with owner (reversible later).

### Batch C — secrets, migrations, gate (blocking)

**D6 — Per-env secret mechanism.**
- (a) SealedSecrets per namespace (prod keeps current SealedSecret; preprod gets
  its own sealed material committed to the repo). **[recommended]**
- (b) CI-created secrets from GH secrets at deploy time (matchID style, e.g.
  `release-prod.yml:449-484` `make ... -secrets`).
- (c) External secrets operator.
- Recommendation: **(a)** to stay consistent with the existing prod SealedSecret
  flow and keep secrets out of CI logs; (b) acceptable for preprod-only if
  SealedSecrets tooling friction is high. HARD requirement either way: preprod
  and prod get DISTINCT `OAUTH_SIGNING_KEK` + DB creds (separate trust domains).

**D7 — Prod-promotion gate: how rhanka's signature is captured.**
- (a) GitHub `production` Environment with required reviewer = rhanka; the
  `release-prod.yml` deploy job is environment-gated so the run pauses for
  rhanka's approval in the GH UI (native, auditable, no extra infra).
  **[recommended]**
- (b) h2a `h2a_sign` signature recorded as a release input/attestation artifact
  (richer provenance, ties into the role-structure decision-authority policy).
- (c) Manual `workflow_dispatch` only (weakest: anyone with dispatch can run).
- Recommendation: **(a)** as the enforceable gate, OPTIONALLY carrying a (b) h2a
  signature reference as the `attestation` input for provenance. (c) alone is
  insufficient for prod. matchID uses (c) — sentropic strengthens it because the
  ratified policy requires "rhanka signature + recette attestation".

**D8 — Prod migration safety on promotion.**
- (a) `release-prod.yml` runs `db-backup-prod` (`Makefile:2027`) BEFORE applying,
  uploads the dump as a run artifact, then promotes. **[recommended]**
- (b) No pre-deploy backup (rely on the nightly `70-pgbackup-cronjob`).
- Recommendation: **(a)**. matchID snapshots before prod release; sentropic must
  too — boot-migrations are irreversible without a fresh backup. Reuse the
  existing `db-backup-prod` + `db-restore` targets.

**D9 — Rollback strategy.**
- (a) `release_kind: rollback` re-pins the prior prod tag's digest + restores the
  pre-deploy PG dump if needed. **[recommended]**
- (b) App-only rollback (re-pin digest, never touch DB — only safe for
  non-migrating releases).
- Recommendation: **(a)** as the full capability, with (b) as the fast path when
  a release carried no migration (record `migration: none` in the release tag
  metadata to enable it).

### Batch D — ownership

**D10 — Who owns ARCH-17 / BR-55.**
- (a) Foundations lane (the deployment plane is platform plumbing). **[recommended]**
- (b) Scale program (it's adjacent to the app-foundry / k8s-ops contract).
- Recommendation: **(a)** builds it; coordinate with **scale** because the
  deferred multi-cloud + PaaS `k8s-ops` contract (MEMORY *Scale program*) will
  later consume the same overlay/promotion primitives. Keep the overlay structure
  provider-neutral (`k8s-*`, not `scw-*`) per MEMORY *No unvalidated naming*.

## 6. Open questions for rhanka / scale

- **OQ1 (poc cluster headroom).** Does the poc-k8s cluster have quota/PVC
  headroom for a full second namespace (preprod postgres + api + IdP + ui)? D1(a)
  assumes yes; needs a `kubectl describe quota` check before the env-creation BR.
  (auth-idp was sized specifically to fit existing headroom — `35-auth-idp.yaml:134-137`.)
- **OQ2 (preprod data seeding).** Seed preprod PG from a scrubbed prod dump, or
  start empty? (Affects whether preprod is a faithful migration canary.)
- **OQ3 (gate mechanism).** D7: GH `production` Environment reviewer vs h2a
  `h2a_sign` attestation — which is the SOURCE OF TRUTH for "rhanka signed"? Does
  the role-structure decision-authority policy (D0/D1/D2, MEMORY) mandate the h2a
  path?
- **OQ4 (recette attestation).** The ratified policy says "+ recette
  attestation". What artifact represents recette sign-off — a track
  VerificationRun ref, an h2a attestation, a manual checklist? It should be a
  required input to `release-prod.yml`.
- **OQ5 (preprod WebAuthn).** Sharing `WEBAUTHN_RP_ID=sent-tech.ca` across
  preprod and prod means passkeys are cross-valid. Acceptable, or should preprod
  use a distinct RP ID to fully isolate auth state? (Distinct RP ID breaks
  passkey portability but isolates preprod auth — trade-off for owner.)
- **OQ6 (cd-k8s + k8s-smoke).** Are the config-only deploy and k3d manifest-smoke
  workflows in scope for the first BRs, or deferred as section 4.1 proposes?

## 7. Implementation plan (BRs AFTER this study)

Sequenced; each is a normal scoped branch with `BRANCH.md`. This is a PORT of
matchID → low design risk; the risk is sentropic-specific wiring, not pipeline
shape.

- **BR-55a — Kustomize base/overlay refactor + K8S_INGRESS resolution.**
  Split `deploy/k8s/` into base + `overlays/{preprod,prod}`; move ingress into
  overlays; delete the `K8S_INGRESS` flag (`Makefile:2459-2461`). No behaviour
  change to prod (overlays/prod renders byte-equivalent to today's apply).
  Validate via k3d render (matchID `k8s-smoke.yml`).
- **BR-55b — Preprod environment.** Create `sentropic-preprod` namespace,
  preprod postgres + SealedSecret, preprod DNS + certs
  (`sentropic-preprod` / `auth-preprod`). One-time infra BR.
- **BR-55c — `cd.yml` (main→preprod CD).** New workflow: build/push images at
  `:${VERSION}` + capture digest, deploy preprod overlay by digest, smoke.
  DELETE the gated `publish-*-image`/`deploy-k8s` jobs from `ci.yml`; trim
  `ci.yml` to PR-only validation. **This BR alone fixes the #316/#319 staleness
  pain** (preprod becomes always-current).
- **BR-55d — `release-prod.yml` (tag→prod promotion).** New workflow:
  `workflow_dispatch`, gated by D7 (`production` Environment + rhanka), pre-deploy
  `db-backup-prod`, promote SAME digest to prod, comprehensive smoke, create +
  push annotated release tag with metadata. Implements rollback (D9).
- **BR-55e (optional, deferred) — `cd-k8s.yml` + `k8s-smoke.yml`.** Config-only
  deploy on `deploy/k8s/**`; k3d manifest smoke. Port matchID `cd-k8s.yml` /
  `k8s-smoke.yml` once a-d are stable.

## 8. Risks

- **R1 — Live prod IdP must not break.** `auth.sent-tech.ca` is LIVE
  (MEMORY *BR-39 full roadmap*). The base/overlay refactor (BR-55a) must render
  `overlays/prod` byte-equivalent to the current manual apply, validated in k3d
  BEFORE any prod apply. The history-rewrite that purged SealedSecret blobs
  (PR #254) is a precedent that prod auth deploys are fragile — handle with care.
- **R2 — Boot migrations are irreversible.** api owns boot-migrations on the
  shared DB; a bad migration on a prod promotion mutates live data. Mitigated by
  D3 (preprod canary on a separate DB) + D8 (pre-deploy backup) + D9 (rollback
  restores the dump). Recall MEMORY *Rename migration ALTER DEFAULT*: value-rename
  migrations need `ALTER COLUMN SET DEFAULT`, not just row UPDATEs — preprod
  catches this class before prod.
- **R3 — Secret cross-contamination.** preprod and prod MUST have distinct
  `OAUTH_SIGNING_KEK` + DB creds. Sharing the KEK would let a preprod token sign
  for prod's JWKS (shared-rows hazard, `35-auth-idp.yaml:10-12`). Enforced by D6.
- **R4 — DNS / TLS cutover.** New preprod hosts need A records + cert-manager
  certs; a misconfigured `letsencrypt-prod` solver fails issuance silently (the
  prod IdP relanded only after the ACME path was fixed). `cd.yml` smoke must
  assert the preprod certificate is Ready before claiming success.
- **R5 — Gate bypass.** If D7 lands as plain `workflow_dispatch` (option c)
  without an Environment reviewer, the "rhanka signature" is unenforced. The
  enforceable gate (D7a) is required, not optional.
- **R6 — Moving-tag regression.** Until digest pinning (4.3) ships, any deploy
  that still references `:main` can drift. BR-55c must retire `:main` from the
  deploy path in the SAME change, not leave a dual path (MASTER: no legacy
  fallback).
- **R7 — poc cluster capacity.** A full second namespace may exceed quota
  (OQ1). If headroom is insufficient, fall back to a thinner preprod (smaller
  replicas/limits) before considering the discouraged D1(b) shared-namespace.
