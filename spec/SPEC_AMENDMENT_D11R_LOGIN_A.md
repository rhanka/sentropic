# AMENDMENT — Login-A: preprod IdP WebAuthn RP ID → parent `sent-tech.ca`

Status: **RATIFIED** by owner (rhanka) 2026-08-20 — direct in-session finalization directive
("la totale"), relayed and gate-held by the immo conductor (i-cond). Supersedes the stale
synthetic-isolation wording in `overlays/preprod/patch-auth-idp-config.yaml`. Amends the governance
record in `SPEC_DECISION_DEPLOYMENT_PLANE.md`.

## What this changes

`deploy/k8s/overlays/preprod/patch-auth-idp-config.yaml`:
- `WEBAUTHN_RP_ID`: `preprod.auth.sent-tech.ca` → **`sent-tech.ca`** (parent).
- `WEBAUTHN_ORIGIN`: **unchanged** (`https://preprod.auth.sent-tech.ca`) — deliberately kept
  IdP-host-specific (anti-replay, see below).

Scope is **only the auth-IdP**. The product API (`overlays/preprod/patch-api-config.yaml`) keeps
`WEBAUTHN_RP_ID = preprod.sentropic.sent-tech.ca` and stays fully isolated. The mixed state is
deliberate: the owner's goal is that a prod passkey opens the login screen **at the IdP**
(`preprod.auth.sent-tech.ca`), which is where WebAuthn ceremonies for OIDC login happen; the API's
own WebAuthn surface is out of scope for Login-A.

## This is a reconciliation, not a new policy

The current overlay comment cited "D11R / FORK-2 — distinct preprod RP ID, fully isolated." That
describes the **three-tier model of 2026-06-19**, which `SPEC_DECISION_DEPLOYMENT_PLANE.md` itself
marks **⊘ SUPERSEDED 2026-06-22** (spec line 86/89). The current ratified model is the **two-tier**
one (§ REVISION 2026-06-22, decisions DV1–DV6), in which the single non-prod tier:

- **DV3** — is seeded with a **real prod-data copy, PII included**;
- **DV4** — runs a standalone IdP that **imports prod users incl. `webauthn_credentials`** and uses
  **`WEBAUTHN_RP_ID = sent-tech.ca`** so **existing prod passkeys verify with zero re-enrolment**;
- **DV5** — regenerates its **own** crypto (signing keys, `OAUTH_SIGNING_KEK`, DB creds, OAuth client
  secrets) and does **not** import sessions/tokens/auth-codes/magic-links.

The spec names that tier `dev` (`dev.auth.sent-tech.ca`, DV1). It is deployed as `preprod.*`. This
amendment records that **the deployed `preprod` non-prod tier IS the ratified single non-prod tier**;
the `dev.*` ↔ `preprod.*` naming drift is resolved in favour of the deployed names. Login-A therefore
does not overturn a ratified isolation guarantee — it **applies DV4**, which had been ratified but
never carried into the deployed overlay (the overlay still reflected the superseded synthetic tier).

## Anti-replay — the parent RP ID is only safe with these (DV4 must-enforce)

1. `WEBAUTHN_ORIGIN` stays `https://preprod.auth.sent-tech.ca` (this IdP's own host), NOT the parent.
2. The IdP allows **only** `https://preprod.auth.sent-tech.ca` as a WebAuthn assertion origin and
   **rejects** prod origins; prod **never** adds a preprod origin to its allowed set.
3. Server challenges stay single-use.
4. DV5 keeps the crypto axis distinct, so a preprod assertion/session can never mint a prod-valid
   token even though the `rpIdHash` is now shared with prod.

## Execution prerequisites (cluster-side, NOT in this PR — owned by infra)

This overlay key is a **prerequisite** for the passkey, not the whole of it, and must land **with**
the seed, never before it:

- **Sequencing** — merging/applying this RP-ID change alone breaks passkey login: the one existing
  preprod credential is bound to the old preprod RP ID, and no prod credentials exist here until the
  seed. RP-ID change and the DV3/DV5 seed apply together.
- **DV5 signing-key trap** — the prod dump carries `id_token_signing_keys` encrypted under the prod
  KEK; preprod uses a distinct KEK. After restore, the imported rows MUST be deleted/deactivated so
  the runtime mints a fresh key under the preprod KEK — otherwise the IdP stops issuing tokens for
  every RP and does not self-heal.
- **DV3 access-control gate** — once preprod holds real PII it MUST be access-controlled with prod
  strictness: **non-public ingress / IP-allowlist (no end-user traffic), NetworkPolicy + RBAC,
  locked-down exec/port-forward, audited PII access, encrypted backups.** preprod is currently
  publicly reachable; making it non-public is a **hard predecessor** to the real-PII seed and is
  infra's action.
- **Client rebuild** — the seed replaces the preprod IdP DB with prod's, which does NOT contain the
  preprod-only OAuth clients. After the seed, `radar-immobilier-preprod` (immo/poc-k8s) and
  `claude-ai-mcp` (public PKCE, `resource_indicators` byte-identical to `MCP_RESOURCE_URI`) must be
  recreated in the re-seeded preprod IdP DB.
- **Credential-holder notice** — the single existing preprod `webauthn_credentials` row is
  invalidated by the RP-ID change; its holder must be told to re-enrol (or it is dropped by the seed).

## Provenance

- Ratified model: `SPEC_DECISION_DEPLOYMENT_PLANE.md` § REVISION 2026-06-22, DV1–DV6.
- Superseded wording: same file, three-tier table line 89 (⊘ SUPERSEDED).
- Owner directive: 2026-08-20 (direct), gate-held by i-cond; executed by infra.
