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

## 4. Policy model — required MFA level, per client and per account

### 4.1 Client policy: the level is the policy, the method rides in amr

Owner correction applied: a client requires an **assurance level**, never a
named method. The normative reading of the existing columns is:

| Column | Normative meaning after this spec | Baseline status |
|---|---|---|
| `oauth_clients.required_acr` | Required MFA level for the `authorization_code` flow. `NULL` = no MFA policy (legacy behaviour, byte-identical). The MFA level is satisfied by **any qualifying method** (section 5.1) | Column and authorize enforcement `[EXISTS]`; method-neutral value `[TO BUILD Lot 5]` |
| `oauth_clients.allowed_user_ids` | Subject allowlist, refused with `access_denied` before consent; empty = no restriction. Independent of MFA: an MFA session for an unlisted subject still fails | `[EXISTS]` |
| Freshness bound for the MFA level | Per-client maximum age of the MFA ceremony (section 5.3). Stored with the client or applied as a server default for MFA clients; the exact column and default are Lot 2 work | `[TO BUILD Lot 2]` |

Should `urn:sentropic:loa:passkey-fresh` become a method-neutral value?
**Yes — as the required level, with a backward-compatible alias.** Keeping a
method name as the level would force every future qualifying method to
either change every client's stored policy or misreport its method. The
target vocabulary is:

| Value | Kind | Meaning |
|---|---|---|
| `urn:sentropic:loa:bearer` | Session level (emitted) | Authenticated session without a qualifying MFA ceremony. Never satisfies an MFA client |
| `urn:sentropic:loa:mfa` | Session level (emitted) **and** required level | Session whose ceremony was a qualifying MFA method within the freshness bound. The method is in `amr`, never in this value |
| `urn:sentropic:loa:passkey-fresh` | Required level (legacy alias) | Deprecated spelling of the same MFA level. Accepted as a requirement during migration (section 10.1); no longer the recommended value for new clients |

Rules:

- **R-POL-1 (method neutrality).** `[TO BUILD Lot 5]` Authorize compares
  **levels**, not methods: a session at level `mfa` satisfies a client
  requiring `mfa` and, during migration, a client still requiring
  `passkey-fresh`. `amr` (`['hwk','user','mfa']` today) is informational
  for RPs that want the method; the IdP guarantee does not depend on the
  RP reading it. KVM reads neither (section 11).
- **R-POL-2 (fail closed).** `[EXISTS]` An unknown required value refuses
  (`meetsRequiredAcr` returns false). The neutral rename keeps this: any
  required value outside {`mfa`, `passkey-fresh` alias, `bearer`} refuses.
- **R-POL-3 (no silent weakening).** Lowering or clearing a client's
  required level is a governance act (section 9), audited, and never a
  side effect of secret rotation: rotation already preserves the stored
  policy unless the operator explicitly supplies a replacement
  (`docs/oauth-client-rotation.md:49`) `[EXISTS]`.

Backward-compatible migration (summary; steps and lots in section 10.1):
`kvm-gateway` is created **now** with `passkey-fresh`, the only MFA value
merged code understands — creating it with an unrecognised `mfa` value
today would fail closed for everyone, including the owner. Lot 5 teaches
authorize both spellings, then a governed re-registration moves each MFA
client's stored value to `mfa`, then the emitted session level switches to
`mfa`. At no step does a previously refused bearer session become accepted.

### 4.2 Account policy: the floor can only rise

Client policy alone cannot express "this account must never recover by
email", because the same account also uses non-forced clients where email
recovery stays legitimate (section 14). The account-side model is therefore
a **derived hardening set**, not a per-account level the user can lower:

- **Definition.** `[TO BUILD Lot 3]` An account is **MFA-hardened** while
  it appears in `allowed_user_ids` of at least one client whose required
  level is MFA (either spelling), or once it has completed enrolment for
  such a client. The set is derived from client rows; no user-facing toggle
  creates or removes membership.
- **Effect.** For an MFA-hardened account, email proof alone never creates
  a credential and never mints a session above `enrolment-only`
  (section 6). Non-hardened accounts keep today's behaviour exactly,
  including magic-link recovery and the "Lost your device?" flow.
- **Credential-count prerequisite.** `[TO BUILD Lot 4]` Before an account
  is first allowlisted on an MFA client (KVM first), it must hold **at
  least two registered credentials** (kvm-lane option (a), adopted in
  section 7). The check runs at allowlist time and at authorize time as a
  defence in depth: an account that drops to one credential is prompted to
  enrol a second at its next MFA sign-in, but is not locked out of the
  forced application for that reason alone (lockout is governed by
  section 6, not by the count).
- **No account-level downgrade.** Removing an account from every MFA
  allowlist ends hardening prospectively. It never revives credentials,
  sessions, or recovery codes created under the weaker posture, and the
  removal itself is audited (section 9).

No new `users` column is required for the hardening set itself. Recovery
codes (section 7, option (c)) do need storage; that table is specified in
Lot 4 and holds only hashes.

## 5. Sessions, tokens, freshness, and step-up

### 5.1 Which sessions satisfy a forced-MFA client

Qualifying methods today: **WebAuthn with user verification only**
(`mfaVerified=true` at mint). Magic link, federation, invite, registration
finalisation, and a passkey ceremony without UV are non-qualifying. A
future method qualifies by minting `mfaVerified=true` through its own
ceremony verification; no client row changes when that happens (R-POL-1).

| Session origin | Level today | Level after this spec | Satisfies an MFA client? |
|---|---|---|---|
| Passkey login with UV, within freshness bound | `passkey-fresh` (emitted) | `mfa`, `amr=['hwk','user','mfa']` | Yes `[EXISTS]` for the boolean part; freshness `[TO BUILD Lot 2]`, neutral emission `[TO BUILD Lot 5]` |
| Passkey login with UV, older than the bound | `passkey-fresh` (still passes today — G-FRESH) | `mfa` ceremony, **stale**: treated as below level at authorize | No — step-up (section 5.3) `[TO BUILD Lot 2]` |
| Passkey login without UV | `bearer` | `bearer` | No `[EXISTS]` |
| Magic link (with or without devices) | `bearer` | `bearer`; the no-device variant is additionally restricted to enrolment endpoints (section 6) | No `[EXISTS]` refusal; endpoint restriction `[TO BUILD Lot 3]` |
| Federation (for example Google) | `bearer` | `bearer` | No `[EXISTS]` |
| Registration finalisation | `bearer` | `bearer` | No `[EXISTS]` |
| Recovery-code redemption (option (c)) | — (does not exist) | `enrolment-only`: satisfies no client, may enrol one credential (section 6) | No `[TO BUILD Lot 4]` |
| Break-glass reset session (option (b)) | — (does not exist) | `enrolment-only`, single-purpose, short-lived | No `[TO BUILD Lot 4]` |

Token contract (unchanged in shape): the authorization code seals `acr`,
`amr`, and `auth_time` from the session, and both tokens carry them
(`packages/auth-hono/src/oauth/token-handler.ts:430`) `[EXISTS]`. After
Lot 5 the sealed `acr` for a qualifying session is the neutral `mfa` value.
RPs other than KVM may keep reading `acr`/`auth_time`; `kvm-gateway`
performs no such check and relies on the IdP having refused every
non-qualifying authorize (the IdP-side guarantee pinned by section 8.2).

### 5.2 Where enforcement lives

All enforcement stays at **authorize** (initial leg and resume leg), reusing
the merged seams: below-level or stale ⇒ forced re-authentication;
still below level after re-authentication ⇒ `access_denied` to the RP
redirect URI; unlisted subject ⇒ `access_denied` before consent
`[EXISTS]`. No token-endpoint or userinfo change is needed, because a code
is only ever sealed from a session that already passed authorize.

### 5.3 Freshness and step-up rules

- **R-FRESH-1.** `[TO BUILD Lot 2]` An MFA session satisfies an MFA client
  only while `now - session.createdAt <= client freshness bound`. The
  bound is per client (KVM value in section 11); when an MFA client has
  no explicit bound, the server default for MFA clients applies. The
  default value is an owner decision (section 15); this spec recommends
  hours, not days, and never the 7-day session lifetime.
- **R-FRESH-2 (step-up, not lockout).** A stale MFA session is handled
  exactly like a below-level session today: authorize redirects to login
  with the force-reauth continuation sealed; the resume leg refuses with
  `access_denied` if the new ceremony is still non-qualifying. The old
  session is not revoked (merged behaviour: the user may abandon the flow
  and keep it for non-forced clients) `[EXISTS pattern, extended by Lot 2]`.
- **R-FRESH-3 (request parameters).** `[TO BUILD Lot 2]` Authorize learns
  the standard `max_age` and `acr_values` request parameters as
  **hints that can only raise** the requirement: `max_age` tighter than
  the client bound wins for that request; `acr_values` naming the MFA
  level on a client without a stored policy triggers the same forced
  re-auth, but never downgrades a stored policy. `prompt=login` and
  `prompt=select_account` keep their merged force-reauth meaning.
  Discovery then advertises `acr_values_supported` with the neutral value
  (plus the legacy alias during migration).
- **R-STEP-1 (sensitive IdP operations).** `[TO BUILD Lot 3]` Creating or
  revoking a credential for an MFA-hardened account requires a current
  MFA session (fresh, qualifying), except inside the two enrolment-only
  recovery sessions of section 6, which may create exactly one credential
  and nothing else. Today merged code requires only a validated session
  for credential management; the step-up is the new part.
- **R-DOWN-1 (no downgrade path).** No flow converts an MFA session into a
  weaker one for the same client, no parameter clears a stored policy,
  and ending hardening (section 4.2) never retroactively validates a
  credential created by email proof. Refresh reuses the same session row
  and can never raise its level: a bearer session stays bearer until a new
  qualifying login mints a new session `[EXISTS]`.

## 6. Recovery and re-enrolment paths (target behaviour)

Normative principle **R-REC-0**: for an MFA-hardened account, **email proof
alone never creates a credential and never mints a session above
enrolment-only**. Email stays in the system as a notification channel and
as the recovery path for non-hardened accounts. The table is the complete
inventory; any new path must be added here before it ships.

| ID | Path | Target behaviour for an MFA-hardened account | Level granted |
|---|---|---|---|
| P-NORM | Sign in with an existing credential (UV) | Unchanged | `MFA` (fresh) `[EXISTS]` |
| P-ADD | Add a credential while signed in | Requires a fresh `MFA` session (R-STEP-1); the new credential is usable immediately; all sessions and the account address are notified (section 9) | Caller's `MFA` session continues `[TO BUILD Lot 3]` |
| P-REVOKE | Revoke a credential while signed in | Requires a fresh `MFA` session; revoking the last credential of a hardened account warns and requires re-confirmation, and revokes recovery codes with it | — `[TO BUILD Lot 3]` |
| P-MAGIC-HAS | Magic link, account has devices | Session stays `bearer` and is refused by MFA clients (unchanged). It **cannot** enrol a credential: the register surface for a hardened account rejects email-only enrolment and directs to P-ADD (sign in first), P-CODE, or P-BREAK | `bearer` only `[EXISTS]` refusal; enrolment block `[TO BUILD Lot 3]` |
| P-MAGIC-NONE | Magic link, account has **no** devices (`api/src/routes/namespaces/auth/magic-link.ts:194` temporary session) | The temporary session becomes truly **enrolment-only**: it may complete exactly one credential enrolment and call no other authenticated endpoint. For a hardened account it is not issued at all (see R-REC-1); for a non-hardened account it keeps today's purpose (first device after email proof) | `enrolment-only` `[TO BUILD Lot 3]` |
| P-LOST | "Lost your device?" (email code → register) | For a hardened account, email code alone stops at a recovery notice (choose P-CODE or P-BREAK); the current direct-to-enrolment behaviour is retained only for non-hardened accounts | None for hardened accounts `[TO BUILD Lot 3]` |
| P-INVITE | Invite-token enrolment (new account) | Unchanged for account creation. An invite never allowlists the new account on an MFA client by itself; allowlisting still passes the two-credential prerequisite (section 4.2) | `bearer` at finalisation `[EXISTS]` |
| P-FED | Federation sign-in (for example Google) | Unchanged `bearer`; cannot enrol a credential for a hardened account (same block as P-MAGIC-HAS) | `bearer` only `[EXISTS]` refusal; enrolment block `[TO BUILD Lot 3]` |
| P-CODE | Recovery code → enrolment (option (c)) | A single-use code enrolled earlier under an `MFA` session redeems for a short-lived enrolment-only session that may enrol exactly one new credential; the owner must then sign in with that credential (UV) to reach `MFA`. Codes never satisfy a client directly | `enrolment-only` `[TO BUILD Lot 4]` |
| P-BREAK | Break-glass reset (option (b)) | Governed Job run with the IdP admin account revokes **all** credentials, sessions, and recovery codes of the account and issues a single-purpose enrolment-only grant; the owner enrols a fresh credential and signs in. Fully audited and notified (section 9) | `enrolment-only` grant `[TO BUILD Lot 4]` |

Rules that cut across the table:

- **R-REC-1 (closing the no-device email path).** `[TO BUILD Lot 3]`
  For an MFA-hardened account, the handler at
  `api/src/routes/namespaces/auth/magic-link.ts:194` must not mint the
  temporary registration session on email proof alone. It returns the
  generic recovery notice (no account-state signal beyond what the caller
  already proved by holding the link) and notifies the account address
  that a recovery was attempted. **Effective from Lot 3**, which is the
  lot that makes KVM's required-MFA guarantee true; before Lot 3 lands,
  `kvm-gateway` must not be allowlist-enforced as an MFA-only client
  (section 10.2 orders the two). The non-hardened branch of the same
  handler is unchanged.
- **R-REC-2 (with-devices case).** The with-devices magic-link session
  (`magic-link.ts:140`) already mints `bearer` and is already refused by
  MFA clients; Lot 3 adds only the enrolment block (P-MAGIC-HAS), so email
  proof cannot be converted into a credential from that session either.
  Together R-REC-1 and R-REC-2 close both halves of G-RECOVERY.
- **R-REC-3 (enrolment-only confinement).** An enrolment-only session (or
  break-glass grant) authorizes exactly: create one credential for its own
  account, list that the enrolment completed, and sign out. Authorize,
  consent, credential revoke, recovery-code management, and every other
  authenticated endpoint refuse it. It expires in minutes (Lot 3/4 sets
  the exact TTL, single-digit minutes for the break-glass grant), is
  single-enrolment (a second create attempt refuses), and its use is
  audited. Confinement is enforced server-side by session purpose, never
  by hiding UI links.
- **R-REC-4 (no retroactive upgrade).** A credential created inside an
  enrolment-only session is a normal credential afterwards: the **next**
  sign-in with UV is what reaches `MFA`. Enrolment itself never seals an
  authorization code and never marks the enrolment session as `MFA`.
- **R-REC-5 (first enrolment of a brand-new account).** A new account is
  not hardened until it is allowlisted (section 4.2), so initial
  enrolment by email code or invite stays as merged. Hardening, the
  two-credential prerequisite, and the email block all engage at
  allowlist time, in that order (section 10.2).

## 7. Recovery means — evaluation and recommendation

The kvm lane proposed four options. Each is evaluated against T-MAIL
(mailbox compromise must not yield P-MFA), T-DEVLOSS (owner who lost every
authenticator must regain access), and operability for a single-owner
first client.

| Option | T-MAIL | T-DEVLOSS | Cost / failure mode | Verdict |
|---|---|---|---|---|
| (a) At least 2 registered passkeys before forced 2FA is enabled on an account | Neutral: does not stop email enrolment by itself | Strong improvement: loss of one device is a normal P-ADD, not a recovery | Enrolment friction once; a synced passkey and a hardware key count as two rows only if they are two distinct credentials | **Adopt** as the allowlist prerequisite (section 4.2, Lot 4) |
| (b) Emergency reset only by a k8s Job run with the admin account | Strong: requires cluster access plus the admin account; email plays no role | Always available, but slow (operator in the loop) and total (all credentials revoked) | Rare, deliberate, fully audited; unusable as a self-service path | **Adopt** as the break-glass floor (P-BREAK, Lot 4) |
| (c) Optional recovery codes that only give a weak level and force re-enrolment | Sound **only** under three conditions: codes are generated solely under an `MFA` session, stored hashed and single-use, and redemption grants enrolment-only (never `MFA`). A code mailed or stored with the mailbox collapses to T-MAIL | Self-service recovery without an operator; loss of codes plus devices falls back to (b) | Needs enrolment UX, hash storage, rate limiting, and revocation on credential changes | **Adopt as opt-in** per hardened account (P-CODE, Lot 4); whether KVM's owner enrols codes is an owner decision (section 15) |
| (d) No recovery by email alone | This is property P-MFA restated for recovery; without it every other option is bypassed by the register flow | Removes the familiar path, so (a)+(b) and optionally (c) must land with it | Breaks the current "Lost your device?" expectation for hardened accounts only | **Adopt as the invariant** R-REC-0 (Lot 3) |
| Baseline: keep email-code enrolment for everyone (status quo) | Fails: G-RECOVERY converts mailbox control into `MFA` in two steps | Convenient | Leaves forced 2FA as email security with extra steps | **Rejected** |

**Recommendation (normative).** Ship **(d) as the invariant, (a) as the
enrolment prerequisite, (b) as the guaranteed floor, and (c) as an opt-in
convenience**, in the lot order of section 13: Lot 3 enforces (d) and the
enrolment-only confinement, Lot 4 adds (a), (c), and (b). No single option
is sufficient alone: (a) without (d) still lets email enrol a third
credential; (d) without (a)/(b) risks owner lockout; (c) without the
enrolment-only bound would reintroduce a bearer-equivalent secret.

Explicitly rejected alternatives: email link plus a waiting period (delay
does not change who holds the mailbox; T-MAIL waits too), email plus
notification with veto window as the **sole** control (same reason;
notification remains required, but as detection, not authorization), and
requiring the RP to check `acr` for KVM (owner-decided: the gateway
performs no check; the guarantee is the IdP's).

