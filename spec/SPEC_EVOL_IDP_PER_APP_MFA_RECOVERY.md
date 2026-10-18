# SPEC_EVOL — Per-application forced MFA (method-agnostic) and recovery

Status: **SPEC — design only**. Baseline `origin/main` at `94a38286e`. Branch
`spec/idp-per-app-mfa-recovery`. This document defines target behaviour; it
claims no implementation, deployment, or live-database result. Implementation
belongs to the BUILD lots in section 13 on separate branches.

Owner request (verbatim, 2026-10-18): « pour kvm, il faudrait que l'idp puisse
forcer le 2fa. le 2fa doit être pouvoir forcable selon les applications. que
faudrait il pour le permettre. En particulier, j'imagine un enjeu sur le
recovery car par nature webauthn est deja un 2fa ».

Binding corrections applied to this spec:

- KVM registering as an OAuth client of the IdP is a **given requirement**, not
  an option (owner addition, 2026-10-18).
- The per-application requirement is a **2FA assurance level, method-agnostic**
  (owner correction, 2026-10-18, binding): « attention : pour le passkey.
  exigence 2fa ok pas sur le mode de 2fa. webauthn est deja du 2fa ». WebAuthn
  with user verification is one qualifying method. Client policy expresses a
  required MFA level; `amr` carries the method that satisfied it.
- KVM's 2FA guarantee is provided by the **IdP, not the gateway** (kvm lane
  commitment, owner-decided): `kvm-gateway` performs no `acr`/`amr` check.
  Correctness therefore rests on IdP authorize enforcement plus the
  non-regression test in section 8.2.

Conventions in this document:

- `[EXISTS]` marks behaviour verified in merged code at the baseline, with a
  `file:line` citation.
- `[TO BUILD Lot N]` marks target behaviour assigned to an implementation lot
  in section 13. Nothing marked `[TO BUILD]` is claimed as merged.
- No secret value appears in this document. Secrets are named by variable
  only, following `docs/oauth-client-rotation.md`.

## 1. Objective and scope

Specify what the IdP needs so that 2FA can be forced **per application**,
with KVM as the first target, without reducing a forced-2FA application to
email security through recovery.

In scope:

- Per-client and per-account MFA policy model (method-agnostic).
- Which IdP sessions satisfy a forced-MFA client, including freshness and
  step-up.
- Every recovery and passkey re-enrolment path, its assurance level, and how
  the email-only path is closed or framed for required-MFA clients.
- Recovery means, downgrade rules, governance of client policy, audit and
  notifications, migration of existing clients and accounts.
- KVM onboarding as the `kvm-gateway` OAuth client (given parameters in
  section 11) and a compatibility note for a possible later Netbird client.

Out of scope (cited, never redesigned here):

- Tenant claim derivation and tenant selection: `tid` stays derived from a
  validated membership (`spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`); MFA policy
  is orthogonal to tenancy.
- OAuth client convergence between tiers:
  `spec/SPEC_EVOL_IDP_OAUTH_CLIENT_SYNC.md` already excludes tier-local policy
  from sync; this spec keeps that exclusion.
- RP session glue and any gateway-side token check for KVM: explicitly none,
  by the owner decision above.
- New MFA methods (for example TOTP): the policy model must admit them
  without a client-policy change, but enrolling one is not a lot here. Today
  the only qualifying method is WebAuthn with user verification.

Reuse rule: this spec reuses the merged per-client policy, session, and
registration mechanisms and does not duplicate them. Where merged behaviour
already satisfies a requirement, the spec says so and adds only the missing
gate, test, or declaration.

## 2. Verified baseline at 94a38286e

### 2.1 Per-client policy that already exists

| Behaviour | Evidence |
|---|---|
| `oauth_clients.required_acr` (nullable) and `allowed_user_ids` (default `'{}'`) added additively; `NULL` means no policy | `api/drizzle/0042_oauth_clients_mfa_policy.sql:8`, `api/drizzle/0042_oauth_clients_mfa_policy.sql:10` `[EXISTS]` |
| Same two columns on the Drizzle schema with the B3/C1 comments | `api/src/db/schema.ts:325`, `api/src/db/schema.ts:328` `[EXISTS]` |
| Authorize forces re-authentication when the live session is below `requiredAcr`, and refuses a still-insufficient resumed session with `access_denied` | `packages/auth-hono/src/oauth/authorize-handler.ts:80`, `packages/auth-hono/src/oauth/authorize-handler.ts:256` `[EXISTS]` |
| Allowlist refused before consent with `access_denied`; a forced re-auth in progress defers the refusal to the resume leg so another account can sign in | `packages/auth-hono/src/oauth/authorize-handler.ts:90`, `packages/auth-hono/src/oauth/authorize-handler.ts:253` `[EXISTS]` |
| `meetsRequiredAcr`: no policy allows any session; `passkey-fresh` requires exact equality; `bearer` allows any; unknown required values fail closed | `packages/auth-hono/src/oauth/authorize-handler.ts:401` `[EXISTS]` |
| Registration script parses `OAUTH_CLIENT_REQUIRED_ACR` and `OAUTH_CLIENT_ALLOWED_USER_IDS`; omitting them on rotation preserves the stored policy | `api/src/scripts/oauth-register-client.ts:152`, `docs/oauth-client-rotation.md:49` `[EXISTS]` |
| Tier sync treats `required_acr`/`allowed_user_ids` as tier-local policy and excludes them from the whole-row comparison | `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql:7` `[EXISTS]` |
| Product decision record for the same B3/C1 policy and the governed Job registration path | `spec/SPEC_DECISION_TIER_AUTH_PATTERN.md:95` `[EXISTS]` |

### 2.2 How a session earns its level today

| Behaviour | Evidence |
|---|---|
| Session ACR is `urn:sentropic:loa:passkey-fresh` exactly when `user_sessions.mfa_verified` is true, else `urn:sentropic:loa:bearer` | `packages/auth-hono/src/oauth/session-resolver.ts:47`, `packages/auth-hono/src/oauth/session-resolver.ts:51` `[EXISTS]` |
| `amr` is `['hwk','user','mfa']` for an MFA session, else `['pwd']` | `packages/auth-hono/src/oauth/session-resolver.ts:59` `[EXISTS]` |
| Only a passkey ceremony with `userVerified=true` mints `mfaVerified=true`; every other path defaults to false | `api/src/services/session-manager.ts:104`, `api/src/routes/namespaces/auth/authentication.ts:89` `[EXISTS]` |
| All roles require user verification at the WebAuthn ceremony | `api/src/services/webauthn-config.ts:59` (config block; every role `required`) `[EXISTS]` |
| Session lifetime is 7 days; the `mfaVerified` flag, once set, lasts the whole session | `api/src/services/session-manager.ts:53`, `api/src/db/schema.ts:195` `[EXISTS]` |
| `auth_time` in both tokens is the session creation instant sealed at authorize; refresh keeps the same session row | `packages/auth-hono/src/oauth/authorize-handler.ts:127`, `packages/auth-hono/src/oauth/token-handler.ts:435` `[EXISTS]` |
| Discovery advertises `acr`, `amr`, `auth_time` claims and `prompt` values, but no `acr_values_supported`; authorize parses `prompt` only (no `acr_values`, no `max_age`) | `packages/auth-hono/src/oauth/wellknown-handler.ts:44`, `packages/auth-hono/src/oauth/authorize-handler.ts:52` `[EXISTS]` |

Consequence already visible in the baseline: the value name says "passkey"
and "fresh", but the check is a **boolean with no age bound**. A passkey
session created six days ago still satisfies a `passkey-fresh` client. The
method name and the missing freshness bound are the two defects section 4
and section 5 correct without breaking existing clients.
