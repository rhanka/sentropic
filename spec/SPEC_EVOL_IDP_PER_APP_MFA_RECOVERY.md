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

### 2.3 Recovery and enrolment baseline — the gap

Every row below is `[EXISTS]` at the baseline. The assurance column uses the
vocabulary of section 5: `MFA` means a session whose ceremony included user
verification; `bearer` means any other authenticated session; `enrolment-only`
means a session that may create a credential but satisfies no client.

| Path | What merged code does | Assurance of the resulting session |
|---|---|---|
| Passkey login | Verifies the credential, requires verified email and an enabled account, then mints the session with `mfaVerified` from the ceremony (`api/src/routes/namespaces/auth/authentication.ts:84`) | `MFA` when UV present, else `bearer` |
| Add a device while signed in | The register surface is also the signed-in "add device" surface; credential rows are listed, renamed, and revoked per user behind a validated session (`api/src/routes/namespaces/auth/credentials.ts:52`, `api/src/routes/namespaces/auth/credentials.ts:76`) | Inherits the caller's session; no step-up is required by merged code |
| Magic link, account **with** devices | Marks the email verified, creates a session with no `mfaVerified` option (so false), and reports the devices as activated (`api/src/routes/namespaces/auth/magic-link.ts:140`) | `bearer` |
| Magic link, account **without** devices | Creates the same bearer session, flags `requiresDeviceRegistration`, explicitly to allow device registration (`api/src/routes/namespaces/auth/magic-link.ts:196`, `api/src/routes/namespaces/auth/magic-link.ts:224`) | `enrolment-only` in intent, `bearer` in fact (no endpoint restriction) |
| "Lost your device?" | Login shows the lost-device notice and links to the register surface; the register flow is email code plus WebAuthn enrolment (`packages/auth-ui/src/components/AuthLogin.svelte:102`, `spec/WORKFLOW_AUTH.md:97`) | Email proof alone reaches enrolment |
| Register / enrol a credential (existing user) | With a valid email token or invite for that email, an existing verified user receives registration options for the existing `userId`; no signed-in session and no existing credential is required (`api/src/routes/namespaces/auth/registration.ts:136`) | Email proof alone creates the credential |
| Register finalisation | Persists the credential, then creates a session with no `mfaVerified` option (so false) (`api/src/routes/namespaces/auth/registration.ts:363`) | `bearer`; the **next** passkey login with UV is `MFA` |
| Invite-token enrolment | A `sit_` invite is checked read-only for routing and consumed atomically at credential persist; invalid states collapse to the generic email-verification outcome (`api/src/routes/namespaces/auth/registration.ts:42`, `api/src/routes/namespaces/auth/registration.ts:440`) | Email-equivalent proof; single-use |
| Federation login (for example Google) | The broker mints a session through the package session service, whose default is `mfaVerified=false` (`api/src/routes/namespaces/auth/federation.ts:161`, `packages/auth-hono/src/session.ts:75`) | `bearer` |
| Credential storage | One row per credential in `webauthn_credentials`, cascade-deleted with the user (`api/src/db/schema.ts:168`) | No recovery-code or second-factor table exists |

**Gap G-RECOVERY (verified, both device cases).** Control of the mailbox
alone is sufficient to obtain a new `MFA` session for a forced-MFA account:

1. Account **with** devices: request an email code, complete the register
   flow for the existing user (no existing passkey is asked), persist an
   attacker-controlled credential, then sign in with it with UV. Authorize
   for a `passkey-fresh` client now passes, because the new ceremony minted
   `mfaVerified=true`. The pre-existing devices are never revoked by this
   flow.
2. Account **without** devices: verify a magic link, take the temporary
   session to the register surface, persist a credential, then sign in with
   it with UV. Same result, one step shorter.

In both cases the forced-2FA application inherits **email security**, which
is exactly what per-application forced 2FA is meant to avoid. Authorize-side
refusal (`access_denied` for a bearer resume) does not close the gap: it
refuses the bearer session, but the attacker first converts email proof into
a credential and only then asks for authorization.

Two adjacent gaps follow from section 2.2:

- **Gap G-FRESH.** No freshness window: `meetsRequiredAcr` compares strings
  only, so session age never triggers step-up for a forced client.
- **Gap G-NAME.** The required value names a method (`passkey-fresh`). A
  future second qualifying method would either need a new client value
  (policy churn per client) or would have to pretend to be a passkey. The
  owner correction forbids both: the level is the policy, the method rides
  in `amr`.

What already holds and must not regress: a bearer session (magic link,
federation, passkey without UV) is refused for a policy client after the
forced re-auth leg, an unlisted subject is refused before consent, and a
client with no policy is byte-identical to legacy behaviour. Section 8.2
pins those behaviours as non-regression tests.

## 3. Threat model

### 3.1 Assets and security property

Assets, in order: (1) access to a forced-MFA application behind its RP
(first target: the KVM console reached through `kvm-gateway`); (2) the IdP
account and its credentials; (3) the IdP session; (4) availability of the
legitimate owner's access (recovery must not become a lockout).

Security property **P-MFA**: for any client with a required MFA level, the
IdP issues an authorization code only for a session whose MFA ceremony is
**qualifying** (section 5), **fresh** (section 5.3), and whose **subject is
allowlisted** when the client carries a list. No email-only path may create
a credential, session, or code that satisfies P-MFA, directly or by a
two-step conversion (email → credential → MFA session).

Availability property **P-REC**: an owner who loses every authenticator
still has at least one recovery path that restores access without
satisfying P-MFA by itself and without silently weakening P-MFA for the
next sign-in.

### 3.2 Adversaries and assumptions

| ID | Adversary / event | Capability assumed | Out of scope |
|---|---|---|---|
| T-MAIL | Mailbox compromise | Reads email codes, magic links, invites, and notifications for the victim address | Compromise of the authenticator device itself |
| T-DEVLOSS | Loss of all authenticators (benign) | Owner retains mailbox and any recovery material enrolled earlier | — |
| T-SESS | Session theft | Holds a bearer session cookie/token | Holds an MFA session within its freshness window (bounded by section 5.3) |
| T-SUBJ | Valid account, wrong subject | Authenticates correctly but is not on the client's allowlist | — |
| T-OPER | Break-glass operator | Holds cluster access and the IdP admin account used by the governed Job | A malicious operator with both is trusted; the control is audit, not prevention |
| T-RP | RP compromise (including the KVM gateway host) | Sees tokens the RP legitimately receives | Cannot mint IdP sessions; exact-match redirect URIs and client authentication bound the blast radius |

Assumptions carried from merged code: WebAuthn ceremonies require user
verification for every role; the IdP stores a client secret only as its
SHA-256; redirect matching is exact-string; `tid` is never taken from a
request parameter. Email delivery, the cluster, and the operator channel
for the governed Job are trusted for **delivery**, never for **assurance**:
anything that arrives by email is at most email proof, whatever it carries.

