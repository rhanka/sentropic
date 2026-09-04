# SPEC EVOL — Recurring auth prod→preprod identity sync

Status: **DESIGN — ratified decisions captured; implementation gated on double-review + the DV3
hardening predecessor + the tenant-topology input (§9).** Owner directive 2026-08-22 (relayed via
i-cond): preprod must mirror prod identities so every user keeps their prod passkey + approved state
across each prod→preprod re-import, with **no re-enrolment, no re-consent, no `pending`**. This spec
consolidates the design; it does not authorise the code.

Domain owner: auth/IdP lane. Cross-repo touchpoints: radar-immobilier (`account_users`, owner = app
lane) and poc-k8s (on-cluster execution, OVH). Related decisions kept separate:
`SPEC_AMENDMENT_D11R_LOGIN_A.md` (RP-ID parity, already applied) and
`SPEC_DECISION_WEBAUTHN_LOGIN_ENUMERATION.md` (#551, the `/auth/login/options` oracle).

## 1. Grounding (ratified)

- **DV3** — preprod holds a real prod-data copy incl. PII → **non-public ingress is a HARD predecessor**
  to any all-users run (private ingress / IP-allowlist, NetworkPolicy, RBAC, audited, encrypted
  backups). See `SPEC_DECISION_DEPLOYMENT_PLANE.md`.
- **DV4** — parent RP ID at the IdP + import of `webauthn_credentials` (public-key rows) so the prod
  passkey verifies in preprod. Applied via Login-A.
- **DV5** — preprod keeps its OWN crypto: signing keys, `OAUTH_SIGNING_KEK`, DB creds, OAuth client
  secrets are NOT imported; sessions/tokens/auth-codes/magic-links are NOT imported.

## 2. Scope (STRICT — additive, FK-safe, in-region)

**Imported:** `users`, `webauthn_credentials` (public keys), `oauth_consents`.
**Excluded (never imported):** `id_token_signing_keys`, `oauth_clients` secrets, `service_clients`,
any `*.token_secret`, `password_hash`, `sessions`/`user_sessions`, `oauth_tokens`,
`authorization_codes`, `magic_links`/`email_verification_codes`, WebAuthn challenges.
**Residence:** on-cluster Job (pattern `geo-preprod-sync`), CD-triggered, PII **never** through a CI
runner. Mechanism: **additive upsert, FK-safe, no wipe** (`users` is referenced by 35 FKs — a DELETE
or a blind re-key breaks them; see §4).

## 3. Identity model — the core

**Verified fact:** the OIDC `sub` the IdP issues to a client = the IdP `users.id`
(`token-handler.ts:406,449` `subject: codePayload.userId`; `userinfo-handler.ts:41` `sub: user.id`).
So every consumer's stored subject (e.g. radar `account_users.sub`) is the IdP `users.id`.

**Root cause of divergence (D1):** when a user logs into preprod BEFORE the clone runs, the IdP
mints a preprod-native `users.id` (random UUIDv4, `register.ts:202`) ≠ the prod id → a different
`sub` → consumer rows keyed by the prod sub don't match → `pending`.

**Decision (ratified, IdP-authority sign-off):**

- **Steady-state = B (preserve prod `users.id` at INSERT).** The clone upserts users with the prod id
  (`ON CONFLICT (id) …`), never creating a preprod-native id for a prod user → preprod `sub` = prod
  `sub` → every consumer (`account_users`, `approved_by`, `actor_sub`, `invited_by`, `oauth_consents`)
  matches **natively**. No downstream remap.
  - **Cost is near-zero and touches NO FK**: we INSERT with the right id; we do NOT re-key an existing
    id. The expensive path (see §4) is avoided entirely.
- **Backlog = A (consumer-side remap) for pre-clone-diverged users only.** Users who logged into
  preprod before the clone hold a native id; their consumer rows are re-keyed prod_sub→preprod_sub by
  a narrow, non-destructive, FK-safe transaction on the consumer side (radar `account_users`; owner
  already done). No fake-approve.
- **Collision gate (steady-state):** before inserting/adopting a prod id, pre-check that no preprod
  row already holds `id = prod_id` (would be the clone's own prior import, or an astronomically
  unlikely UUID collision) → FAIL / merge. Run the clone as early as possible so the backlog stays
  small.

## 4. Why NOT a 35-FK re-key

`users.id` is referenced by **35 FKs** (schema.ts), all `onDelete cascade`/`set null`, **none with
`onUpdate`**. Re-keying an EXISTING `users.id` therefore needs `ON UPDATE CASCADE` on all 35 (a
migration) or a 35-table transaction — expensive. **This cost exists only for re-keying an existing
id, which B-at-INSERT never does.** So the review's "~15-17 FK cascade" concern is moot: the correct
form of B is insert-time preservation, not existing-id re-keying. The consumer-side remap (A) for the
small backlog is cheaper than re-keying the IdP id and is confined to the consumer's own tables (e.g.
radar `account_users` has a single FK on `sub`: `account_user_status_events.user_sub`).

## 5. Client mapping (`oauth_consents`)

With B, the USER matches via the preserved id, but the **`client_id` still differs per tier**
(`radar-immobilier` vs `radar-immobilier-preprod`) and `oauth_clients` has **no stable cross-env
identity** (`client_id` and `name` both differ). Two parts:

- **Add a `logical_id`/slug column to `oauth_clients`** — identical across tiers — so consents (and
  any cross-env client reference) map reliably instead of by fragile id-suffix/name convention.
- **`oauth_consents` import remaps only the client leg:** resolve `client_id` prod→preprod via
  `logical_id`; the user leg needs no resolution (id preserved). `scopes` is a `text[]`; conflict key
  is the unique `(user_id, client_id, tenant_id)`. `DO NOTHING` for a first import;
  `DO UPDATE SET scopes = EXCLUDED.scopes` for the recurring cycle (prod = source of truth). No secret
  columns exist in `oauth_consents` — nothing to exclude.

## 6. Must-fixes (double-review + auth-lane)

1. **Deprovisioning / staleness.** Additive-only leaves a prod-revoked user active in preprod. DELETE
   is FK-blocked, so the recurring run must **mirror `disabled_at`/`account_status`** and, for users
   absent from the prod snapshot, **disable in preprod** (or targeted-remove their
   `webauthn_credentials`, which have fewer dependents). Non-negotiable for an all-users recurring
   mirror.
2. **Counter no-regress.** Re-importing `webauthn_credentials` must not lower a preprod-local `counter`
   below the authenticator's current value (false clone-detection). Import as-is on first load; on
   re-import, `GREATEST(existing, imported)` or leave the local counter untouched.
3. Carry the raw-clone review's must-fixes (the set that rejected the "raw clone" design) and close
   each explicitly in the implementation PR.

## 7. Gates (hard)

- **DV3 non-public ingress BEFORE the first all-users run** (real PII on a public host = downgrade).
  Infra/poc-k8s; hard predecessor.
- **DV5 key handling** — never import signing keys/KEK/secrets; preprod mints its own.
- **Double-review (Fable+Opus) before any implementation.**

## 8. Sequencing

1. **Backlog (A), one-shot — done for owner** (radar `account_users` FK-safe remap, committed by k8s).
2. **Steady-state (B) on the next clone** — clone preserves prod `users.id` at insert + collision
   pre-check.
3. **Recurring CI Job** (per tenant) — only after the DV3 hardening gate is satisfied.

## 9. Open input (blocks the per-tenant CD hook only)

**Tenant→preprod topology:** one shared preprod IdP DB, or one per tenant (openerp / immo / …)? This
determines the per-tenant CD trigger shape. Owner of the answer: poc-k8s / i-infra (cluster). The rest
of this design is topology-independent.

## Provenance

Owner directive 2026-08-22; A-vs-B ratified by Fable+Opus double-review + auth-lane IdP sign-off (the
35-FK decomposition). Facts verified against `origin/main` (schema.ts FK count, `sub = users.id` in
token-handler/userinfo, UUIDv4 id generation).
