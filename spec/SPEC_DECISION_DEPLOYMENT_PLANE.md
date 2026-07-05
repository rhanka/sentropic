# SPEC DECISION — Deployment-plane (ARCH-17 / BR-55) ratification dossier

Status: **RATIFIED** (2026-06-19/20) — ALL owner decisions taken; only OQ0 (cluster operator
baselines) remains external. The auth/data/env model was **re-challenged** with a
double pass (Opus 4.8 max + Codex 5.5 xhigh — they converged on the model, diverged on validation
identity) and **ratified by rhanka**. Full analysis/evidence: `SPEC_EVOL_DEPLOYMENT_PLANE.md` (PR
#340); THIS file is the clean decision record. Each decision: stake → options → recommendation →
status. Nothing is built until its line says RATIFIED.

> **⊘ REVISED 2026-06-22 (owner rhanka):** the THREE-tier model below is **superseded by a TWO-tier
> model** — a single `dev` tier (main-aligned, **real prod-data copy**, standalone `dev.auth` with
> prod users imported) + prod. **Federation (D11R) is DROPPED.** See **§ REVISION 2026-06-22**
> immediately below; the 2026-06-19/20 sections are kept for provenance with `⊘ SUPERSEDED` markers
> where they conflict.

---

## REVISION 2026-06-22 (owner) — THREE-tier → **TWO-tier: a single `dev` tier + prod**

Owner reframe (rhanka, 2026-06-22): the PREPROD (synthetic) + VALIDATION (federation) split is
**collapsed into ONE non-prod tier named `dev`** — a *traditional preprod*: main-aligned, seeded with
a **real copy of prod data**, re-imported after each prod release, on minimal resource quotas. The
term "validation" is dropped. This SUPERSEDES the three-tier table, D11R (federation), D4
(`preprod.*`/`validation.*` naming), D12, and the OQ2R/D13–D14 data policy where they conflict. PROD
is unchanged. Decisions DV1–DV6 are RATIFIED (owner answered Q1=parent-RP-ID, Q3=real-PII-copy;
Q2=distinct-dev-crypto taken as the recommended default).

**TWO-TIER environment model (RATIFIED 2026-06-22).**
| Tier | Trigger | Data | Identity |
|------|---------|------|----------|
| **DEV** | every `main` merge (auto CD); data re-imported at each prod release | **real prod-data copy** (users/tenants/dossiers, **PII included**) | real users; standalone `dev.auth`; **WebAuthn RP ID = parent `sent-tech.ca`** (existing prod passkeys work) |
| **PROD** | release tag, gated (D7) | live | `sent-tech.ca`, unchanged |

- **DV1 — naming = `dev.*` (RATIFIED).** `dev.sentropic.sent-tech.ca` (app → ui) +
  `dev.auth.sent-tech.ca` (standalone IdP → auth-idp). Drops `preprod.auth`/`preprod.sentropic`/
  `validation.sentropic` (supersedes D4).
- **DV2 — ONE non-prod tier, main-aligned (RATIFIED).** Collapses preprod+validation. `dev`
  auto-deploys on every `main` merge (BR-55c CD); its data is **overwritten by a fresh prod import at
  each prod release**. Mental model: *dev = main + last prod snapshot*. Permanent `sentropic-dev`
  namespace, **minimal resource quota** (supersedes D12's `sentropic-validation`). Primary value:
  validate screens + API + **migrations** against real prod data before promotion ("does main break
  on real data?").
- **DV3 — data = real prod copy, PII included (RATIFIED; owner Q3).** `dev` is seeded with a full real
  prod data copy (NOT synthetic, NOT PII-masked). Consequence: **`dev` holds real PII → it is
  access-controlled with the SAME strictness as prod** (not an open sandbox), despite minimal quotas.
  (Supersedes OQ2R synthetic/scrubbed-shape.)  **'Same strictness as prod' = concrete controls (mandatory):** `dev` is NON-public (private ingress / IP-allowlist, no end-user traffic), NetworkPolicy + RBAC restrict access, `kubectl exec`/port-forward locked down, PII access audited, backups encrypted. Tension acknowledged: `dev` auto-CDs UNREVIEWED `main` code against REAL PII (prod is gated by D7, dev is not) → the non-public + audited posture IS the compensating control.
- **DV4 — auth = standalone `dev.auth`, parent RP ID; FEDERATION (D11R) DROPPED (RATIFIED; owner Q1).**
  `dev.auth` is a standalone IdP that **imports prod users**, with `WEBAUTHN_RP_ID = sent-tech.ca` (the
  parent, same as prod) so a user's **existing prod passkey verifies at `dev.auth`** (real login, zero
  re-enrolment). This REQUIRES importing `webauthn_credentials` (the credential PUBLIC-key rows) — the
  OPPOSITE of federation, which did not. **Trade-off (conscious):** this is the shared-parent-RP-ID
  option set aside on 2026-06-20 for federation; the owner now picks it for real-login fidelity. The
  residual exposure (dev becomes a passkey-ceremony surface for real identities) is bounded by DV5
  (distinct dev crypto → a dev session is never prod-valid) + DV3 (prod-grade access control on dev).  **Anti-replay (must-enforce):** the shared parent RP ID means a dev assertion carries the SAME `rpIdHash` as prod — tier separation then rests on (i) `dev.auth` registering ONLY `https://dev.auth.sent-tech.ca` as an allowed WebAuthn origin and strictly REJECTING prod origins, (ii) prod NEVER adding a `dev.auth` origin to its allowed set, and (iii) single-use server challenges. (A credential's registration origin (prod) need NOT equal its assertion origin (dev) — WebAuthn requires only an RP-ID registrable-suffix match + an allowed assertion origin; this is why importing the public-key rows + parent RP ID is sufficient.)
- **DV5 — crypto = distinct per tier; only DATA is copied (RATIFIED; owner Q2 default).** Even with
  real data, `dev` **regenerates its OWN** id-token signing keys, `OAUTH_SIGNING_KEK`, DB creds, and
  OAuth client secrets, and does **NOT** import sessions/tokens/authorization-codes/magic-links
  (truncated). So a `dev` compromise **cannot mint a prod-valid token** (blast-radius isolated). The
  D13/D14 fail-closed scrub thus still applies to **secrets/keys/sessions** — but `webauthn_credentials`
  and the real data tables ARE imported now (per DV4/DV3). (D6 distinct-crypto stays, now 2-way
  dev+prod; the RP ID is NO LONGER distinct — it is the shared parent, per DV4.)
- **DV6 — orthogonality gate (D15) retained.** The automated access-isolation suite runs against
  `dev`'s real data and remains the **prod-promotion gate** referenced by the D7 recette attestation.  The suite evaluates the EXACT `main` digest being promoted (a stable evaluation point), not whatever transient state the auto-CD `dev` tier has drifted to.

**Preserved unchanged:** PROD (D2/D3), D5 (tag `vYYYY.MM.DD.N` + immutable-digest promotion), D6
(distinct crypto per tier — now 2-way), D7 (prod gate = GitHub `production` Environment + reviewer
rhanka + verifiable attestation), D8/D9 (migration decouple `MIGRATE_ON_BOOT` + Job + gated
`db-restore-prod`), the publish-only staleness fix.

**Implementation impact (BR-55):** BR-55b (#354, merged preprod overlay — synthetic, isolated RP ID)
→ **rename `dev` + re-point** (parent RP ID + the prod-data import); BR-55c (#355, merged main→preprod
CD) → rename `preprod`→`dev` (minor); BR-55d (release-prod + D7 gate) → **unchanged**; BR-55e (was
validation+federation+import) → becomes **`dev` prod-data import (DV3/DV5 scrub) + standalone
`dev.auth` (DV4) + the D15 orthogonality suite** (NO federation client). The `test-smoke-restore`
prod-cred fix (BR55c-PRODCRED-SMOKE) folds here.

---

## RATIFIED 2026-06-19 (owner GO after Opus 4.8 max + Codex 5.5 xhigh re-challenge) — ⊘ partially superseded 2026-06-22 (see § REVISION)

**Core reframe `[FACT]`:** prod WebAuthn RP ID is already the parent domain `sent-tech.ca` (origins
pinned; `30-api.yaml`, `35-auth-idp.yaml`). Trust-domain isolation (signing keys / KEK / issuer) and
identity portability (RP ID) are **independent axes** — the earlier binary (isolation ⟂ realistic
validation) was wrong.

**THREE-TIER environment model (RATIFIED 2026-06-19 — ⊘ SUPERSEDED 2026-06-22 by the 2-tier model in § REVISION; kept for provenance).**
| Tier | Trigger | Data | Identity |
|------|---------|------|----------|
| **PREPROD** | every `main` merge (auto CD) | synthetic / scrubbed-shaped (no PII) | synthetic users, **distinct RP ID** (`auth-preprod…`) — fully isolated |
| **VALIDATION / recette** | gated, before a prod tag (owner UAT + orthogonality gate) | **scrubbed prod-map import** (real tenants/dossiers, rotated secrets) | **federation to prod IdP** (real users) |
| **PROD** | release tag, gated | live | `sent-tech.ca`, unchanged |

- **D11R — validation identity = FEDERATION (RATIFIED 2026-06-19 — ⊘ SUPERSEDED 2026-06-22: federation DROPPED; `dev.auth` is a standalone IdP, see DV4).** Validation is an **OIDC client of the PROD
  IdP**: real users authenticate at `auth.sent-tech.ca` (prod), validation consumes the prod-issued
  identity (validation-specific client/audience) and maps `sub`/tenant/workspace into its DB.
  **Passkey verification stays in prod only → no second login surface.** PREPROD keeps a distinct RP
  ID (synthetic, no real users). PROD unchanged. (Chosen over shared-parent-RP-ID, which Opus
  recommended + Codex flagged as a gated fallback; owner picked the security-cleaner federation.)
- **OQ2R — data policy split by tier (RATIFIED).** PREPROD = synthetic/scrubbed-shaped. VALIDATION =
  controlled scrubbed prod-map import (see D13/D14).
- **D12 — validation env shape (RATIFIED 2026-06-20 — ⊘ SUPERSEDED 2026-06-22: single `sentropic-dev` ns, main-aligned not gated, see DV2).** Permanent `sentropic-validation` namespace (own PG /
  secrets / hosts / KEK / signing keys). **Pending OQ1** (poc-cluster headroom for a 3rd namespace —
  if blocked, fall back to ephemeral/time-boxed).
- **D13/D14 — prod→validation import path (RATIFIED direction).** ⊘ SUPERSEDED 2026-06-22 (re-scoped by DV3/DV4/DV5: real data INCL PII + `webauthn_credentials` ARE imported now; the scrub still drops/rotates signing-keys/KEK/client-secrets/sessions/tokens). See § REVISION. — Repeatable make-driven, **fail-closed
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
| D6 | Per-env secrets | SealedSecrets per ns; **distinct KEK/DB/client-secrets/signing-keys per tier (now 2-way dev+prod — ⊘ was 3-way pre-2026-06-22, see § REVISION)**. |
| D10 | Ownership | Foundations builds; coord. scale; BR-55b0 owned by the cluster operator (cross-repo). |

## RATIFIED 2026-06-20 (final owner batch — all owner decisions now taken)

- **D4 — domain naming = NESTED (RATIFIED 2026-06-20 — ⊘ SUPERSEDED 2026-06-22: names → `dev.auth`/`dev.sentropic`, see DV1).** `preprod.auth.sent-tech.ca`,
  `preprod.sentropic.sent-tech.ca`, `validation.sentropic.sent-tech.ca` (tier = sub-domain; needs a
  `*.sent-tech.ca` wildcard cert or per-host DNS-01 — cert-manager already does DNS-01).
- **D8 — migration coupling = DECOUPLE (RATIFIED).** `MIGRATE_ON_BOOT` flag + dedicated migration
  Job/initContainer; pre-deploy `db-backup-prod` mandatory.
- **D9 — rollback = SHIP `db-restore-prod` (RATIFIED).** Real gated `db-restore-prod` (pg_restore into
  the live pod, proven on preprod first) + app-only digest-repin fast-path for no-migration releases.

## RESOLVED (facts, not owner picks)
- **OQ1 — cluster headroom = OK** (verified 2026-06-20). Node requests 19–36% CPU / 24–57% mem; each
  tier ≈ 290m CPU / 640Mi mem; preprod+validation fit. Each gets its OWN tenant-quota (the prod
  `sentropic` quota being near-full is irrelevant). Constraint is OQ0, not capacity.

## REMAINING — external (not an owner decision)
- **OQ0 — cluster operator** ⊘ REVISED 2026-06-22 (see § REVISION): a SINGLE `sentropic-dev` baseline (NOT preprod+validation). must create `poc-k8s/tenants/sentropic-dev/` baselines (Namespace, ResourceQuota, LimitRange, NetworkPolicy, pull-secret).
  Cross-repo (poc-k8s); hard predecessor to BR-55b/BR-55e. **Relayed via GitHub.**

---

## Implementation order (after the open decisions)
> ⊘ **REVISED 2026-06-22** — `preprod`→`dev` throughout; **BR-55e** = `dev` prod-data import (DV3/DV5) + standalone `dev.auth` parent-RP-ID (DV4) + D15 orthogonality, **NO federation client**. See § REVISION.
BR-55b0 (poc-k8s baselines: preprod + validation) → BR-55a (kustomize base/overlays, kills the
K8S_INGRESS gate) → BR-55b (preprod ns + DB) → **BR-55c (`cd.yml` main→preprod; + the publish-only
staleness fix)** → BR-55d (`release-prod.yml` + D7 gate + D8/D9 migration/rollback) → BR-55e
(validation ns + federation client + D13/D14 import + D15 orthogonality suite). Detail: PR #340.
