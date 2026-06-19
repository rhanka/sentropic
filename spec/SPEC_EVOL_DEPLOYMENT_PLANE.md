# SPEC_EVOL_DEPLOYMENT_PLANE — main→preprod CD + tag→prod promotion (matchID-style)

Status: STUDY (design + decisions), ARCH-17, BR-55, scope: foundations, draft
<DATE> (2026-06). This is a design study, NOT an implementation: it carries no
workflow YAML, no Makefile changes, no manifests — only the target design and
the decisions to ratify. Implementation is split into follow-up BRs (section 7).

This study takes **directional inspiration** from the matchID deployment pattern
(`/home/antoinefa/src/matchID/matchID/.github/workflows/`: `cd.yml`,
`release-prod.yml`, `cd-k8s.yml`, `k8s-smoke.yml`; `deploy/k8s/overlays/`). The
two-stage main→dev / tag→prod shape and the overlay/namespace-split are a faithful
mapping. But three pieces are **genuinely novel** for sentropic and are NOT a port —
they must be designed, not copied:

1. **Digest-pinned promotion.** matchID re-derives the image version at `app_ref`
   (`make artifact-version-*`, `release-prod.yml:170-171,193`) and cuts the prod
   tag from `app_sha`; it uses `docker manifest inspect` only to *check existence*
   (`release-prod.yml:496`, `cd.yml:703`) and never captures or pins a `@sha256`
   digest. Sentropic captures NO digest today either. The "same artifact"
   guarantee the ratified policy demands requires a digest-capture mechanism that
   does not exist in either codebase (§4.3, D5).
2. **Boot-migration decoupling / DB rollback.** matchID's data plane is
   Elasticsearch with a *decoupled restore Job*
   (`deploy/k8s/overlays/prod/elasticsearch-restore.job.yaml`) and snapshots.
   sentropic runs migrations *inside the api boot path* with no skip flag and has
   **no** live-prod-DB restore target. This is a different, harder problem (§3.3,
   §4.7, D8/D9).
3. **The recette + rhanka gate.** matchID's prod release is `workflow_dispatch`
   only, with no GitHub Environment reviewer. sentropic's ratified policy requires
   an *enforceable* rhanka signature + recette attestation — net-new infra (§4.10,
   D7).

Everything else (pipeline split, overlays, preprod namespace, smoke shape) is a
low-risk directional mapping.

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

## 2. Why now (the concrete pain) — corrected root cause

Today, merging to `main` does NOT reliably update production. The CI image-publish
and k8s-deploy stages skip on the common case (an unchanged api/ui), and even a
forced rebuild can produce the SAME tag. A human ends up building, pushing, and
`make k8s-deploy`-ing by hand. The cost is live and current:

- **PR #316 (auth-ui 0.4.0, DS-native IdP) and #319 are merged to `main` but
  NOT live on `auth.sent-tech.ca`.** The running pods still serve the pre-#316
  image. Closing this gap is the entire point of ARCH-17.

**Why exactly #316/#319 went stale (this is the load-bearing diagnosis — the
earlier draft blamed the `github.ref=='refs/heads/main'` gate, which is WRONG:
that condition is always true on a main merge).** The real cause is
**change-detection blindness** to packages baked into the api image:

- The `changes` job's `api` paths-filter (`ci.yml:146-156`) includes
  `api/**`, `apps/auth-idp/**`, `package.json`, `package-lock.json`,
  `packages/llm-mesh/**`, `packages/flow/**`, `packages/chat-server/**`,
  `packages/chat-core/**`, `packages/events/**`, `packages/contracts/**` — but
  does **NOT** include `packages/auth-ui/**` (nor several other workspace
  packages that end up inside the api/auth-idp image build). An auth-ui-only
  merge leaves `changes.outputs.api == 'false'`.
- `publish-api-image` (`ci.yml:1144`) is gated
  `if: (needs.changes.outputs.api == 'true' || needs.changes.outputs.global ==
  'true') && github.ref == 'refs/heads/main'` (line 1147). With `api == false`
  and `global == false`, it **skips**.
- `deploy-k8s` (`ci.yml:1501`) does `needs: [publish-api-image,
  publish-ui-image]` and `if: github.ref == 'refs/heads/main'` (line 1504).
  Because a job whose upstream `needs` were skipped is itself skipped (no
  `if: always()`), `deploy-k8s` **never runs** when the publishes are skipped.
- **The forced-rebuild trap.** Even if you force `publish-api-image`,
  `API_VERSION` (`Makefile:34`) is a content-hash over a *fixed file list* that
  also EXCLUDES `apps/auth-idp/**` and `packages/auth-ui/**` (it hashes
  `package.json`, `package-lock.json`, `packages/llm-mesh/src`,
  `packages/chat-server/src`, `packages/comments/src`, `api/src`,
  `api/Dockerfile`, …). An auth-ui change therefore yields the **same**
  `API_VERSION` tag → `make check-api-image` (`Makefile:480`) reports "image up
  to date" → the publish step is skipped, and the moving `:main` alias is
  re-pointed at the byte-identical (stale) image. No new bits ship.

**Corollary (must be stated in the implementation plan):** "BR-55c alone fixes
the staleness" is **FALSE** unless change-detection is fixed too. `cd.yml` must
EITHER (a) **always build the api+ui images on a `push: main`** (no `changes`
gate for the prod-bound images), OR (b) **expand both the `api` paths-filter AND
the `API_VERSION` hash input list to include every package baked into the api
image** (`apps/auth-idp/**`, `packages/auth-ui/**`, and any other workspace
package the Dockerfile copies). Same correction for ui/`UI_VERSION`. Without one
of these, a digest-pinned promotion still promotes a stale digest.

> Note on the "Push main alias" steps (`ci.yml:1170-1178` API, `:1134` UI):
> these have **NO `if:` guard** — they run unconditionally whenever the publish
> job runs. They are not ref-gated; they just inherit the job's `if:`. They are
> not the cause of staleness, but they ARE the mutable-tag mechanism that §3.3
> and Finding R6 retire.

## 3. Current state (gaps, with file refs)

### 3.1 One workflow does everything; deploy targets PROD directly
- A single `.github/workflows/ci.yml` runs on BOTH `push: main` and
  `pull_request` (`ci.yml:3-8`): validate, build, test, publish, and deploy.
  There is no `cd.yml`/`release-prod.yml` split.
- `publish-api-image` (`ci.yml:1144`) and `publish-ui-image` (`ci.yml:1108`)
  push `${REGISTRY}/sentropic-{api,ui}:${VERSION}` (a content sha-hash, see
  `Makefile:34-35` `API_VERSION`/`UI_VERSION`) plus a moving `:main` alias
  (`ci.yml:1170-1178` API, `:1134` UI). They are gated on
  `(changes.{api,ui}||changes.global) && ref==main` and chained behind the full
  e2e/security gauntlet.
- **`deploy-k8s` (`ci.yml:1501`) deploys to the LIVE PROD namespace.** It
  `needs: [publish-api-image, publish-ui-image]`, `if: github.ref ==
  'refs/heads/main'`, runs `make k8s-deploy ... ENV=ci-k8s`, then
  `kubectl -n sentropic rollout status deployment/{api,auth-idp,ui}`
  (`ci.yml:1523-1526`) — the **hardcoded `sentropic` namespace IS production**.
  So on a main merge that *does* change api/ui and passes the gauntlet, this job
  **already auto-deploys live prod from a mutable `:main` tag, with boot
  migrations** (see §3.4, §3.3). It only *appears* dormant because the common
  recent merges (auth-ui-only) skip change-detection (§2). This latent
  prod-auto-deploy path is a HIGH-severity gap the plane must neutralize first
  (R5b, BR-55a/b).

### 3.2 Single namespace, no preprod, no overlays — and the namespace is cross-repo
- One namespace `sentropic` (+ `sentropic-remote` for remote agents). No
  preprod namespace exists.
- **The Namespace, ResourceQuota, LimitRange, and NetworkPolicy *baseline* are
  NOT owned by this repo.** Per `deploy/k8s/README.md:7-10,37-43`, they live in
  the shared **poc-k8s** repo (`poc-k8s/tenants/sentropic/`) and are applied by
  the cluster operator via `make apply-sentropic`; "the Makefile in this repo
  will not create them." Creating a `sentropic-preprod` env therefore requires a
  **cross-repo predecessor in poc-k8s** (RQ/LimitRange/NetPol/pull-secret for
  `sentropic-preprod`) before anything in *this* repo can deploy there. matchID
  encodes exactly this boundary: its prod overlay `$patch: delete`s the Namespace
  resource so kustomize never owns it
  (`matchID/deploy/k8s/overlays/prod/kustomization.yaml:15-26`). Our overlays
  must mirror that delete-patch.
- Plain manifests in `deploy/k8s/`: `10-rbac`, `15-networkpolicy`, `20-postgres`,
  `30-api`, `35-auth-idp`, `40-ui`, `60-ingress`, `70-pgbackup-cronjob`. No
  kustomize base/overlay split, no `kustomization.yaml` anywhere. `make
  k8s-deploy` (`Makefile`) applies the files in order and `rollout restart`s the
  deployments.
- **`namespace: sentropic` is hardcoded 22 times across all 8 manifests** (grep
  count, every `metadata.namespace` and every cross-ref). All 22 must be stripped
  for a kustomize `namespace:` transformer to retarget the env. This is the bulk
  of the BR-55a refactor and is NOT a trivial rename (§8 BR-55a acceptance).

### 3.3 Moving tag, not digest promotion; migrations run at boot with no rollback
- Deployments pull the **moving `:main` tag** (`30-api.yaml:78`,
  `35-auth-idp.yaml:98`, `40-ui.yaml:59`) with `imagePullPolicy: Always`
  (`30-api.yaml:79`, `35-auth-idp.yaml:99`, `40-ui.yaml:60`). There is no
  immutable digest pinning — a pod restart can silently pick up a different
  `:main`. Capturing/pinning a `@sha256` digest is NOVEL (§4.3).
- **Migrations run unconditionally at api boot, with `process.exit(1)` on
  failure.** `api/src/index.ts:73-78` calls `await runMigrations()` (no
  `MIGRATE_ON_BOOT`/`SKIP_MIGRATIONS` flag), then `await ensureIndexes()`
  (`:84-88`) — both `process.exit(1)` on error. Consequences:
  - **"App-only rollback" is NOT achievable today.** Re-pinning a prior image
    digest re-runs *that image's* boot migrations against an
    already-forward-migrated DB. If the old code's migration set is incompatible
    with the new schema (or the migrator tries to re-apply/rollback), the pod
    crashloops. A `migration: none` tag flag would be *cosmetic* — the old image
    still tries to migrate at boot.
  - **There is NO target that restores into the LIVE prod app DB.** `db-restore`
    (`Makefile:2173`) restores into the **local** dev DB (it `clean`s first;
    CI uses it to verify a dump against a throwaway test DB, `ci.yml:1098-1106`).
    `k8s-pgbackup-restore` (`Makefile:2819`) restores into a scratch
    `restore_check` DB then **DROPs** it (`README.md:177-180`, Makefile:2834-2837)
    — explicitly "non-destructive to the app DB." So today **DB rollback in prod
    is impossible without manual pg_restore.**

### 3.4 The api image bundles the IdP; api+IdP+UI all share one DB
- The `sentropic-api` image **bundles the auth-idp entrypoint and its static
  login/consent screens** (`35-auth-idp.yaml:3-12`): auth-idp runs from the
  SAME image via a `command:` override
  (`node apps/auth-idp/dist/index.js`, `workingDir /workspace`). One image
  artifact = both api and IdP. A kustomize `images:` transformer keyed on
  `sentropic-api` therefore pins BOTH the api and auth-idp deployments at once
  (a feature — keep it).
- The **api pod owns DB migrations at boot** (`35-auth-idp.yaml:9-12`: the IdP
  "runs NO migration"). api, auth-idp, and ui (nginx → /api) all hit the SAME
  in-cluster `postgres` StatefulSet (`20-postgres.yaml`) and share the
  `sentropic-api` Secret (incl. `OAUTH_SIGNING_KEK`, which MUST be identical
  across api and IdP — `35-auth-idp.yaml:11-12`).
- **Single-writer invariant.** All deployments are `replicas: 1` with
  `strategy: { type: Recreate }` (`30-api.yaml:62-64`, `35-auth-idp.yaml:82-84`,
  `40-ui.yaml:43-45`). That is what keeps boot-migrations safe today: exactly one
  api pod ever runs the migrator. **Record "api stays single-writer for
  migrations" as a hard invariant** — any future `replicas>1` MUST first move
  migrations behind a dedicated Job / advisory lock (§4.7).

### 3.5 Secrets: one bundle, no per-env separation
- A single `.env` feeds `make k8s-bundle-secret` (`Makefile:2642`) which
  `kubectl create secret` the namespace Secrets (`sentropic-postgres`,
  `sentropic-api`). In prod the live IdP runs from a **SealedSecret** (MEMORY:
  *BR-39 full roadmap*; `README.md:217-269`). There is no per-env (preprod vs
  prod) secret split.
- **SealedSecrets-in-git lesson.** Main history was previously **rewritten to
  purge SealedSecret blobs** and the deploy relanded via PR #254 (MEMORY: *BR-39
  full roadmap*). Guardrail to carry forward: **only kubeseal ciphertext** ever
  enters git (never plaintext, never the controller master key); the controller
  sealing key must be backed up out-of-band (`README.md:272-287`); and preprod
  sealing scope must be **distinct** from prod (a preprod SealedSecret is
  decryptable only by the same one controller — same cluster — so the *plaintext
  inputs* must differ even though the controller is shared, see D6/R3).

### 3.6 Platform facts (constraints, not gaps)
- Registry: Scaleway `rg.fr-par.scw.cloud/nc-reg/`. Cluster: SCW `poc-...`.
- Ingress only applied when `K8S_INGRESS=1` (`Makefile` k8s-deploy path); the
  `60-ingress.yaml` host blocks (`sentropic.sent-tech.ca`,
  `auth.sent-tech.ca`) are gated out of the default deploy path.
- TLS via cert-manager Cloudflare DNS-01 ClusterIssuers — both
  `letsencrypt-staging` and `letsencrypt-prod` are delivered by poc-k8s
  (`README.md:184-186`). Shared Traefik + SCW LoadBalancer from the poc-k8s
  platform stack. WebAuthn RP ID is the parent domain `sent-tech.ca`
  (portable across every `*.sent-tech.ca` subdomain — `30-api.yaml:23-29`).
- CI already holds a kubeconfig as GH secret `KUBECONFIG_B64`
  (`ci.yml:1088,1509`) and runs `db-backup-prod` against the live cluster
  (`ci.yml:1086-1097`, `Makefile:2156`) — so cluster credentials in CI are an
  established pattern.

## 4. Target design (matchID flow mapped to sentropic)

### 4.1 Pipeline shape (the directional mapping)
Three workflows, mirroring matchID:

- **`ci.yml` (trimmed to PR-only)** — on `pull_request`: validate, build, test.
  No deploy. (matchID `ci.yml`.) Keep sentropic's existing per-package validation
  + e2e gauntlet here.
- **`cd.yml` (NEW)** — on `push: main` (+ `workflow_dispatch`): build the api +
  ui images, **capture their digests**, push them, then a `deploy-preprod` job
  kustomize-applies the **preprod overlay** to **`sentropic-preprod`**, waits
  rollout, runs smoke. AUTO, no gate. (matchID `cd.yml` → `deploy-dev` on
  `matchid-dev`.) This is where the current gated/skipped `publish-*-image` and
  the **PROD-targeting `deploy-k8s`** logic moves and becomes preprod-only. See
  §2 corollary: `cd.yml` must always-build-on-main OR fix change-detection.
- **`release-prod.yml` (NEW)** — `workflow_dispatch` ONLY (inputs:
  `release_kind`, `app_ref` default `main`, `final_prod_tag` auto-allocated,
  `attestation` as a **verifiable** ref — D7/OQ4). Resolves the api **and** ui
  digests **already built** at `app_ref` (§4.3), promotes BOTH by digest to
  **`sentropic` (= prod, D2)**, runs comprehensive smoke (DB, healthcheck,
  public healthcheck, TLS, JWKS continuity), then creates + pushes an annotated
  git **release tag** with metadata. (matchID `release-prod.yml`.)
- **`cd-k8s.yml` (optional, NEW)** — config-only deploy on `push: main` touching
  `deploy/k8s/**`; re-apply overlay at current digests to preprod. **Deferred.**
- **`k8s-smoke.yml` (optional, NEW)** — validate overlays in a local k3d/k3s
  cluster on `deploy/k8s/**` changes. **Deferred.**

### 4.2 Trigger note (workflow split vs single-file)
matchID keeps `ci.yml` PR-only and `cd.yml` main-only. sentropic's current
`ci.yml` is BOTH (`push:main` and `pull_request`, `ci.yml:3-8`). The port moves
the `push:main` responsibilities (build/publish/deploy) into `cd.yml` and leaves
`ci.yml` as PR-only validation. **No legacy fallback** (MASTER rule): the gated
`publish-*-image`/`deploy-k8s` jobs are DELETED from `ci.yml`, not dual-pathed —
but the deletion MUST be atomic with a working `cd.yml` against a live preprod
(§8 BR-55c, R5c), so there is never a gap window with zero deploy path.

### 4.3 Image-digest promotion (NOVEL — build once, promote by digest)
This does not exist in sentropic OR matchID; it must be designed.
- `cd.yml` builds + pushes `sentropic-{api,ui}:${VERSION}` and **captures each
  image's `@sha256` digest** via `docker buildx build --metadata-file
  metadata.json` (the `containerimage.digest` field), surfaces it as a workflow
  output, and records it (run output + deploy record / release metadata).
- Preprod deploys reference the **immutable digest** (kustomize `images:`
  transformer with `digest:`), NOT `:main`. `imagePullPolicy` changes from
  `Always` (today, `30-api.yaml:79` etc.) to digest-pinned `IfNotPresent`. The
  `:main` moving alias is **retired from the deploy path** (it may survive as a
  human convenience tag only).
- `release-prod.yml` resolves BOTH the api and ui digests at `app_ref` (NOT
  `:main`) and pins prod deployments to those **exact two digests** — no rebuild.
  Fail the run if **either** digest is missing/unresolved (§4.6). This is the
  "same artifact" guarantee; matchID's version-recompute approach is weaker, so
  this is the stricter sentropic choice (D5).

### 4.4 Preprod namespace + overlay (resolve the K8S_INGRESS gate)
- Refactor `deploy/k8s/` into a kustomize **base** (namespace-agnostic) +
  **overlays/preprod** and **overlays/prod**. Each overlay sets `namespace:`,
  the image **digests** (`images:` transformer with the **full
  registry-qualified name** `rg.fr-par.scw.cloud/nc-reg/sentropic-api` and
  `…/sentropic-ui` — the base manifests use the fully-qualified path, so the
  transformer `images[].name` MUST match it exactly, otherwise the transform is a
  silent no-op), the public hosts, and the env-specific ConfigMap values.
- **The overlays must NOT own the Namespace.** Per §3.2, the Namespace +
  RQ/LimitRange/NetPol are poc-k8s-owned. Mirror matchID's delete-patch
  (`overlays/prod/kustomization.yaml:15-26`): if a base `Namespace` exists,
  `$patch: delete` it in every overlay so kustomize never tries to apply or own
  it. Preferred: keep the `Namespace` out of `base` entirely.
- **Move `60-ingress.yaml` INTO the overlays** (preprod hosts in
  `overlays/preprod`, prod hosts in `overlays/prod`). This RESOLVES the
  `K8S_INGRESS=1` gate: ingress is always part of the rendered overlay, not a
  conditional side-flag. The flag is deleted.
- ConfigMap deltas per env (values that DIFFER): `OAUTH_ISSUER_URL`,
  `UI_BASE_URL`, `AUTH_CALLBACK_BASE_URL`, `WEBAUTHN_ORIGIN`,
  `CORS_ALLOWED_ORIGINS`, ingress hosts/TLS secret names, **cert-manager issuer**
  (prod = `letsencrypt-prod`; preprod SHOULD use `letsencrypt-staging` — §4.8/R4),
  and **`WEBAUTHN_RP_ID`** (a *distinct* preprod RP ID is now a blocking decision,
  D11 / OQ5 — not a shared default).

### 4.5 Per-env secrets
- Split the single `.env` → `make k8s-bundle-secret` path into per-env secret
  material (preprod vs prod), keyed by namespace. Prod keeps SealedSecrets
  (existing pattern); preprod gets its own SealedSecret or CI-created secret
  (D6). **HARD requirement: preprod and prod MUST NOT share `OAUTH_SIGNING_KEK`,
  DB credentials, OAuth client secrets, or signing-key DB rows** — they are
  separate trust domains (D3/D6/R3).
- **`db-backup-prod` is namespace-blind.** It uses `$(K8S_NAMESPACE)` (default
  `sentropic`, `Makefile:2558`) and hardcodes `secret sentropic-postgres`
  (`Makefile:2168`) + label `app.kubernetes.io/name=sentropic` (`:2166`).
  Preprod therefore needs its **own** backup CronJob + `sentropic-pgbackup`
  SealedSecret + S3 prefix, OR a parameterized `db-backup` that takes the env.
  This is extra BR-55b work, NOT free reuse.

### 4.6 The api-bundles-IdP fact, and UI is a SEPARATE image
- Because api + auth-idp ship in ONE image, the `images:` transformer keyed on
  `sentropic-api` pins BOTH the api and auth-idp deployments from a single
  digest — one promotion moves both. No change to the bundling.
- **UI is a SEPARATE image with its OWN digest** (`sentropic-ui`,
  `40-ui.yaml:59`). "Same artifact" promotion is therefore a **pair**: the api
  digest AND the ui digest must be resolved and pinned **atomically** from the
  *same* `app_ref` build. `release-prod.yml` inputs (currently one `app_ref`)
  must resolve+record **both**; the run **fails if either is missing**; and prod
  smoke must assert the running pod digests == the promoted digests for **both**
  api/auth-idp and ui (§4.9).

### 4.7 Migrations on preprod + the boot-migration / rollback decision (NOVEL)
- The api pod runs migrations at boot against its namespace's postgres
  (`api/src/index.ts:73-78`). With a **separate preprod DB** (D3), preprod
  migrations run first on preprod data and are observed there before prod
  promotion — preprod becomes a real migration canary.
- **Decision required (D8): decouple migrations from boot, or accept no app-only
  rollback.** Two acceptable resolutions:
  - **(A) Decoupled migration Job + flag.** Add a `MIGRATE_ON_BOOT` env flag to
    `api/src/index.ts` (default true preserves current behavior) and run
    migrations from a dedicated **Job / initContainer** (mirroring matchID's
    decoupled `elasticsearch-restore.job.yaml` shape). With migrations gated, a
    `release_kind` that ran no migration can re-pin a prior digest as a true
    **app-only fast-path rollback** (the old pod boots with
    `MIGRATE_ON_BOOT=false`).
  - **(B) Accept reality, no fast path.** Keep boot migrations; explicitly scope
    rollback to "**DB restore + downtime**, no app-only fast path," because
    re-pinning an old digest re-runs that image's boot migrations against a
    forward-migrated DB and can crashloop.
- **Forward-only until a real DB-restore lands (D9/§4.9).** Migrations are
  **forward-only with no automated DB rollback** until BR-55d ships a real
  `db-restore-prod`. Adopt **expand/contract**: destructive DDL (drop column,
  drop table, narrow type) ships only **one release AFTER** the consuming code is
  gone, so an app-only rollback never meets a schema it can't read. Recall MEMORY
  *Rename migration ALTER DEFAULT*: value-rename migrations need `ALTER COLUMN SET
  DEFAULT`, not just row UPDATEs — preprod catches this class before prod.
- **Single-writer invariant** (§3.4): preprod and prod stay `replicas: 1` /
  `Recreate` so exactly one migrator runs. Any `replicas>1` is gated behind
  moving migrations to a Job + advisory lock.

### 4.8 Preprod domains; don't break the live prod IdP
- Preprod gets its own hosts so it never collides with live prod:
  `sentropic-preprod.sent-tech.ca` and `auth-preprod.sent-tech.ca` (D4). Both
  resolve to the same Traefik LB, get their own DNS A records + certs.
- **Use the `letsencrypt-staging` ClusterIssuer for preprod** (both issuers are
  available, `README.md:184-186`) to avoid sharing prod's ACME rate limits and
  the prod DNS-01 solver blast radius. Preprod certs will be untrusted by default
  — acceptable for an internal/allowlisted env (§ R4).
- **Prefer preprod NOT publicly open.** Default to internal / IP-allowlisted (or
  Cloudflare Access). If it must be public, staging-issuer + allowlist still
  apply. Public exposure of a preprod IdP that can mint tokens is a real attack
  surface; gate it.
- The live prod IdP `auth.sent-tech.ca` is UNTOUCHED until `release-prod.yml`
  runs an explicit, gated promotion. main merges only ever move preprod hosts.

### 4.9 Smoke + rollback
- **Preprod smoke** (in `cd.yml`, blocking the run, not prod): rollout Available
  for api/auth-idp/ui; `/api/v1/health` (api) and `/healthz` (IdP,
  `35-auth-idp.yaml`); a public/internal curl through the preprod ingress; OIDC
  discovery `/.well-known/openid-configuration` 200 on the preprod IdP host;
  preprod certificate Ready (staging issuer).
- **Prod smoke** (in `release-prod.yml`, blocking the tag): the same set against
  prod hosts + TLS Ready + JWKS 200, **plus**:
  - **running pod digests == promoted digests** for api/auth-idp AND ui;
  - **active JWKS `kid` UNCHANGED pre/post promotion** (key continuity — a
    changed `kid` means signing keys rotated and outstanding tokens break);
  - **one real OIDC discovery + token round-trip** against a canary client.
  (Mirrors matchID's comprehensive smoke; the digest/kid/round-trip asserts are
  sentropic additions.)
- **Rollback** (`release_kind: rollback`): re-pin the PRIOR prod tag's api+ui
  digests + rollout. DB handling per D8/D9: if the prior release ran a migration,
  rollback requires a `db-restore-prod` (only after BR-55d ships it) + downtime;
  if option (A) and `migration: none`, it's an app-only fast path. matchID
  rollback restores the prior ES snapshot; sentropic's analogue is the PG dump
  restored into the LIVE DB — which **does not exist as a target yet** and is a
  BR-55d deliverable (§8).
- **Release tag**: on prod smoke success, `release-prod.yml` creates + pushes an
  annotated tag carrying metadata (prod tag, app_sha, api/ui **digests**,
  `release_kind`, whether a migration ran, attestation ref, run id) — matchID
  `publish-release-prod-metadata`.

### 4.10 The prod gate (NOVEL — currently unenforced)
There is **no GitHub `production` Environment anywhere today**; the current
`deploy-k8s` is gated only by `if: ref==main` (`ci.yml:1504`). The ratified
"rhanka signature + recette attestation" is therefore **unenforced**. BR-55d must
build it (D7) with the explicit acceptance criteria in §8.

## 5. Decisions to ratify (batched)

Each decision: options + recommendation. Reversible ones can be taken solo;
blocking/irreversible ones (D3 preprod DB, D6 secrets, D7 prod gate, D8
migrations, D11 preprod RP ID) want the batched-packet owner review.

> **D1–D6 and D10 are sound to ratify** (the directional matchID mapping is
> good). **D7, D8, D9, D11 are hardened/new** and carry the novel-work risk.

### Batch A — environment shape

**D1 — Preprod env existence & isolation level.**
- (a) Separate namespace `sentropic-preprod` with its OWN postgres + secrets +
  ingress hosts (full isolation). **[recommended]**
- (b) Same namespace, second set of deployments (cheaper, no isolation).
- (c) Ephemeral per-PR preview envs (heaviest).
- Recommendation: **(a)**. Cheapest path to a real CD safety net; matches
  matchID's `matchid-dev` vs `matchid-prod`. **Predecessor: BR-55b0** (poc-k8s
  tenant baseline) must exist first — see §7. Costs one extra PG PVC + quota
  headroom on the poc cluster (verify before committing — OQ1).

**D2 — Prod namespace identity.**
- (a) Keep the existing live `sentropic` namespace AS prod (`overlays/prod`
  targets `namespace: sentropic`). **[recommended]**
- (b) Rename to `sentropic-prod` (clean symmetry, but a disruptive live-namespace
  migration — DNS, secrets, PVC).
- Recommendation: **(a)**. Zero-disruption.

**D3 — Preprod database.**
- (a) Separate preprod postgres StatefulSet in `sentropic-preprod` (own PVC, own
  data, real migration canary). **[recommended]**
- (b) Shared DB with prod (FORBIDDEN: preprod boot-migrations would mutate prod
  schema on every main merge).
- Recommendation: **(a)**. Seeding decided in D8b / OQ2.

### Batch B — naming, tags, artifact

**D4 — Preprod domain naming.**
- (a) `sentropic-preprod.sent-tech.ca` + `auth-preprod.sent-tech.ca`.
  **[recommended]**
- (b) `*.preprod.sent-tech.ca` nested subdomain (needs wildcard cert / extra
  DNS-01 config).
- Recommendation: **(a)**. Needs owner validation per MEMORY *No unvalidated
  naming*.

**D5 — Prod tag policy & image immutability.**
- (a) Date tags `vYYYY.MM.DD.N` (matchID scheme) + promote by **immutable
  digest** (NOVEL capture, §4.3). **[recommended]**
- (b) Semver `vN.M.P` release tags.
- Recommendation: **(a)** for the deploy/release TAG PLUS digest pinning for the
  artifact. npm package semver stays a separate concern. Confirm date-tag vs
  semver with owner (reversible).

### Batch C — secrets, migrations, gate, rollback (blocking)

**D6 — Per-env secret mechanism.**
- (a) SealedSecrets per namespace (prod keeps current SealedSecret; preprod gets
  its own sealed material — distinct plaintext inputs, same shared controller).
  **[recommended]**
- (b) CI-created secrets from GH secrets at deploy time (matchID style).
- (c) External secrets operator.
- Recommendation: **(a)**; (b) acceptable for preprod-only if SealedSecrets
  friction is high. HARD requirement either way: preprod and prod get DISTINCT
  `OAUTH_SIGNING_KEK`, DB creds, OAuth client secrets, and signing-key rows.
  Guardrail: only kubeseal ciphertext in git; controller key backed up
  out-of-band (§3.5).

**D7 — Prod-promotion gate (NOVEL — must become enforceable).**
- (a) GitHub **`production` Environment** with **required reviewer = rhanka**; the
  `release-prod.yml` prod-deploy job carries `environment: production` so the run
  pauses for rhanka's native, auditable approval. **[recommended, mandatory]**
- (b) h2a `h2a_sign` signature recorded + **verified** by the workflow as the
  `attestation` input (richer provenance, ties to the role-structure
  decision-authority policy).
- (c) Plain `workflow_dispatch` only (INSUFFICIENT — anyone with dispatch can run).
- Recommendation: **(a) AS the enforceable gate, carrying (b) as the
  attestation**. BR-55d acceptance (hard): (1) GH `production` Environment exists,
  required reviewer = rhanka; (2) the prod deploy job has `environment:
  production`; (3) **tag-protection** so pushing a release tag cannot bypass the
  dispatch+gate path; (4) the **recette attestation is a verifiable input** — a
  track VerificationRun id the workflow resolves+checks, OR an `h2a_sign`
  signature it verifies — **NOT a free-text string** (resolves OQ3/OQ4 before
  BR-55d); (5) a **negative test** proving the gate cannot be bypassed (e.g. a
  dispatch without approval / with a bad attestation is rejected).

**D8 — Migration coupling + prod migration safety on promotion (NOVEL).**
- (a) **Decouple**: add `MIGRATE_ON_BOOT` flag + a dedicated migration
  Job/initContainer (§4.7-A), AND run `db-backup-prod` (env-aware, §4.5) BEFORE
  applying, uploading the dump as a run artifact. Enables an app-only fast-path
  rollback for no-migration releases. **[recommended]**
- (b) **Keep boot migrations** + pre-deploy backup only; rollback always means DB
  restore + downtime (§4.7-B).
- (c) No pre-deploy backup (rely on nightly CronJob — REJECTED, irreversible
  boot-migrations need a fresh dump).
- Recommendation: **(a)** if migration decoupling is in BR-55d scope; otherwise
  **(b)** with the forward-only/expand-contract discipline (§4.7) explicitly
  documented. Either way: pre-deploy backup is mandatory.

**D9 — Rollback strategy + the missing restore target (NOVEL).**
- (a) `release_kind: rollback` re-pins prior api+ui digests; for migrating
  releases it invokes a **real `db-restore-prod`** that BR-55d must SHIP
  (kubectl-exec `pg_restore` into the LIVE prod pod, gated + confirmed, **proven
  on preprod first**). **[recommended]**
- (b) App-only rollback only (re-pin digests, never touch DB) — only valid for
  no-migration releases AND only if D8(a) decoupling lands.
- Recommendation: **(a)** as the full capability; (b) as the fast path when
  D8(a) is in place and the release recorded `migration: none`. **Until BR-55d's
  `db-restore-prod` lands, state plainly: there is NO automated DB rollback** —
  this is why expand/contract (§4.7) is mandatory in the interim.

**D10 — Who owns ARCH-17 / BR-55.**
- (a) Foundations lane (platform plumbing). **[recommended]**
- (b) Scale program.
- Recommendation: **(a)** builds it; coordinate with **scale** (the deferred
  multi-cloud + PaaS `k8s-ops` contract will consume the same overlay/promotion
  primitives). Keep overlay names provider-neutral (`k8s-*`, not `scw-*`) per
  MEMORY *No unvalidated naming*. **BR-55b0 (poc-k8s baseline) is owned by the
  cluster operator**, not foundations (cross-repo).

### Batch D — auth isolation (blocking)

**D11 — Preprod WebAuthn RP ID (NOW BLOCKING, was a footnote).**
- (a) **Distinct preprod RP ID** (e.g. `auth-preprod.sent-tech.ca` as its own RP
  ID). Fully isolates preprod auth state; a preprod passkey is NOT valid against
  prod and vice-versa. **[recommended]**
- (b) Shared `WEBAUTHN_RP_ID=sent-tech.ca` across both envs (passkeys
  cross-valid).
- Recommendation: **(a)**. A shared RP ID — even with split KEK/DB —
  **cross-validates real user passkeys** across trust domains, which is exactly
  what env isolation is supposed to prevent. Distinct RP ID breaks passkey
  portability between envs (intended). This is a security-isolation decision, not
  a convenience footnote.

## 6. Open questions for rhanka / scale / cluster operator

- **OQ0 (poc-k8s baseline — cluster operator).** Will the operator create the
  `poc-k8s/tenants/sentropic-preprod/` baseline (Namespace, ResourceQuota,
  LimitRange, NetworkPolicy, pull-secret) — i.e. BR-55b0? This is a hard
  predecessor to D1(a).
- **OQ1 (poc cluster headroom).** Does the cluster have quota/PVC headroom for a
  full second namespace (preprod postgres + api + IdP + ui)? Needs a
  `kubectl describe quota`/`describe nodes` check before BR-55b. (auth-idp was
  sized to fit existing headroom — `35-auth-idp.yaml`.)
- **OQ2 (preprod data seeding).** Start **empty + synthetic fixtures** (default
  recommendation) or seed from a **scrubbed** prod dump? If seeded, scrubbing is
  a HARD requirement (drop/rotate `id_token_signing_keys`, `oauth_clients`
  secrets, `webauthn_credentials`/passkeys, `sessions`, `magic_links`, PII) —
  otherwise preprod leaks live auth state.
- **OQ3 (gate source of truth).** D7: GH `production` Environment reviewer vs h2a
  `h2a_sign` — which is the authoritative "rhanka signed"? Does the role-structure
  decision-authority policy mandate the h2a path?
- **OQ4 (recette attestation artifact).** What concrete, **verifiable** artifact
  is the recette sign-off — a track VerificationRun id, an h2a attestation? It
  must be a required, machine-checked input to `release-prod.yml` (not free text).
  MUST be resolved before BR-55d.
- **OQ5 (preprod WebAuthn) → folded into D11.** (Was OQ5; now a blocking
  decision.)
- **OQ6 (cd-k8s + k8s-smoke).** In scope for the first BRs, or deferred (§4.1)?

## 7. Implementation plan (BRs AFTER this study)

Sequenced; each is a normal scoped branch with `BRANCH.md`. The pipeline *shape*
is low design risk (directional matchID mapping); the NOVEL risk is concentrated
in digest capture (BR-55c), migration/rollback (BR-55d), and the gate (BR-55d).

- **BR-55b0 — poc-k8s tenant baseline for `sentropic-preprod` (CLUSTER OPERATOR,
  cross-repo).** Create `poc-k8s/tenants/sentropic-preprod/` (Namespace,
  ResourceQuota, LimitRange, NetworkPolicy, registry pull-secret); apply via
  `make apply-sentropic-preprod`. Hard predecessor to BR-55b. NOT in this repo.

- **BR-55a — Kustomize base/overlay refactor + neutralize prod auto-deploy +
  K8S_INGRESS resolution.** Split `deploy/k8s/` into base + `overlays/{preprod,
  prod}`; **strip all 22 `namespace: sentropic` occurrences** for the
  `namespace:` transformer; mirror matchID's Namespace `$patch: delete`; move
  ingress into overlays; delete the `K8S_INGRESS` flag. **FIRST landing lot also
  neutralizes (or repoints to preprod) the PROD-targeting `deploy-k8s` job**
  (§3.1) so no main merge can touch the `sentropic` namespace via the old path.
  Acceptance: `kubectl kustomize overlays/prod | kubectl diff -f -` produces a
  **ZERO diff against the LIVE cluster** (not a k3d render); and "no main merge
  can deploy to `sentropic`."

- **BR-55b — Preprod environment (in-repo half).** Preprod overlay wiring:
  preprod postgres + SealedSecret (distinct KEK/DB/secrets), preprod
  backup CronJob + `sentropic-pgbackup` (env-aware `db-backup`), preprod DNS +
  **staging-issuer** certs (`sentropic-preprod`/`auth-preprod`), distinct
  WebAuthn RP ID (D11). Depends on BR-55b0. One-time infra BR.

- **BR-55c — `cd.yml` (main→preprod CD) + change-detection fix + digest
  capture.** New workflow: **always-build-on-main OR expand api/ui paths-filter +
  `API_VERSION`/`UI_VERSION` hash to include `apps/auth-idp/**`,
  `packages/auth-ui/**`, and every package baked into the images** (§2 — this is
  the actual staleness fix). Capture api+ui `@sha256` digests (§4.3), deploy
  preprod overlay **by digest**, smoke. DELETE the gated
  `publish-*-image`/`deploy-k8s` jobs from `ci.yml`; trim `ci.yml` to PR-only.
  **The deletion must be ATOMIC with a green `cd.yml` against a LIVE preprod (a+b
  merged AND applied)** — no gap window with zero deploy path (R5c).
  > "BR-55c alone fixes the #316/#319 staleness" is **only true if** the
  > change-detection fix above lands in the SAME BR.

- **BR-55d — `release-prod.yml` (tag→prod promotion) + the gate + real DB
  rollback.** New `workflow_dispatch` workflow: enforceable D7 gate (`production`
  Environment + rhanka reviewer + tag-protection + verifiable attestation +
  negative bypass test); resolve api+ui digests at `app_ref`, fail if either
  missing (§4.6); pre-deploy `db-backup-prod`; promote BOTH digests to prod;
  comprehensive smoke (digest==running, JWKS `kid` continuity, OIDC round-trip).
  Implements rollback (D9) including a **real `db-restore-prod`** (kubectl-exec
  `pg_restore` into the live pod, gated/confirmed, **proven on preprod first**)
  and the D8 migration-coupling decision (`MIGRATE_ON_BOOT` + migration Job if
  D8a). `release_kind` defined here (§ next bullet).

- **`release_kind` taxonomy** (set deliberately, tied to whether a migration
  ran): mirror matchID's 3-kind shape adapted to PG:
  - `app` — promote app digests, run boot/Job migrations as needed.
  - `app_no_migration` — promote app digests, asserted no schema change (enables
    app-only fast-path rollback under D8a).
  - `rollback` — re-pin prior digests (+ DB restore if the reverted release
    migrated).
  (matchID = `app_and_data | data_only | rollback`; sentropic has no separate
  "data" plane like ES, so the axis is *migration vs no-migration*.)

- **BR-55e (optional, deferred) — `cd-k8s.yml` + `k8s-smoke.yml`.** Config-only
  deploy on `deploy/k8s/**`; k3d overlay smoke. Port once a–d are stable.

## 8. Risks

- **R1 — Live prod IdP must not break.** `auth.sent-tech.ca` is LIVE (MEMORY
  *BR-39 full roadmap*). BR-55a's `overlays/prod` MUST render byte-equivalent to
  the current apply — proven by a **`kubectl diff` zero-diff against the LIVE
  cluster**, before any prod apply. The SealedSecret history-rewrite (PR #254) is
  a precedent that prod auth deploys are fragile.
- **R2 — Boot migrations are forward-only and irreversible without a DB restore
  that does not yet exist.** api owns boot-migrations on the shared DB
  (`index.ts:73-78`); re-pinning an old digest re-runs that image's migrations
  and can crashloop. Mitigated by D3 (preprod canary) + D8 (decouple +
  pre-deploy backup) + D9 (real `db-restore-prod`, BR-55d) + **expand/contract
  discipline** in the interim (§4.7).
- **R3 — Secret/key cross-contamination.** preprod and prod MUST have distinct
  `OAUTH_SIGNING_KEK`, DB creds, client secrets, AND signing-key rows. The acute
  risk is **shared DB rows**: each env mints its OWN JWKS keypair from its OWN
  `id_token_signing_keys` table even under a shared KEK, so a shared DB (not a
  shared KEK alone) is what cross-signs. Keep distinct KEK **and** DB as
  defense-in-depth, and require token consumers to validate `iss` and fetch JWKS
  from the **env-specific issuer only** (D6/D11).
- **R4 — DNS / TLS cutover.** New preprod hosts need A records + certs. Use the
  **`letsencrypt-staging`** issuer for preprod to avoid prod ACME rate-limit /
  DNS-01 solver blast radius (§4.8). `cd.yml` smoke must assert the preprod
  certificate is Ready before claiming success.
- **R5a — Unenforced prod gate.** Today the "rhanka signature" is unenforced
  (no `production` Environment; `deploy-k8s` is `if: ref==main` only). D7's
  enforceable gate is mandatory, not optional (BR-55d).
- **R5b — Latent prod auto-deploy from a mutable tag with boot migrations.** A
  main merge that changes api/ui and passes the gauntlet ALREADY runs
  `deploy-k8s` against the `sentropic` (prod) namespace from `:main`
  (`ci.yml:1501-1526`). BR-55a's FIRST lot must neutralize/repoint this — not
  defer it to BR-55c.
- **R5c — Deploy-path gap.** Deleting the old `deploy-k8s`/publish jobs must be
  ATOMIC with a working `cd.yml` against a live preprod; never merge the deletion
  before preprod CD is green, or main merges silently stop deploying anywhere.
- **R6 — Moving-tag regression.** Until digest pinning (§4.3) ships, any deploy
  referencing `:main` can drift. BR-55c must retire `:main` + flip
  `imagePullPolicy` to digest/`IfNotPresent` in the SAME change (MASTER: no
  legacy fallback).
- **R7 — poc cluster capacity / cross-repo baseline.** A full second namespace
  may exceed quota (OQ1), and the baseline is poc-k8s-owned (OQ0/BR-55b0). If
  headroom is insufficient, fall back to a thinner preprod (smaller
  replicas/limits) before the discouraged D1(b).
- **R8 — UI/api digest skew.** "Same artifact" is a *pair*; promoting one digest
  without the other (or resolving the wrong build's digest) ships a mismatched
  prod. `release-prod.yml` must resolve both at the same `app_ref` and fail-closed
  if either is missing (§4.6, BR-55d).
- **R9 — SealedSecret-in-git.** Only kubeseal ciphertext in git; back up the
  controller key out-of-band; keep preprod sealing inputs distinct from prod
  (§3.5).
