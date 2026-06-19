# SPEC DECISION — Deployment-plane (ARCH-17 / BR-55) ratification dossier

Status: **PARTIALLY RATIFIED** (2026-06-19). The auth/data/env model was **re-challenged** with a
double pass (Opus 4.8 max + Codex 5.5 xhigh — they converged on the model, diverged on validation
identity) and **ratified by rhanka**. Full analysis/evidence: `SPEC_EVOL_DEPLOYMENT_PLANE.md` (PR
#340); THIS file is the clean decision record. Each decision: stake → options → recommendation →
status. Nothing is built until its line says RATIFIED.

---

## RATIFIED 2026-06-19 (owner GO after Opus 4.8 max + Codex 5.5 xhigh re-challenge)

**Core reframe `[FACT]`:** prod WebAuthn RP ID is already the parent domain `sent-tech.ca` (origins
pinned; `30-api.yaml`, `35-auth-idp.yaml`). Trust-domain isolation (signing keys / KEK / issuer) and
identity portability (RP ID) are **independent axes** — the earlier binary (isolation ⟂ realistic
validation) was wrong.

**THREE-TIER environment model (RATIFIED).**
| Tier | Trigger | Data | Identity |
|------|---------|------|----------|
| **PREPROD** | every `main` merge (auto CD) | synthetic / scrubbed-shaped (no PII) | synthetic users, **distinct RP ID** (`auth-preprod…`) — fully isolated |
| **VALIDATION / recette** | gated, before a prod tag (owner UAT + orthogonality gate) | **scrubbed prod-map import** (real tenants/dossiers, rotated secrets) | **federation to prod IdP** (real users) |
| **PROD** | release tag, gated | live | `sent-tech.ca`, unchanged |

- **D11R — validation identity = FEDERATION (RATIFIED).** Validation is an **OIDC client of the PROD
  IdP**: real users authenticate at `auth.sent-tech.ca` (prod), validation consumes the prod-issued
  identity (validation-specific client/audience) and maps `sub`/tenant/workspace into its DB.
  **Passkey verification stays in prod only → no second login surface.** PREPROD keeps a distinct RP
  ID (synthetic, no real users). PROD unchanged. (Chosen over shared-parent-RP-ID, which Opus
  recommended + Codex flagged as a gated fallback; owner picked the security-cleaner federation.)
- **OQ2R — data policy split by tier (RATIFIED).** PREPROD = synthetic/scrubbed-shaped. VALIDATION =
  controlled scrubbed prod-map import (see D13/D14).
- **D12 — validation env shape (RATIFIED).** Permanent `sentropic-validation` namespace (own PG /
  secrets / hosts / KEK / signing keys). **Pending OQ1** (poc-cluster headroom for a 3rd namespace —
  if blocked, fall back to ephemeral/time-boxed).
- **D13/D14 — prod→validation import path (RATIFIED direction).** Repeatable make-driven, **fail-closed
  scrub** (rollback on any scrub error; allowlist transform, raw clone rejected). ALWAYS drop/rotate:
  `id_token_signing_keys` (drop+regen), `OAUTH_SIGNING_KEK` + DB creds (env secrets, never from dump),
  `oauth_clients`/`service_clients` secrets + redirect URIs, `sessions`/`user_sessions`,
  `authorization_codes`/`oauth_tokens`, `magic_links`/`email_verification_codes`, WebAuthn challenges,
  connector/provider tokens, external `storageKey`→validation buckets. **Keep real:** tenants,
  memberships, workspaces, dossiers/docs (PII masked unless an allowlisted UAT cohort consents). With
  federation, `webauthn_credentials` are NOT imported (login happens in prod).
- **D15 — orthogonality gate (RATIFIED).** Promotion to prod requires an **automated access-isolation
  suite** on the validation realistic data (≥2 tenants, overlapping/non-overlapping users, negative
  cross-tenant API tests, OAuth `tid`/audience checks, connector-disabled checks). The recette
  attestation (D7) references THIS run — not manual "looks fine".

**Also RATIFIED this session:**
- **Staleness CI = publish-only.** Add `packages/auth-ui/**` (+ other api-bundled packages) to the
  `api` paths-filter + `API_VERSION` hash so images stay current, **without** auto-triggering the
  prod-targeting deploy. (Avoids entrenching auto-prod-deploy before preprod exists.)
- **D7 — prod gate = GitHub `production` Environment, required reviewer = rhanka** (run pauses for
  approval) + tag-protection + the recette attestation as a **verifiable** input (the D15 run /
  h2a sign), not free text. Negative bypass test required.

---

## Reversible — recommendation stands (RATIFIED implicitly / change cheaply)

| # | Decision | Recommendation |
|---|----------|----------------|
| D1 | Preprod isolation | Separate `sentropic-preprod` ns (own PG/secrets/hosts). Predecessor: BR-55b0. |
| D2 | Prod namespace | Keep live `sentropic` AS prod (zero disruption). |
| D3 | Preprod DB | Separate (a shared DB would let preprod migrations mutate prod). |
| D5 | Tag policy | `vYYYY.MM.DD.N` + immutable-digest promotion. |
| D6 | Per-env secrets | SealedSecrets per ns; **distinct KEK/DB/client-secrets/signing-keys per tier (now 3-way)**. |
| D10 | Ownership | Foundations builds; coord. scale; BR-55b0 owned by the cluster operator (cross-repo). |

## STILL OPEN — owner decisions not yet taken (next batch)

- **D4 — preprod/validation domain names** (needs your validation; durable naming). Reco
  `auth-preprod.sent-tech.ca` / `auth-validation.sent-tech.ca` (or your `preprod.auth.sent-tech.ca`
  nesting — to confirm).
- **D8 — prod migration coupling** (decouple via `MIGRATE_ON_BOOT` + migration Job, vs keep
  boot-migrations + expand/contract). Pre-deploy backup mandatory either way.
- **D9 — rollback** (ship a real gated `db-restore-prod` vs app-only fast-path). Until it ships:
  forward-only migrations.
- **OQ0** (cluster operator: create `poc-k8s/tenants/sentropic-preprod` + `…-validation` baseline).
- **OQ1** (cluster headroom for preprod + validation namespaces — `kubectl describe quota`).

---

## Implementation order (after the open decisions)
BR-55b0 (poc-k8s baselines: preprod + validation) → BR-55a (kustomize base/overlays, kills the
K8S_INGRESS gate) → BR-55b (preprod ns + DB) → **BR-55c (`cd.yml` main→preprod; + the publish-only
staleness fix)** → BR-55d (`release-prod.yml` + D7 gate + D8/D9 migration/rollback) → BR-55e
(validation ns + federation client + D13/D14 import + D15 orthogonality suite). Detail: PR #340.
