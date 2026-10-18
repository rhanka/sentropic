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
- KVM's per-application MFA policy is guaranteed by the **IdP**, and the **RP
  checks only that signed `amr` contains `"mfa"`** after standard OIDC token
  validation (`packages/auth-hono/src/oauth/token-handler.ts:472` `[EXISTS]`).
  `kvm-gateway` never selects an authentication method, never compares `acr`
  strings (`passkey-fresh` vs `mfa`), and never duplicates the IdP policy
  evaluator.

Parallel input reconciled: the independent Astra max study
(`.h2a/inputs/astra-idp-mfa-study.md`, 295 lines, sha256 prefix
`831fe527b7cf591d`) was reconciled point by point in
`.h2a/reviews/spec-idp-mfa-reconciliation.md`, adopting both the IdP-side
evidence/recovery rules and the RP `"mfa"`-in-`amr` membership check.

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
- Method-specific or `acr`-string gateway policy for KVM: after normal OIDC
  validation, the RP checks only that signed `amr` contains `"mfa"` and
  performs no method-name or `acr`-spelling comparison.
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
| Passkey login | Real verifier requires UV for every role (`api/src/services/webauthn-config.ts:59`), rejects UV=false (`api/src/services/webauthn-authentication.ts:173`, `:200`, `:215`), and on verified UV mints the session with `mfaVerified=true` (`api/src/routes/namespaces/auth/authentication.ts:84`) | `MFA` when UV succeeds; real verifier rejects UV=false (no session minted; the `bearer` branch at `authentication.ts:89` is a defence-in-depth fallback reached only when the verifier is stubbed, as in `api/tests/api/auth/passkey-mfa-session.test.ts:12`, `:92`) |
| Add a device while signed in (credential management) | The credential handlers list, rename, and revoke rows per user behind a validated session (`api/src/routes/namespaces/auth/credentials.ts:52`, `api/src/routes/namespaces/auth/credentials.ts:76`); enrolment itself happens on the register surface, whose finalization deliberately creates a **new** weak session rather than continuing the caller's (`api/src/routes/namespaces/auth/registration.ts:363`) | Enrol via register surface (email or invite proof); manage behind any validated session; no step-up in merged code |
| Magic link, account **with** devices | Marks the email verified, creates a session with no `mfaVerified` option (so false), and reports the devices as activated (`api/src/routes/namespaces/auth/magic-link.ts:140`) | `bearer` |
| Magic link, account **without** devices | Creates the same bearer session, flags `requiresDeviceRegistration`, explicitly to allow device registration (`api/src/routes/namespaces/auth/magic-link.ts:196`, `api/src/routes/namespaces/auth/magic-link.ts:224`) | `enrolment-only` in intent, `bearer` in fact (no endpoint restriction) |
| "Lost your device?" | Login exposes the lost-device slot and routes to `/auth/register`, where enrolment uses an email verification code plus WebAuthn ceremony (`packages/auth-ui/src/components/AuthLogin.svelte:102`, `:138`; `ui/src/routes/auth/login/+page.svelte:49`) | Email proof alone reaches enrolment |
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
2. Account **without** devices: whether starting from the no-device
   magic-link session (`api/src/routes/namespaces/auth/magic-link.ts:196`)
   or navigating directly to `/auth/register`, request and verify the
   separate email verification code
   (`api/src/services/email-verification.ts:138`, `:174`) to obtain the
   mandatory `verificationToken`
   (`packages/auth-hono/src/webauthn-registration-route-handlers.ts:104`,
   verified at `api/src/routes/namespaces/auth/registration.ts:232`),
   persist a replacement credential
   (`api/src/services/webauthn-registration.ts:200`, `:208`), and sign in
   with it with UV. Zero remaining devices carry no persistent protection
   state at baseline (`api/src/db/schema.ts:146`, `:168`).

In both cases the forced-2FA application inherits **email security**, which
is exactly what per-application forced 2FA is meant to avoid. Authorize-side
refusal (`access_denied` for a bearer resume) does not close the gap: it
refuses the bearer session, but the attacker first converts email proof into
a credential and only then asks for authorization.

Precision bounds on the gap (taken from the parallel study, verified
against the same sources): the magic-link cookie alone is not the
`verificationToken` that registration requires — the chain assumes mailbox
control, which supplies the separate email code; a stolen bearer cookie
alone cannot complete registration, but it **can** already delete
credentials or deactivate/delete the account (`api/src/routes/namespaces/auth/account.ts:71`, `:95`; section 6 `P-REVOKE` and `P-LIFECYCLE` close both). The
`requiresDeviceRegistration` flag is a UI signal, not a server-side
authorization boundary, and must never be treated as one. Two issuance
legs also need the shared evaluator of section 5.2: consent rechecks the
live session today `[EXISTS]`, while the authorization-code exchange leg
performs no fresh policy or account-generation recheck — Lot 2 defines
that recheck (stale or policy-changed transactions are refused rather
than minted below policy), preserving one-time code consumption and PKCE.
There is no OAuth refresh grant to protect (`offline_access` is refused);
local session refresh is the only refresh in scope.

Two adjacent gaps follow from section 2.2:

- **Gap G-FRESH.** No freshness window: `meetsRequiredAcr` compares strings
  only, so session age never triggers step-up for a forced client.
- **Gap G-NAME.** The required value names a method (`passkey-fresh`). A
  future second qualifying method would either need a new client value
  (policy churn per client) or would have to pretend to be a passkey. The
  owner correction forbids both: the level is the policy, the method rides
  in `amr`.

What already holds and must not regress: a bearer session (magic link,
federation, or the defence-in-depth mocked UV=false route fallback while the
real verifier rejects UV=false outright) is refused for a policy client
after the forced re-auth leg, an unlisted subject is refused before consent,
and a client with no policy is byte-identical to legacy behaviour.
Section 8.2 pins those behaviours as non-regression tests.

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
| T-ROOT | IdP database writer, signing-key holder, privileged cluster administrator | Can rewrite policy, bindings, or keys directly | Trust root: no design protects the IdP from its own roots. Controls are narrowed routine authority, attributable operations, and an independent owner recovery route (sections 7, 9) |
| T-STALE | Holder of an old invite, enrolment challenge, authorization code, or pre-change session | Replays material minted before a policy or recovery transition | Bounded by single-use consumption, security generation (section 4.2), and the token-leg recheck (section 5.2) |

Authentication is never authorization for KVM: open registration and a
pending-approval account can still authenticate at the OAuth host, so the
stable-subject allowlist (and the tier rules it sits under) is a load-bearing
part of P-MFA, not an optional extra.

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
| `oauth_clients.allowed_user_ids` | Subject allowlist, refused with `access_denied` before consent; empty `'{}'` means unrestricted in `authorize-handler.ts:412` only for clients declared unrestricted. Restricted clients (`require_non_empty_allowlist=true`, including `kvm-gateway`) reject missing/empty/unresolved subjects before mutation and never convert final-entry removal into `'{}'` | Base check `[EXISTS]`; fail-closed restricted guard `[TO BUILD Lot 1/6]` |
| Freshness bound and policy version | Per-client `max_mfa_age_seconds`, `policy_version`, and `require_non_empty_allowlist` (sections 5.3, 8.1, 9.1). Added in Lot 2's single migration; `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql:7`, `import-preprod.sql:35-154`, `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-10`, `reader-role.sql:30-37`, and `deploy/ci/idp-identity-sync/sql-test.sh` are updated and qualified in that same lot | `[TO BUILD Lot 2]` |

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

- **R-POL-1 (method neutrality).** `[TO BUILD Lot 5]` The policy evaluator
  compares **levels**, not methods: a qualifying fresh session at level `mfa`
  satisfies a client requiring `mfa` and, during migration, a client still
  requiring `passkey-fresh`. Signed `amr` carries `"mfa"` plus the method
  identifier (section 5.1 table); the IdP enforces the policy across all four
  issuance legs, and the KVM RP checks only that signed `amr` contains
  `"mfa"`, independent of the qualifying method and `acr` spelling
  (section 11).
- **R-POL-2 (fail closed).** `[EXISTS]` An unknown required value refuses
  (`meetsRequiredAcr` returns false). The neutral rename keeps this: any
  required value outside {`mfa`, `passkey-fresh` alias, `bearer`} refuses.
- **R-POL-3 (no silent weakening).** Lowering or clearing a client's
  required level is a governance act (section 9), audited, and never a
  side effect of secret rotation: rotation already preserves the stored
  policy unless the operator explicitly supplies a replacement
  (`docs/oauth-client-rotation.md:49`) `[EXISTS]`.
- **R-POL-4 (binding to the managed-app inventory).** `[TO BUILD Lot 5]`
  A client's required level is bound through the chain app template →
  app instance (template bound to tenant and environment) → OAuth
  client(s) of that instance's tier. The chain reuses the control-plane
  model (`control.app_templates`, `control.app_instances`,
  `control.app_instance_hostnames`, `control.app_workspace_bindings` in
  `spec/SPEC_EVOL_APP_CATALOG.md:29`) and the per-(project, tier) client
  rule (`spec/SPEC_DECISION_TIER_AUTH_PATTERN.md:5`): each tier's IdP
  holds its own `oauth_clients` rows and tier-local policy stays
  excluded from identity sync (section 10.3). The embedded Sentropic
  annotation session surface is an instance surface that consumes this
  policy when it requires MFA; it is not a separate client-policy
  definition. `kvm-gateway` is the first required client, not the
  definition of "app". OpenERP's standalone and brokered modes keep
  their own identity authority; the integration named here is the trust
  boundary (validated membership and token invariants), not an
  assumption that a Sentropic account exists
  (`spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md:5`, `:25`). Tenant claim
  derivation stays orthogonal to MFA policy
  (`spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md:5`).

Backward-compatible migration (summary; steps and lots in section 10.1):
`kvm-gateway` is created **now** with `passkey-fresh`, the only MFA value
merged code understands — creating it with an unrecognised `mfa` value
today would fail closed for everyone, including the owner. Lot 5 teaches
authorize both spellings, qualifies consumers and switches global emission
to `mfa` and the single target `amr` table, then moves each MFA client's
stored value to `mfa` through the governed Job. At no step does a
previously refused bearer session become accepted.

### 4.2 Account policy: stored protection and non-circular trust

Client policy alone cannot express "this account must never recover by
email", because the same account also uses non-forced clients where email
recovery stays legitimate (section 14). The account-side model is therefore
**persistent stored account protection (`is_mfa_protected`)**, never a
per-account level the user can lower or a transient derivation from client rows:

- **Definition (`is_mfa_protected`).** `[TO BUILD Lot 3, schema in Lot 2]`
  Protection is stored account state in the database; client rows may propose
  candidates but never constitute the state. An account starts with
  `is_mfa_protected = false` and transitions atomically to
  `is_mfa_protected = true` (coupled with a durable transition record in
  `api/src/services/auth/security-transition-store.ts`) upon any of three
  triggers, each requiring the section 10.2 non-circular trust bootstrap and
  at least two independently recoverable `trusted` credentials (R-REC-8):
  (1) allowlist binding on an MFA client, (2) first protected authorization
  to an unrestricted MFA client (`allowed_user_ids = '{}'`,
  `require_non_empty_allowlist = false`), committed atomically before any
  protected authorization code can be issued (an email-enrolled key without
  independent bootstrap provenance is `unverified_email` and can never supply
  its own bootstrap authority), or (3) explicit operator activation via the
  governed Job.
- **Effect.** For a protected account (`is_mfa_protected = true`), email proof alone never creates a credential, never mints an `enrolment-only` recovery capability, and never mints any session on the no-device magic-link path (on the with-devices magic-link path it may mint only a `bearer` session for non-MFA applications, with credential enrolment, credential revocation, federation linking/unlinking, and account self-deactivation/self-deletion at `api/src/routes/namespaces/auth/account.ts:71`, `:95` blocked; section 6). Non-protected accounts (`is_mfa_protected = false`) keep merged behaviour on both magic-link branches, `/auth/register`, and `/api/v1/auth/me*`.
- **Credential-count prerequisite.** `[TO BUILD Lot 4]` Before an account
  completes its protected-activation transition, it must hold **at least two
  independently recoverable `trusted` credentials** (R-REC-8) established
  through the section 10.2 trust bootstrap. The check runs at activation/allowlist
  time and at authorize time as defence in depth: a protected account that
  later drops to one `trusted` credential is prompted to enrol a second at its
  next MFA sign-in, but can still authenticate with the surviving credential.
- **Persistence and no account-level downgrade.** Once stored,
  `is_mfa_protected = true` persists across zero remaining credentials,
  non-MFA client detours, client deletion, policy relaxation, and entitlement
  removal or re-addition. Removing an account from a multi-subject allowlist
  or disabling/deleting a client ends only that entitlement (removing the
  final subject of a restricted client like `kvm-gateway` is rejected unless
  the client is explicitly disabled/deleted or widened under R-GOV-4; it
  never converts the row to unrestricted `'{}'`). De-protection is its own
  privileged audited operation (R-GOV-4) with a durable transition record,
  and never promotes `unverified_email`, `pending-recovery`, or `revoked`
  keys, sessions, or recovery codes to `trusted`.

Stored protection (`is_mfa_protected`), credential binding provenance (`trusted`, `pending-recovery`, `unverified_email`, `revoked`), `security_generation`, and durable transition records (`security_transition_records`) persist in the branch's single consolidated migration (designed in Lot 0, landed in Lot 2). Recovery codes (section 7, option (c) optional sublot) hold only subject- and generation-bound hashes. **Identity-sync boundary (`[TO BUILD Lot 2]`):** all new account/credential security columns, recovery capabilities/grants/codes, and `security_transition_records` are **tier-local** — never exported by `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-8` and never granted to `idp_identity_reader` in `deploy/k8s/overlays/prod/idp-identity-sync/reader-role.sql:30-33` (which retains its 13 `users` and 10 `webauthn_credentials` column grants). In `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`: (a) ordinary unchanged-ID user upserts (`:67-77`) preserve the target tier's existing `users.is_mfa_protected` and `users.security_generation`; (b) imported `webauthn_credentials` (`:144-154`) insert with `binding_state = 'unverified_email'` and `security_generation = 0` so an imported key never silently acquires `trusted` status in the target tier without that tier's own bootstrap or `P-ADD` ceremony, while `ON CONFLICT (id) DO UPDATE` preserves existing local `binding_state` and `security_generation` unless `public_key_cose`, `credential_id`, or `user_id` changed (which resets `binding_state` to `'unverified_email'`); (c) any email-collision `collide`/`rekey` pair (`:59-96`) where either `old_id` or `new_id` has `is_mfa_protected = true` (or holds `trusted`/`pending-recovery` credentials or active recovery grants) **fails closed (`RAISE EXCEPTION 'protected account rekey forbidden'`)** unless preceded by a deliberate R-GOV-4 de-protection and credential reset on that tier; and (d) new recovery-grant/code tables are added to the `ephemeral-auth` delete list (`:101-106`, `:123`) so generic sync never repoints or transfers recovery authority, while `security_transition_records` is exempted from the generic FK repoint loop (`:121-134`) so historical attribution is never rewritten.

**Evidence and generation (normative, Lot 0 design then Lots 2–3).** The
`mfaVerified` boolean stays as the merged mint flag, but BUILD lots must
not treat it as the whole evidence record. The target evidence for a
qualifying session is: authentication method(s) and `mfaCompletedAt`
(distinct from session creation and from last activity), the credential
identifier that participated, credential binding state (`trusted`,
`pending-recovery`, `unverified_email`, `revoked`) with its authorizing
ceremony or bootstrap/recovery `operationId`, an assurance schema version,
and a monotonically increasing per-account **security generation** that
bootstrap, recovery, protection activation, and full reset increment.
Refresh preserves the original ceremony times and generation and can
never create MFA evidence. Stored protection persists at zero credentials:
an account whose keys were all removed remains `is_mfa_protected = true`,
and zero credentials never re-opens weak bootstrap for it. Lot 0
(section 13) freezes the exact columns on the existing ports/adapters; no
parallel authentication subsystem is created and migration 0042 is not
edited.

## 5. Sessions, tokens, freshness, and step-up

### 5.1 Which sessions satisfy a forced-MFA client

Qualifying methods today: **WebAuthn with user verification only**
(`mfaVerified=true` at mint). Magic link, federation, invite, registration
finalisation, and a passkey ceremony without UV are non-qualifying. A
future method qualifies by minting `mfaVerified=true` through its own
ceremony verification; no client row changes when that happens (R-POL-1).

| Session origin | Level today | Target emitted `acr` and `amr` after this spec | Satisfies an MFA client? |
|---|---|---|---|
| Passkey login with UV, `trusted` binding, within freshness bound | `passkey-fresh`, `amr=['hwk','user','mfa']` | `acr='urn:sentropic:loa:mfa'`, `amr=['urn:sentropic:amr:webauthn','mfa']` (`+'user'` when UP verified; `+'hwk'` only with verifier hardware-binding evidence) | Yes `[EXISTS]` boolean; freshness `[TO BUILD Lot 2]`, final claims `[TO BUILD Lot 5]` |
| Passkey login with UV, `trusted` binding, older than the bound | `passkey-fresh` (still passes today — G-FRESH) | **Stale** for MFA: `acr='urn:sentropic:loa:bearer'`, `amr=['urn:sentropic:amr:webauthn']` (never `'mfa'`) | No — step-up (section 5.3) `[TO BUILD Lot 2]` |
| Passkey login with UV on `pending-recovery` or `unverified_email` binding | `passkey-fresh` (G-RECOVERY) | `acr='urn:sentropic:loa:bearer'`, `amr=['urn:sentropic:amr:webauthn']` (never `'mfa'`) | No — awaits independent activation (section 6) `[TO BUILD Lot 3/4]` |
| Passkey ceremony without UV | Rejected by real verifier (no session minted) | Rejected; defence-in-depth mocked UV=false route fallback stays `acr='urn:sentropic:loa:bearer'`, `amr=[]` | No (no session) `[EXISTS]` |
| Magic link, account **with** devices | `bearer`, `amr=['pwd']` | `acr='urn:sentropic:loa:bearer'`, `amr=['urn:sentropic:amr:email']`; for protected accounts, credential enrolment/revocation, federation link/unlink, and `/me/deactivate` + `DELETE /me` are blocked (section 6) | No `[EXISTS]` refusal; protected endpoint blocks `[TO BUILD Lot 3]` |
| Magic link, account **without** devices | `bearer`, `amr=['pwd']` (7-day session, `requiresDeviceRegistration=true`) | **No session** minted for protected accounts (R-REC-1 notice); unchanged 7-day `bearer` session (`amr=['urn:sentropic:amr:email']`) for non-protected accounts | No (no session for protected; `bearer` refused for non-protected) `[TO BUILD Lot 3]` |
| Federation (for example Google) | `bearer`, `amr=['pwd']` | `acr='urn:sentropic:loa:bearer'`, `amr=['urn:sentropic:amr:federation']` | No `[EXISTS]` |
| Registration finalisation | `bearer`, `amr=['pwd']` | `acr='urn:sentropic:loa:bearer'`, `amr=['urn:sentropic:amr:email']` | No `[EXISTS]` |
| Recovery-code redemption (option (c) optional sublot) | — (does not exist) | `enrolment-only` capability (not an OAuth session; creates at most one `pending-recovery` credential; rejected at all OAuth legs) | No `[TO BUILD Lot 4 optional]` |
| Break-glass reset grant (option (b)) | — (does not exist) | `enrolment-only` single-purpose short-lived grant (rejected at all OAuth legs) | No `[TO BUILD Lot 4]` |

Token contract (unchanged in shape): the authorization code seals `acr`,
`amr`, and `auth_time` from the session, and both tokens carry them
(`packages/auth-hono/src/oauth/token-handler.ts:430`, `:472`) `[EXISTS]`.
After Lot 5 the sealed `acr` for a qualifying session is the neutral `mfa`
value and `amr` follows the single target table above. RPs that inspect
`acr`/`auth_time` may keep reading them; `kvm-gateway` checks only that
signed `amr` contains `"mfa"` after standard OIDC validation, relying on
the IdP for per-client policy, freshness, allowlist, and recovery
enforcement (section 8.2).

AMR correctness rules `[TO BUILD Lot 5]`: `"mfa"` membership in signed `amr` is the only method signal an RP ever needs; `hwk` is emitted only when the verifier holds evidence of hardware binding (never inferred from the label "passkey", transports, or credential count); `user` denotes demonstrated user presence (`up=true`) and is not a synonym for the WebAuthn UV bit — the method detail rides in the documented private method value `urn:sentropic:amr:webauthn`; non-password methods (`urn:sentropic:amr:email`, `urn:sentropic:amr:federation`) never emit `pwd`, and legacy pre-drain sessions or code payloads whose method is unknown emit `amr=[]`. The fallbacks that manufacture `amr` from `acr` in `packages/auth-hono/src/oauth/issue-authorized-code.ts:30`, `packages/auth-hono/src/oauth/token-handler.ts:430`, `:528`, and the host adapter `api/src/services/auth/oauth-state-adapter.ts:282` are removed in Lot 5. A credential in `pending-recovery` or `unverified_email` binding state never yields `"mfa"` in `amr`, even with UV, until its independent activation (section 6) completes.

### 5.2 Where enforcement lives: one evaluator across four legs

One shared policy evaluator runs across all four OAuth issuance legs — **initial authorize, resumed authorize, consent (including consent-skipping issuance), and authorization-code exchange** — binding client `policy_version`, subject allowlist, account `is_mfa_protected` and `security_generation`, credential `binding_state`, and the actual qualifying ceremony timestamp (`mfaCompletedAt`). At initial and resumed authorize (`packages/auth-hono/src/oauth/authorize-handler.ts:80`, `:90`, `:253`), a below-level or stale session triggers forced re-authentication and a still-insufficient resumed session or unlisted subject returns `access_denied` `[EXISTS seam, extended by Lot 2]`. Consent (`packages/auth-hono/src/oauth/consent-decision-handler.ts:102`, `:118`) must not mint from a stale sealed payload after a cookie swap: it re-evaluates the live session and rebuilds the evidence. Code exchange (`packages/auth-hono/src/oauth/token-handler.ts:59`, `:79`, `:430`) rereads current client policy, account status, and `security_generation` and refuses stale transactions (policy raised, subject removed/disabled/deleted, generation bumped, client missing) while preserving PKCE and one-time consumption. File targets: `authorize-handler.ts`, `consent-decision-handler.ts`, `issue-authorized-code.ts`, and `token-handler.ts` plus `api/src/services/auth/oauth-state-adapter.ts` and the session store adapters; Lot 2 owns the change.

### 5.3 Freshness and step-up rules

- **R-FRESH-1.** `[TO BUILD Lot 2]` An MFA session satisfies an MFA client only while `now - mfaCompletedAt <= maxMfaAgeSeconds`, where `mfaCompletedAt` is the recorded qualifying ceremony time (never session creation, refresh, or last activity; missing or future values fail closed). Sensitive IdP account operations (credential create/revoke, federation link/unlink, account self-deactivation/deletion, recovery management) have no requesting OAuth client and enforce a separate server-side **administrative freshness bound** (`adminMaxMfaAgeSeconds`, default **900 seconds / 15 minutes**, frozen in Lot 0 independently of `D-P1`). For OAuth clients, `maxMfaAgeSeconds` is per client (KVM value chosen in `D-P1`, section 15; server default for other MFA clients when unset) and bounds only how long an IdP MFA ceremony remains eligible to issue a **new** OAuth authorization code — it does not revoke an already established downstream RP session cookie, whose lifetime and purge/logout procedure are bounded separately (R-REC-7, section 11).
- **R-FRESH-2 (step-up, not lockout).** A stale MFA session is handled
  exactly like a below-level session today: authorize redirects to login
  with the force-reauth continuation sealed; the resume leg refuses with
  `access_denied` if the new ceremony is still non-qualifying. The old
  session is not revoked (merged behaviour: the user may abandon the flow
  and keep it for non-forced clients) `[EXISTS pattern, extended by Lot 2]`.
- **R-FRESH-3 (request parameters).** `[TO BUILD Lot 2]` Authorize learns the standard `max_age` and `acr_values` request parameters as **hints that can only raise** the requirement, and seals the effective requirement into the signed continuation through forced login and consent: `max_age` tighter than `maxMfaAgeSeconds` wins for that request; `acr_values` naming the MFA level on a client without a stored policy triggers the same forced re-auth, but never downgrades a stored policy. `prompt=login` and `prompt=select_account` keep their merged force-reauth meaning. Discovery advertises `acr_values_supported` with the neutral value (plus the legacy alias during migration).
- **R-STEP-1 (sensitive IdP operations).** `[TO BUILD Lot 3]` Creating or revoking a credential, linking/unlinking a federation identity, or deactivating the account (`POST /api/v1/auth/me/deactivate`, `api/src/routes/namespaces/auth/account.ts:71`) for a protected account (`is_mfa_protected = true`) requires a current `trusted` MFA session within `adminMaxMfaAgeSeconds` (`900s`), except inside the independently authorized `enrolment-only` recovery capabilities of section 6 (`P-BREAK` and optional `P-CODE`), which may create at most one `pending-recovery` credential and nothing else. Self-deletion (`DELETE /api/v1/auth/me`, `api/src/routes/namespaces/auth/account.ts:95`) is refused while `is_mfa_protected = true` (`P-LIFECYCLE`).
- **R-DOWN-1 (no downgrade path).** No flow converts an MFA session into a weaker one for the same client, no parameter clears a stored policy, and de-protection (section 4.2) never retroactively validates a credential created by email proof. Refresh (`api/src/routes/namespaces/session-lifecycle.ts:50` → `api/src/services/auth/session-adapter.ts:105` → `api/src/services/session-manager.ts:308`, `:320`) reuses the same session row, preserves original `mfaCompletedAt` and `security_generation`, and can never raise its level `[EXISTS, extended by Lot 2]`.

## 6. Recovery and re-enrolment paths (target behaviour)

Normative principle **R-REC-0**: for a protected account (`is_mfa_protected = true`), **email proof alone never creates a credential, never mints an `enrolment-only` recovery capability, and never mints any session when the account has no devices** (when the account has devices, magic link may mint only a `bearer` session for non-MFA applications, with credential enrolment, credential revocation, federation-linking, and account deactivation/deletion endpoints refused). `enrolment-only` capabilities are reserved exclusively for independently authorized protected recovery (`P-BREAK` and optional `P-CODE`). Email remains a notification channel and the recovery path for non-protected accounts (`is_mfa_protected = false`). The table is the complete inventory; any new path must be added here before it ships.

| ID | Path | Target behaviour for a protected account (`is_mfa_protected = true`) | Level granted |
|---|---|---|---|
| P-NORM | Sign in with an existing `trusted` credential (UV) | Unchanged when within freshness bound | `MFA` (`urn:sentropic:loa:mfa`, fresh) `[EXISTS]` |
| P-ADD | Add a credential while signed in | Requires a fresh `trusted` `MFA` session within `adminMaxMfaAgeSeconds` (R-STEP-1); the new credential is bound as `trusted` immediately; all sessions and the account address are notified (section 9) | Caller's `MFA` session continues `[TO BUILD Lot 3]` |
| P-REVOKE | Revoke a credential while signed in | Requires a fresh `trusted` `MFA` session within `adminMaxMfaAgeSeconds`; revoking the last credential of a protected account warns, requires re-confirmation, and revokes recovery codes with it | — `[TO BUILD Lot 3]` |
| P-MAGIC-HAS | Magic link, account has devices (`api/src/routes/namespaces/auth/magic-link.ts:140`) | Mints an ordinary `bearer` session for permitted weak/non-MFA applications (`amr=['urn:sentropic:amr:email']`), refused by all MFA clients. It **cannot** enrol or revoke a credential, link/unlink federation, or deactivate/delete the account: `/register/*`, credential delete, federation link/unlink, `POST /api/v1/auth/me/deactivate`, and `DELETE /api/v1/auth/me` refuse it and direct to P-ADD, P-CODE, or P-BREAK | `bearer` only (protected endpoints blocked) `[EXISTS]` refusal; endpoint blocks `[TO BUILD Lot 3]` |
| P-MAGIC-NONE | Magic link, account has **no** devices (`api/src/routes/namespaces/auth/magic-link.ts:194`) | For a protected account (`is_mfa_protected = true`), mints **no session and no recovery grant at all**, returns the generic recovery notice, and notifies the account address (R-REC-1). For a non-protected account (`is_mfa_protected = false`), preserves merged behaviour byte-identically: an ordinary 7-day `bearer` session (`api/src/services/session-manager.ts:93`) with no endpoint restriction | `None` for protected accounts; `bearer` (unchanged) for non-protected accounts `[TO BUILD Lot 3]` |
| P-LOST | "Lost your device?" (email code → register) | For a protected account, email code alone stops at a recovery notice (choose P-BREAK or optional P-CODE); direct-to-enrolment behaviour is retained only for non-protected accounts | `None` for protected accounts `[TO BUILD Lot 3]` |
| P-INVITE | Invite-token enrolment (new account) | Unchanged for initial account creation (`is_mfa_protected = false`, credential marked `unverified_email`). An invite never protects or allowlists the account on an MFA client and cannot rebind an already protected account | `bearer` at finalisation `[EXISTS]` |
| P-FED | Federation sign-in (for example Google) | Unchanged `bearer` (`amr=['urn:sentropic:amr:federation']`); cannot enrol/revoke a credential, link/unlink federation, or deactivate/delete a protected account (same endpoint blocks as P-MAGIC-HAS) | `bearer` only `[EXISTS]` refusal; endpoint blocks `[TO BUILD Lot 3]` |
| P-LINK | Link/unlink a federation identity while signed in | For a protected account (including a protected zero-credential account, which is never treated as a fresh shell), link and unlink require a fresh `trusted` MFA session within `adminMaxMfaAgeSeconds` (section 5.3) or explicit recovery authority; an ordinary `bearer` session cannot attach or detach a sign-in foothold. No silent email merge (unchanged) | No level change `[TO BUILD Lot 3]` |
| P-LIFECYCLE | Account self-deactivation (`POST /api/v1/auth/me/deactivate`) and self-deletion (`DELETE /api/v1/auth/me`) at `api/src/routes/namespaces/auth/account.ts:71`, `:78`, `:86`, `:95`, `:163`, `:188` (mounted via `api/src/routes/namespaces/auth.ts:70`, `:74`, `:84`, `:108` and projected into `apps/auth-idp/idp-app.ts:168`, where `requireAuth` at `api/src/middleware/auth.ts:68` today checks only an ordinary session and disabled accounts are rejected at `api/src/routes/namespaces/auth/authentication.ts:68` and `api/src/routes/auth/oauth.ts:113`) | For `is_mfa_protected = true`: **self-deletion (`DELETE /api/v1/auth/me`) is refused (`account_protected_deletion_forbidden`)** while protected, because deleting `users` destroys the stable subject (`userId`), `is_mfa_protected`, `security_generation`, and durable history (deleting a formerly protected account requires first completing a deliberate R-GOV-4 de-protection operation with durable history write, then a fresh `trusted` MFA step-up within `adminMaxMfaAgeSeconds`). **Self-deactivation (`POST /api/v1/auth/me/deactivate`) requires a fresh `general`-purpose `trusted` MFA session within `adminMaxMfaAgeSeconds` (`900s`, R-STEP-1)**, increments `security_generation`, revokes sessions/codes, and writes a durable transition record while preserving `users.id` and `is_mfa_protected = true`; weak, stale, or `enrolment-only`/`recovery_pending` sessions are refused (`step_up_required`) with `account_status`, subject, credentials, and `security_generation` unchanged | No level granted `[TO BUILD Lot 3]` |
| P-CODE | Recovery code → restricted request (option (c), deferred optional sublot) | A single-use code enrolled earlier under a `trusted` `MFA` session opens a restricted recovery request and one `pending-recovery` enrolment (R-REC-6); activation to `trusted` still requires a surviving `trusted` ceremony or the break-glass Job, then a fresh qualifying sign-in. Codes never satisfy a client directly | `enrolment-only` capability, `pending-recovery` binding `[TO BUILD Lot 4 optional]` |
| P-BREAK | Break-glass reset and reactivation (option (b)) | Governed Job run with the independent cluster admin identity revokes **all** credentials, sessions, and recovery codes of the account, clears `account_status = 'disabled_by_user'` back to `'active'` when recovering a deactivated protected subject (preserving `users.id` and `is_mfa_protected`), and issues a single-purpose `enrolment-only` grant bound to subject, generation, and ceremony (R-REC-3/R-REC-4/R-REC-6) that enrols **one** `pending-recovery` credential; after the Job activates that credential to `trusted`, the owner signs in with UV (and, during initial Mode B bootstrap while `is_mfa_protected = false`, adds the second authenticator via P-ADD). Fully audited and notified (section 9) | `enrolment-only` 1-key grant `[TO BUILD Lot 4]` |

Rules that cut across the table:

- **R-REC-1 (closing the no-device email path and gating first activation).** `[TO BUILD Lot 3]` For a protected account (`is_mfa_protected = true`), `api/src/routes/namespaces/auth/magic-link.ts:194` mints no session and no recovery grant on email proof alone: it returns the generic recovery notice and notifies the account address. While Lot 3 ships this code path, **transitioning the first account to `is_mfa_protected = true` (which activates R-REC-1/R-REC-2 for that account) is gated on all five prerequisites of section 10.2**: (1) non-circular trust bootstrap, (2) working Lot 4 break-glass Job and `pending-recovery` activation, (3) Lot 2 freshness and four-leg evaluator plus Lot 3 binding/step-up/lifecycle gates, (4) durable transition persistence (`security-transition-store.ts`), and (5) a successful Lot 6 full-loss recovery drill with normal IdP/KVM access unavailable. The existing restrictive `kvm-gateway` production row is preserved throughout (never cleared to sequence rollout), and full `P-MFA` + `P-REC` is claimed only once that activation gate completes. The non-protected branch (`is_mfa_protected = false`) is unchanged.
- **R-REC-2 (with-devices case).** The with-devices magic-link session (`magic-link.ts:140`) already mints `bearer` and is already refused by MFA clients; Lot 3 adds the credential-enrolment, credential-revocation, federation-linking, and account deactivation/deletion blocks (`P-MAGIC-HAS`, `P-LIFECYCLE`) for protected accounts across both the main API and the standalone IdP projection (`apps/auth-idp/idp-app.ts:168`). Together R-REC-1 and R-REC-2 close both halves of G-RECOVERY and prevent weak-session account denial-of-service.
- **R-REC-3 (enrolment-only confinement).** An `enrolment-only` capability (`P-BREAK` grant or optional `P-CODE` restricted request) authorizes exactly: create one `pending-recovery` credential for its bound subject and generation, read that the enrolment completed, and sign out. Authorize, consent, token exchange, credential revoke, federation link/unlink, `/me/deactivate`, `DELETE /me`, recovery-code management, and every other authenticated endpoint refuse it. It expires in single-digit minutes, is single-enrolment (a second create attempt refuses atomically), and is enforced server-side by capability purpose, never by hiding UI links.
- **R-REC-4 (activation is a state transition).** A credential created via signed-in P-ADD under a fresh `trusted` MFA session is `trusted` at once. A credential created under a recovery capability (`P-BREAK` or optional `P-CODE`) starts `pending-recovery` per R-REC-6: its next UV sign-in proves control of the new key only and does **not** reach `MFA` until independent activation completes. Enrolment itself never seals an authorization code and never marks the enrolment session as `MFA`. Each Job grant authorizes at most **one** named future binding (target subject, generation, and ceremony bound, single-use; a second create attempt under the same grant refuses per R-REC-3); during Mode B initial bootstrap from zero trusted keys (section 10.2 step 3), the second authenticator is enrolled via ordinary signed-in `P-ADD` after the first key is activated to `trusted` and used for a fresh UV login. Retry reuses the same `operationId` and cannot widen the binding.
- **R-REC-5 (first enrolment and stored-protection transition).** A brand-new account starts with `is_mfa_protected = false`, so initial first-device enrolment by email code or invite stays as merged for non-protected use. Credentials enrolled by email or invite carry `unverified_email` provenance and can never supply their own bootstrap authority for an MFA client. Stored protection (`is_mfa_protected = true`), the two-trusted-credential prerequisite, and the R-REC-1/R-REC-2 email block engage atomically at the protected-activation transition (allowlist binding, first protected authorization to an unrestricted MFA client after section 10.2 trust bootstrap, or explicit operator activation) before any protected authorization code can be issued.
- **R-REC-6 (pending binding, no self-approval).** `[TO BUILD Lot 4]` A
  credential created under P-CODE or P-BREAK starts as `pending-recovery`:
  its own UV proves control of the new key, not continuity with the owner.
  It cannot satisfy any client, mint recovery codes, link a federation
  identity, or approve itself. Activation to `trusted` requires the
  capability's independent condition — a surviving trusted MFA ceremony
  (P-ADD path) or the break-glass Job's activation step — followed by a
  fresh qualifying sign-in. This rule is what keeps a stolen recovery code
  from becoming a direct code-to-MFA chain.
- **R-REC-7 (request is not invalidation).** A recovery request alone
  revokes nothing and changes no email or allowlist entry; otherwise
  anyone can lock the owner out repeatedly. Invalidation (sessions, local
  refresh material, continuations, authorization codes, tracked tokens,
  security-generation increment) happens only once sufficient recovery
  authority is established, atomically with the durable transition record.
  Self-contained JWTs and RP cookies that never recheck remain usable until
  their own expiry: Lot 6 documents the bounded RP session lifetime and the
  KVM purge/logout operation instead of claiming instant global revocation.
- **R-REC-8 (prerequisite means independently recoverable).** The
  two-authenticator prerequisite (section 4.2) means two **independently
  recoverable** authenticators (for example a platform/synced passkey
  plus a PIN-protected roaming key stored separately), not two rows that
  share one device or one sync account. Credential IDs cannot prove
  independence; the enrolment runbook states the assumption and the owner
  acknowledges it, and the spare must actually authenticate in the Lot 6
  drill — a row count is not a drill.

## 7. Recovery means — evaluation and recommendation

The kvm lane proposed four options. Each is evaluated against T-MAIL
(mailbox compromise must not yield P-MFA), T-DEVLOSS (owner who lost every
authenticator must regain access), and operability for a single-owner
first client.

| Option | T-MAIL | T-DEVLOSS | Cost / failure mode | Verdict |
|---|---|---|---|---|
| (a) At least 2 independently recoverable authenticators before protected activation | Neutral: does not stop email enrolment by itself | Strong improvement: loss of one device is a normal P-ADD, not a recovery | Enrolment friction once; a synced passkey and a hardware key count as two rows only if they are two distinct credentials | **Adopt** as the protected-activation prerequisite (section 4.2, Lot 4) |
| (b) Emergency reset only by a k8s Job run with the independent admin identity | Strong: requires cluster access plus the scoped admin Job; email plays no role | Available only while the independent administrator route and its recovery material are retained; slow and total (all credentials revoked) | Rare, deliberate, durably audited; unusable as a self-service path | **Adopt** as the break-glass floor (P-BREAK, Lot 4) |
| (c) Optional recovery codes opening a restricted request and `pending-recovery` binding | Sound **only** when high-entropy codes are minted under a fresh `trusted` MFA session, stored as subject- and generation-bound hashes, consumed atomically once, and redemption creates only a `pending-recovery` credential (R-REC-6) whose next UV login remains below `MFA` until independent activation (surviving `trusted` factor or break-glass Job) | Pre-stages replacement credential enrolment, but full-loss activation still requires the independent operator Job (unless the owner selects the weaker autonomous code-plus-delay alternative in D-P2, which requires a spec amendment) | Needs enrolment UX, hash storage, rate limiting, and atomic consume; does not eliminate operator involvement on total loss under P-MFA | **Defer** to an optional Lot 4 sublot (not a KVM prerequisite); if built, enforce R-REC-6 pending binding (section 15, D-P2) |
| (d) No recovery by email alone | This is property P-MFA restated for recovery; without it every other option is bypassed by the register flow | Removes the familiar path, so (a)+(b) and the full-loss drill must pass before first protected activation | Replaces the "Lost your device?" flow for protected accounts only | **Adopt as the invariant** R-REC-0 (Lot 3) |
| Baseline: keep email-code enrolment for everyone (status quo) | Fails: G-RECOVERY converts mailbox control into `MFA` in two steps | Convenient | Leaves forced 2FA as email security with extra steps | **Rejected** |

**Recommendation (normative).** First release: **(d) as the invariant,
(a) as the enrolment prerequisite, (b) as the guaranteed floor**.
Recovery codes (c) are **deferred to an optional later sublot** and are
not a prerequisite for KVM enforcement; if built, they open only the
restricted recovery request and the pending binding of R-REC-6 (full
activation still needs a surviving trusted ceremony or the Job), with
high-entropy single-use codes stored only as subject- and
generation-bound verifiers — never the short email-code mechanism. An
owner choice for autonomous code-plus-delay activation instead records a
weaker recovery root explicitly (section 15, D-P2). Lot 3 implements (d)
and the `enrolment-only` confinement; Lot 4 adds (a), the non-circular trust
bootstrap, and (b). No single option is sufficient alone: (a) without (d)
still lets email enrol a third credential; (d) without (a)/(b) risks owner
lockout; (c) without the pending-binding bound would reintroduce a
bearer-equivalent secret. The break-glass Job contract is normative: it
identifies the cluster identity and the target subject separately (an
`admin_app` role from a weak web session is never sufficient), uses a
versioned purpose-specific Job with an immutable image digest, a scoped
service account, exact target, reason, `operationId`, expected
`security_generation`, and dry-run/readback; it issues a short-lived
single-use binding authorization through the administrative channel and
never sets `mfaVerified`, clears a client policy, or returns a long-lived
session. The independent administrator route (with its own recovery
material, separate from the passkey sync account) is prepared and rehearsed
before the first account is transitioned to `is_mfa_protected = true`.

Explicitly rejected alternatives: email link plus a waiting period (delay
does not change who holds the mailbox; T-MAIL waits too), email plus
notification with veto window as the **sole** control (same reason;
notification remains required, but as detection, not authorization), and
requiring the RP to check a passkey-specific `acr` string or method name for
KVM (the IdP guarantees the policy; the RP checks only that signed `amr`
contains `"mfa"`).

## 8. Normative commitments requested by the kvm lane

Each commitment states the requirement, the file target, the lot that
delivers it, and what already exists. These are requirements on BUILD
branches; this spec branch changes no code or test.

### 8.1 Versioned, non-secret declaration of the kvm-gateway client

**Requirement R-KVM-DECL.** `[TO BUILD Lot 1]` The repository carries a
versioned declaration of the `kvm-gateway` client containing only
non-secret fields, sufficient to re-register the client identically on any
tier through the existing governed Job. The secret itself never enters the
declaration; only its variable names do (section 11 lists the fields).

- File target (new): `deploy/oauth-clients/kvm-gateway.yaml` — `schema_version`, monotonic `policy_version`, `require_non_empty_allowlist: true`, client id, display name, the single redirect URI, scopes, grant/response types, token-endpoint auth method, PKCE requirement, required level (legacy `passkey-fresh` until Lot 5 M-2, then `mfa`), allowlist variable reference for the owner subject (tier data supplied via the 0600 env file, never a personal identifier in git), tenant, RP contract (`"mfa"` in signed `amr`), and the secret variable names from `docs/oauth-client-rotation.md`.
- **Fail-closed allowlist rule (normative).** `[TO BUILD Lot 1, weakening gate Lot 6]` Before any database mutation (on initial registration in any tier and on reapply, rotation, or policy update), `api/src/scripts/oauth-register-client.ts` and the declaration apply gate must reject fail-closed if the `kvm-gateway` (or any client declaring `require_non_empty_allowlist: true`) owner subject variable is missing, empty, whitespace-only, an unexpanded placeholder, or does not resolve to an existing enabled user subject in that tier's database; it must **never** fall back to `'{}'` (`api/src/scripts/oauth-register-client.ts:153`, `:210`, which means unrestricted in `packages/auth-hono/src/oauth/authorize-handler.ts:412`). Removing the final entitled subject of a restricted client is rejected unless executed as an explicit client disable/delete operation (which fails closed for all users) or an explicit R-GOV-4 policy-weakening transition to unrestricted mode. Intentionally unrestricted clients (`require_non_empty_allowlist: false`, `allowed_user_ids = '{}'`) retain their existing unrestricted semantics.
- File targets (existing, reused): the registration Job `deploy/k8s/base/36-oauth-register-client-job.yaml` via `make oauth-register-client-job SECRET_FILE=<0600 env file> ENV=<env>`, and `api/src/scripts/oauth-register-client.ts`. Lot 1 adds the declaration, digest/readback check, and fail-closed non-empty owner validation; it does not add a second registration path.
- Already exists: confidential-client registration, secret hashing, policy parsing, and the rotation runbook (`docs/oauth-client-rotation.md:5` already names `kvm-gateway` as a confidential client) `[EXISTS]`.

### 8.2 IdP non-regression and RP amr-membership tests

**Requirement R-KVM-TEST.** `[TO BUILD Lot 1, extended by Lots 2, 5, and 6]`
Both the IdP issuance guarantee and the RP `"mfa"`-in-`amr` membership check are pinned by automated tests. At the IdP, a magic-link session and a federation (Google-shaped) session each receive forced re-authentication and then `access_denied` on resume, and a subject outside the allowlist is refused even with a qualifying MFA session. At the RP boundary, an otherwise valid signed ID token lacking `"mfa"` in `amr` is refused and a valid token containing `"mfa"` in `amr` is accepted independently of the qualifying method and `acr` spelling.

- File target (extend, package evaluator): `packages/auth-hono/tests/oauth-client-required-acr.test.ts` `[EXISTS]`. Lot 1 adds a `kvm-gateway` fixture derived from `deploy/oauth-clients/kvm-gateway.yaml` and exercises the package evaluator via package OAuth ports/fixtures (without importing `api/src/**` host routes) for magic-link-shaped bearer, federation-shaped bearer, and unlisted-subject MFA sessions. Scoped run: `make test-auth-hono SCOPE=tests/oauth-client-required-acr.test.ts ENV=test-idp-per-app-mfa-recovery`.
- File target (extend, host API integration): `api/tests/api/auth/oauth-client-policy.test.ts` `[EXISTS]` — the API-level twin against a real `kvm-gateway` DB row derived from the declaration. Lot 1 drives the **actual host magic-link (`api/src/routes/namespaces/auth/magic-link.ts:149`, `:197`) and federation (`api/src/routes/namespaces/auth/federation.ts:161` + `api/src/services/auth/federation/broker.ts:218`) session-minting routes and DB writers** (stubbing only external OAuth provider HTTP verification), followed by `authorize` → `consent` → `token`. Lots 2 and 5 extend both files with freshness, four-leg recheck, and neutral-value/AMR cases.
- File targets (mock-RP contract vs real-RP qualification): `packages/auth-hono/tests/example-oauth-rp.test.ts` (`MinimalMockRp` at `:60`, `:97`, `:142`, updated in Lots 1/5) and `api/tests/unit/auth/kvm-rp-amr-contract.test.ts` (new in Lot 1, updated in Lot 5) are **IdP/mock-RP contract tests**; they do not prove the live `oauth2-proxy` binary. Real-RP qualification is pinned by the versioned KVM RP configuration/verifier artifact `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` (new in Lot 1, pinning `oauth2-proxy v7.15.5` OIDC validation settings and the RP-side signed-token `amr` contains `"mfa"` check on the `kvm-gateway` callback path) and the qualification harness `deploy/ci/kvm-gateway/verify-rp-amr.sh` + `e2e/tests/02-auth-mfa-recovery.spec.ts` (Lot 1/5/6), which launches the pinned `oauth2-proxy v7.15.5` + RP `amr` verifier container against the test IdP JWK set and presents **otherwise valid signed tokens directly to the real RP callback** (not blocked earlier at the IdP): tokens with absent `amr`, empty `amr: []`, or non-MFA `amr` (`['urn:sentropic:amr:email']`, `['urn:sentropic:amr:federation']`, `['urn:sentropic:amr:webauthn']`) must be refused by the RP (`403 Forbidden`), and tokens containing `"mfa"` in signed `amr` must be accepted under both `passkey-fresh` and `mfa` `acr` spellings and across qualifying method values. Passing this real-RP qualification is a mandatory cutover dependency (sections 10.1 M-3, 10.2 step 5, and 11).

### 8.3 Closing the email-only re-enrolment path for required-MFA clients

**Requirement R-KVM-CLOSE.** The email-only path is closed by R-REC-1 and R-REC-2 (section 6), restated here with its file targets and activation gate:

- File targets: `api/src/routes/namespaces/auth/magic-link.ts` (lines 140–226), `api/src/routes/namespaces/auth/registration.ts` (`:222`, `:232`, `:257`, `:363`, `:440`), `packages/auth-hono/src/webauthn-registration-route-handlers.ts` (`:164`, `:168`), `api/src/services/webauthn-registration.ts` (`:200`, `:208`), `api/src/routes/namespaces/auth/credentials.ts` (`:76`, `:98`), `api/src/routes/namespaces/auth/account.ts` (`:71`, `:78`, `:86`, `:95`, `:163`, `:188`, mounted via `api/src/routes/namespaces/auth.ts:70`, `:74`, `:84`, `:108` and `apps/auth-idp/idp-app.ts:168`), `api/src/routes/namespaces/auth/federation.ts` (`:119`, `:143`, `:161`, `:298`, `:363`), `api/src/services/auth/federation/broker.ts` (`:218`, `:242`, `:299`, `:337`), and `packages/auth-hono/src/federation/resolve-user.ts` (`:149`, `:155`).
- **Delivery vs activation gate (normative).** Lot 3 ships the R-REC-1/R-REC-2/P-LINK/P-LIFECYCLE code gated on stored `is_mfa_protected = true`. **Activating `is_mfa_protected = true` on the first account (the earliest moment email enrolment is disabled) waits for all five prerequisites of section 10.2**: (1) non-circular trust bootstrap, (2) working Lot 4 break-glass Job and `pending-recovery` activation, (3) Lot 2 freshness and four-leg evaluator plus Lot 3 binding/step-up/lifecycle controls, (4) durable transition persistence (`api/src/services/auth/security-transition-store.ts`), and (5) a successful Lot 6 full-loss recovery drill with normal IdP/KVM access unavailable. The existing restrictive `kvm-gateway` production row (`2026-10-18T07:14Z`) is preserved unchanged throughout and never cleared to sequence rollout; pre-activation email exposure is framed explicitly until step 5 of section 10.2 completes.
- Already exists `[EXISTS]`: bearer refusal at authorize, the temporary session itself, and email verification marking. Missing today `[TO BUILD Lot 3]`: stored `is_mfa_protected` state, `enrolment-only` capability confinement, registration-before-persist authorization, and the register/credential/federation/account-lifecycle blocks for protected accounts.

## 9. Governance, audit, and notifications

### 9.1 Who may change a client policy

`[EXISTS]` There is no self-service UI for OAuth client policy. A policy
is created or changed only by re-registering the client through the
governed path: an operator prepares a 0600 env file with the
`OAUTH_CLIENT_*` variables (including `OAUTH_CLIENT_REQUIRED_ACR` and
`OAUTH_CLIENT_ALLOWED_USER_IDS` when a policy is set or replaced) and runs
`make oauth-register-client-job SECRET_FILE=<0600 env file> ENV=<env>`
against the tier cluster; the Job output prints the effective required
level and allowlist for verification before cutover
(`docs/oauth-client-rotation.md:37`). Omitting the two policy variables
preserves the stored policy, so a secret rotation cannot silently clear
or weaken it.

Normative additions:

- **R-GOV-1.** `[TO BUILD Lot 6]` Only an operator holding both cluster
  access for the tier and the values file may change a required level or
  an allowlist. The IdP application role does not gain a policy-editing
  endpoint in this evolution; adding one later requires the same audit
  and the fresh-MFA step-up of R-STEP-1 for the acting admin.
- **R-GOV-2.** `[TO BUILD Lot 6]` Lowering a required level, clearing it,
  or removing a subject from an MFA client's allowlist is recorded as a
  distinct audited event (section 9.2) with the previous and new values
  (subject identifiers hashed or truncated in logs; full values stay in
  history the governed operation persists; merged code has no such
  history: the registration script prints only the resulting current row).
- **R-GOV-3.** The client secret, its hash rotation, and the policy are
  independent: rotation follows the 90-day runbook cycle and never
  requires a policy decision; a policy change never requires a secret
  rotation.
- **R-GOV-4 (weakening is a distinct operation).** `[TO BUILD Lot 2 store, Lot 1/6 CLI & Job]` Omission preserves policy `[EXISTS]`, but an explicitly supplied weaker value (lower or cleared `required_acr`, wider `allowed_user_ids`, converting a restricted client to unrestricted `'{}'`, longer `max_mfa_age_seconds`, or account de-protection) must go through a distinct governed operation (`--allow-weaken`, `--expected-policy-version`, `--operation-id`, `--approval-ref`, `--declaration-digest`) with compare-and-swap (stale versions refuse), durable history write, and persisted readback. The persistence primitive (`api/src/db/schema.ts`, `api/src/services/auth/security-transition-store.ts`) lands in Lot 2's single migration so Lot 3/4 activation and recovery transitions use it immediately; `api/src/scripts/oauth-register-client.ts` and the pinned-digest Job variant enforce R-GOV-4 across Lot 1 (digest, non-empty owner check, readback) and Lot 6 (weakening approval/CAS/history gate). Rollback, re-seed, sync, or redeploy must never reinstate an older weaker policy, and a client downgrade never clears `is_mfa_protected`.

### 9.2 Audit

`[EXISTS]` The host wires the package audit port to the structured logger
(`api/src/routes/auth/oauth.ts:157`); merged OAuth code records
`oauth.end_session` events. There is no dedicated authentication-event
table; audit means structured, queryable log events with a stable event
name, actor subject, client id where relevant, outcome, and timestamp —
never secret, code, token, or full email payloads beyond the account
address already used for delivery.

`[TO BUILD Lot 2 store, Lot 6 events]` Required events: `oauth.client_policy_changed` (including R-GOV-2/R-GOV-4 fields), `auth.mfa_stepup_succeeded` / `auth.mfa_stepup_failed`, `auth.credential_created` / `auth.credential_revoked`, `auth.account_deactivated` / `auth.account_deletion_blocked` / `auth.account_reactivated`, `auth.recovery_code_created` / `auth.recovery_code_redeemed` / `auth.recovery_codes_revoked`, `auth.recovery_attempt_email_blocked`, `auth.breakglass_reset_executed` / `auth.trust_bootstrap_executed`, and `auth.enrolment_only_session_issued` / `auth.enrolment_only_session_used`. Two record classes are enforced: **best-effort** operational records (`api/src/routes/auth/oauth.ts:157` logger port, telemetry exporters, and email notifications) stay fire-and-forget so logger/exporter/mail outages never undo an already committed transition or alter an ordinary authorization outcome; **durable transition records** (`api/src/services/auth/security-transition-store.ts`, backed by `api/src/db/schema.ts` in Lot 2's migration) execute inside the same database transaction as credential-binding changes, trust bootstrap, pending-recovery activation, `is_mfa_protected` changes, protected account deactivation/reactivation, `policy_version` CAS mutations, and `security_generation` bumps — if the durable write fails, the transaction rolls back leaving all state unchanged, and retrying with the same `operationId` is idempotent.

Catalogue diagnostics reuse the same two record classes without
flattening them. The audit/provenance hooks
(`spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:102`) and the durable
correlation references (`auditId`, `correlationId` in
`spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:761`) correlate
client, policy, and operation references into the diagnostics a
permitted viewer may see. Credentials, tokens, and recovery material
stay outside shared logs and outside the catalogue. A common
observability view is not a durable receipt and not a secret store.
Until the five R-REC-1 prerequisites and the full-loss drill complete
(section 10.2), the pre-activation state is displayed as "baseline gate
only"; full `P-MFA` + `P-REC` is claimed only from that point.

### 9.3 Notifications

`[EXISTS]` Transactional email is sent through the existing mail service
(magic links, verification codes). No push or SMS channel exists, and none
is added.

`[TO BUILD Lot 6]` The account address is notified (email, delivery-trusted
only) on: credential created (including via enrolment-only and break-glass
paths), credential revoked, recovery codes created or revoked, a blocked
email-recovery attempt on a hardened account, a break-glass reset, and a
client-policy change that newly hardens or un-hardens the account.
Notifications state what happened and how to reach the break-glass path;
they carry no link that itself authorizes enrolment for a hardened
account. A notification failure never blocks the underlying operation; it
is logged as its own event.

## 10. Migration of existing clients and accounts

### 10.1 Method-neutral value migration (existing clients)

Applies to every client carrying `required_acr = 'urn:sentropic:loa:passkey-fresh'` at Lot 5 time, including `kvm-gateway`. The migration separates **preserved authorization decisions** (the 4-leg evaluator accepts both `urn:sentropic:loa:mfa` and `urn:sentropic:loa:passkey-fresh` for qualifying fresh trusted-MFA sessions) from **intentional emitted claim changes** (switching emitted `acr` to `urn:sentropic:loa:mfa` and emitted `amr` to the single table in section 5.1):

| Step | Action | Acceptance & emission effect | Lot |
|---|---|---|---|
| M-0 | Clients store `passkey-fresh`; sessions emit `passkey-fresh` and legacy `amr` | Baseline (`[EXISTS]`) | `[EXISTS]` |
| M-1 | Deploy 4-leg evaluator accepting both `mfa` and `passkey-fresh` as equivalent required spellings for qualifying sessions; unknown values refuse; discovery advertises both spellings | Identical authorization accept/refuse decisions across all session origins; emitted claims unchanged | `[TO BUILD Lot 5]` |
| M-2 | Re-register each MFA client through the governed Job with `OAUTH_CLIENT_REQUIRED_ACR=urn:sentropic:loa:mfa` and verify persisted readback (no secret rotation required) | Stored policy uses `mfa`; authorization decisions unchanged | `[TO BUILD Lot 5]` (operator) |
| M-3 | **Consumer qualification gate then single global emission cutover:** before flipping emission, qualify all internal and external consumers against the target `acr = 'urn:sentropic:loa:mfa'` and single section 5.1 `amr` table — `authorize-handler.ts`, `consent-decision-handler.ts`, `issue-authorized-code.ts:30`, `token-handler.ts:430,:472,:528`, `userinfo`, host fallback removal at `api/src/services/auth/oauth-state-adapter.ts:282`, mock-RP contract suite `packages/auth-hono/tests/example-oauth-rp.test.ts`, real-RP qualification (`deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` + `deploy/ci/kvm-gateway/verify-rp-amr.sh` presenting signed tokens with absent/non-MFA vs `"mfa"` `amr` directly to the pinned `oauth2-proxy v7.15.5` callback), live DB client readback, and the Lot 2 tier-sync SQL/CI suite (`deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql:7`, `import-preprod.sql:35-154`, `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-10`, `reader-role.sql:30-37`, `deploy/ci/idp-identity-sync/sql-test.sh`). The gate also covers the embedded annotation routes and extension OAuth surface that consume this policy, and any affected managed-app reader/admin clients bound by R-POL-4, alongside the already-required KVM RP qualification. Then switch resolver/token emission globally in one step (no dual-output window). Legacy in-flight non-protected code payloads without stored method emit `amr: []` until drained and are rejected if presented to a protected client. Safe rollback: if rolling back the binary before M-4, revert client rows to `passkey-fresh` first so stored `mfa` rows are never evaluated by an M-0 binary | Every RP receives canonical `acr = 'urn:sentropic:loa:mfa'` and the section 5.1 `amr` table; authorization decisions stay identical | `[TO BUILD Lot 5]` |
| M-4 | Retain `passkey-fresh` as an accepted required alias for one deprecation window while new declarations (section 8.1) require `mfa`; alias removal is a separate future change | No client is stranded | — |

Catalogue display does not grant access. Catalogue metadata may display
the stored policy and effective availability for a client, but
invocation still rechecks authority on every request with the current
principal, session, scopes, tenant/workspace context, and
consent/freshness state (`spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md:745`).
The KVM membership check (signed `amr` contains `"mfa"`, R-POL-1) is not
exported as a universal exact-`acr` RP rule: other consumers follow the
signed method evidence and the four-leg evaluator (section 5.2). A
client row alone does not make forced 2FA sufficient; no surface
presents it as sufficient without the stored-protection and recovery
activation sequence (R-REC-1, section 10.2).

Package note: `@sentropic/auth-hono` carries the authorize and resolver
changes, so each BUILD lot touching `packages/auth-hono/src/**` bumps that
package version per `rules/workflow.md` (Package Publication). The frozen
status of `auth-hono` for bootstrap is unaffected; steady-state publication
rules apply.

### 10.2 Starting state, trust migration, and sequencing (normative)

1. **Preserve and verify existing baseline gate (pre-activation):** Confirm by readback the existing production `kvm-gateway` row (`2026-10-18T07:14Z`, `required_acr = 'urn:sentropic:loa:passkey-fresh'`, non-empty owner allowlist) and reconcile it with `deploy/oauth-clients/kvm-gateway.yaml` (Lot 1). Never clear or downgrade this row. While `users.is_mfa_protected` remains `false`, this baseline gate retains the residual email-enrollment exposure (`G-RECOVERY`, section 2.3) and boolean age — neither full `P-MFA` nor `P-REC` is claimed until step 5.
2. **Deploy Lots 1–4 and durable transition store:** Ship the single schema migration (`api/src/db/schema.ts`, `api/src/services/auth/security-transition-store.ts`), 4-leg evaluator and identity-sync guards (Lot 2), email-closure/purpose/registration/account-lifecycle enforcement (Lot 3), and recovery/break-glass Job (`api/src/scripts/auth-breakglass-reset.ts`, `deploy/k8s/base/37-auth-breakglass-reset-job.yaml`, Lot 4) with `users.is_mfa_protected` still `false` so email recovery is not closed before `P-REC` is live.
3. **Non-circular trust bootstrap for initial trusted credentials:** Pre-migration `webauthn_credentials` (`api/src/db/schema.ts:168`) carry no enrollment provenance; holding two rows does not prove owner control, and no unbootstrapped credential may confirm itself or another credential. Before any account can activate `is_mfa_protected = true`, run the scoped, digest-pinned admin bootstrap operation (`api/src/scripts/auth-breakglass-reset.ts`, independent cluster identity, `targetUserId`, `expectedSecurityGeneration`, `operationId`, `reason`) in one of two modes: **Mode A** confirms explicitly named owner `credentialId`s (`>= 2` independently recoverable authenticators, R-REC-8) demonstrated in a fresh UV ceremony to `binding_state = 'trusted'` while atomically revoking all other pre-existing credentials on that account; **Mode B** (starting from zero trusted credentials) revokes all pre-existing credentials, bumps `security_generation`, and issues a **single-use one-key grant** (`R-REC-3`/`R-REC-4`) that enrolls **one** `pending-recovery` authenticator (a second create attempt under the same grant refuses atomically), which the independent admin Job activates to `binding_state = 'trusted'` while `is_mfa_protected` is still `false`; the owner then performs a **fresh UV login** with that first `trusted` authenticator (within `adminMaxMfaAgeSeconds = 900s`) and enrolls the **second** independently recoverable authenticator (`R-REC-8`) through ordinary signed-in `P-ADD` (born `trusted`). If interrupted between key 1 and key 2, protected activation refuses (`R-REC-1`), a reused grant refuses (`R-REC-3`), and the owner either completes `P-ADD` after a fresh UV login on key 1 or re-runs Mode B with a new `operationId`. Both modes write a durable transition record in the same DB transaction (idempotent on retry by `operationId`).
4. **Execute live full-loss recovery drill (Lot 6 prerequisite):** Run the end-to-end full-loss recovery drill (`P-BREAK` 1-key grant + independent Job activation + fresh UV login + `P-ADD` spare key through all 4 issuance legs, with normal IdP/KVM access assumed unavailable) before any account sets `is_mfa_protected = true`.
5. **Activate `is_mfa_protected = true` and verify RP cutover:** Atomically transition the owner account to `is_mfa_protected = true` once all five `R-REC-1` prerequisites and the step 4 drill pass — closing email enrollment at the exact moment `P-MFA` and `P-REC` are both active — then exercise that activation point with normal IdP/KVM access unavailable and verify real `kvm-gateway` RP `"mfa"`-in-`amr` enforcement (`deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` + `deploy/ci/kvm-gateway/verify-rp-amr.sh`).
6. **Method-neutral cutover (Lot 5, M-1…M-4):** Execute after consumer qualification (section 10.1).

Existing non-KVM clients and accounts need no action: clients with `NULL` policy stay legacy; accounts that never undergo a protected-activation transition remain `is_mfa_protected = false` with today's recovery; legacy sessions work only for non-protected issuance; rollback to software that cannot enforce the profile fails closed for protected issuance.

### 10.3 Tiers

Each tier's IdP holds its own `oauth_clients` rows, secrets, and account/credential security state (`spec/SPEC_DECISION_TIER_AUTH_PATTERN.md`, R1/R3). The binding in R-POL-4 is read per tier: an app instance's tier determines which tier IdP's `oauth_clients` rows carry its policy. Both OAuth client policy columns (`required_acr`, `allowed_user_ids`, `max_mfa_age_seconds`, `policy_version`, `require_non_empty_allowlist`) and account/credential security state (`users.is_mfa_protected`, `users.security_generation`, `webauthn_credentials.binding_state`, `webauthn_credentials.security_generation`, recovery capabilities/grants/codes, `security_transition_records`) are **tier-local** and excluded from prod→preprod export (`deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql:7-10`, `reader-role.sql:30-37`). As specified in section 4.2, Lot 2 updates `deploy/k8s/overlays/preprod/idp-identity-sync/import-preprod.sql`, `client-postcondition.sql`, and `deploy/ci/idp-identity-sync/sql-test.sh` so ordinary sync preserves local protection/generation/trusted bindings, imported keys default to `binding_state = 'unverified_email'`, any collision/re-key touching a protected account fails closed (`protected account rekey forbidden`), new recovery tables drop as `ephemeral-auth` on re-key, and `security_transition_records` is never repointed. The declaration (section 8.1) is applied per tier with that tier's owner subject and secret; the preprod KVM gateway, if any, is a distinct client (`kvm-gateway-preprod` naming by the R3 pattern) and is not created by this spec.

Copy/restore compatibility is explicit across this spec and the
annotation and data contracts. A data copy or restore keeps tier-local
protection, generations, and policy as target-tier state: imported
credentials insert as `unverified_email` and never acquire `trusted`
provenance from the copy (section 4.2, Lot 2 sync rules; DL-13 signed
archive and DL-17 deletion re-application in
`spec/SPEC_EVOL_DATA_LIFECYCLE.md:127`, `:153`). Annotation content
copied under DV3 (« Tout copier », option B) carries no grant,
session, routing right, or MFA trust with it; projections are rebuilt
for the target tier and any send from the target tier is
re-authorized there (DV3 closed record in the annotation overlay
specification).

## 11. KVM onboarding as an OAuth client (given)

How KVM authenticates today, from repository evidence: the rotation
runbook already treats `kvm-gateway` as a confidential OIDC client of the
IdP alongside `netbird` (`docs/oauth-client-rotation.md:5`), with its
issuer, client id, and secret carried by the `KVM_GATEWAY_OIDC_*`
variables. No `oauth_clients` row can be verified from the repository
(the database is the record), so onboarding means confirming the
recorded production row (section 10.2) or creating it where absent,
that row with the parameters below through the governed Job — it does not
mean inventing a parallel authentication mechanism for KVM.

Given parameters (kvm lane, 2026-10-18; treated as requirements):

| Field | Value |
|---|---|
| `client_id` | `kvm-gateway` (confidential) |
| RP software | oauth2-proxy v7.15.5 |
| Flow | `authorization_code` + PKCE S256 (`require_pkce=true`) |
| Token signing | EdDSA `id_token` (IdP JWKS as published) |
| `redirect_uris` | Exactly one: `https://kvm.sent-tech.ca/oauth2/callback` |
| `allowed_scopes` | `openid profile email` |
| `token_endpoint_auth_method` | `client_secret_basic`; secret minted cluster-side, stored SHA-256 only at the IdP, plaintext only in the RP secret locations named by variable |
| Required level | MFA level — stored today as `urn:sentropic:loa:passkey-fresh` (only merged spelling), migrated to `urn:sentropic:loa:mfa` by section 10.1 |
| `allowed_user_ids` | Owner subject only (`require_non_empty_allowlist: true`; tier value supplied in the 0600 file, never in git). Missing, empty (`""` / `'{}'`), placeholder, or unresolved subjects are rejected before any DB write; removing the last subject is rejected unless explicitly disabling/deleting the client or running R-GOV-4 weakening |
| Freshness bound | Per-client bound of section 5.3; the KVM value is an owner decision (section 15) |
| Gateway check | **Standard OIDC token validation plus `"mfa"` in signed `amr` (`deploy/kvm-gateway/oauth2-proxy-amr-check.yaml`)**: `kvm-gateway` (`oauth2-proxy v7.15.5` + pinned RP `amr` verifier) validates signature, issuer, audience, and expiry and checks that signed `amr` contains `"mfa"`, with no method-name or `acr`-spelling check. Combined with the IdP 4-leg evaluator and real-RP qualification (`deploy/ci/kvm-gateway/verify-rp-amr.sh`, R-KVM-TEST), this enforces P-MFA |

Onboarding steps (operator, per tier): verify the deployed RP matches the pinned `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` digest and passes `deploy/ci/kvm-gateway/verify-rp-amr.sh` (cutover dependency); mint the secret by the runbook method; build the 0600 file from the Lot 1 declaration plus the secret and resolved owner subject; run the registration Job; verify the persisted DB readback shows the expected required level and non-empty single-subject allowlist; cut the RP over to the new secret in the same operation (no grace period); verify a fresh owner passkey sign-in reaches KVM, a magic-link session receives `access_denied`, an otherwise valid signed token lacking `"mfa"` in `amr` presented to the real RP callback is rejected (`403 Forbidden`), a valid signed token with `"mfa"` in `amr` is accepted under both `passkey-fresh` and `mfa` `acr` spellings, and the old secret returns `invalid_client`; record the minted-at variables. Rollback is a re-run with the previous secret values file, per the runbook.

Compatibility note — Netbird (out of scope): a second client, `netbird`
(embedded Dex federating to the IdP), may come later and already appears
in the same runbook as a confidential client. This spec designs nothing
for it beyond two compatibility constraints: the method-neutral level and
`amr` vocabulary must remain consumable through a federating Dex without
renaming, and Dex-side federation must not be mistaken for an IdP MFA
ceremony (a session minted from Dex federation is `bearer` at the IdP
unless the IdP itself ran a qualifying ceremony). Its client row, scopes,
and any required level are a later lane's decision.

## 12. Test plan (BUILD branches; nothing here runs on this spec branch)

Conventions for every BUILD lot: tests run only on `ENV=test-<slug>` or
`ENV=e2e-<slug>`, never `ENV=dev`; `ENV` is the last `make` argument; no
timeout is raised to make a test pass; a failure against a green `main` is
a branch failure to fix, not a pre-existing condition. File lists are
exhaustive for the named suites (existing + updated + new).

### 12.1 API and package tests

| File | Status | Cases (observable behaviour) |
|---|---|---|
| `packages/auth-hono/tests/oauth-client-required-acr.test.ts` (package ports/fixtures), `api/tests/api/auth/oauth-client-policy.test.ts` (host routes/DB) | existing, updated in Lots 1/2/5 | Lot 1: `oauth-client-required-acr.test.ts` exercises the shared evaluator via package OAuth ports/fixtures (magic-link-shaped bearer, federation-shaped bearer, unlisted MFA subject) without importing `api/src/**` host routes; `oauth-client-policy.test.ts` drives the real host magic-link (`api/src/routes/namespaces/auth/magic-link.ts:149,:197`) and federation (`api/src/routes/namespaces/auth/federation.ts:119,:143,:161` + `api/src/services/auth/federation/broker.ts:218`, stubbing only external provider HTTP) session-minting routes and DB writers into `authorize`/`consent`/`token` against the `kvm-gateway` declaration row. Lot 2: exact MFA age boundary (`== maxMfaAgeSeconds` accepted, `+1s` forced to re-auth then refused if not stepped up), missing/future `mfaCompletedAt` refused, newer session with older `mfaCompletedAt` evaluated by `mfaCompletedAt`, `max_age` and `acr_values` preserved across continuation/consent, unrestricted MFA client first-use transition vs allowlist-restricted client. Lot 5: `mfa` and `passkey-fresh` both accepted by 4-leg evaluator; emitted `acr`/`amr` match section 5.1 table; unknown `required_acr` fails closed; no-policy clients unchanged; legacy code payload without stored method emits `amr: []` and refuses for protected client; rollback safety |
| `packages/auth-hono/tests/example-oauth-rp.test.ts` (`MinimalMockRp` at `:60,:97,:142`, updated Lots 1/5), `api/tests/unit/auth/kvm-rp-amr-contract.test.ts` (new Lot 1, updated Lot 5), `deploy/ci/kvm-gateway/verify-rp-amr.sh` (new Lot 1, updated Lot 5) | existing + new in Lots 1/5 | Mock-RP contract suites (`example-oauth-rp.test.ts`, `kvm-rp-amr-contract.test.ts`) plus real-RP qualification (`deploy/ci/kvm-gateway/verify-rp-amr.sh` launching the pinned `oauth2-proxy v7.15.5` + RP `amr` verifier from `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` against the test IdP JWK set): presents otherwise valid signed tokens directly to the real RP callback (not blocked earlier at the IdP), requiring `403 Forbidden` for absent, empty (`[]`), or non-MFA `amr` (`["urn:sentropic:amr:email"]`, `["urn:sentropic:amr:federation"]`, `["urn:sentropic:amr:webauthn"]`) and acceptance for signed `amr` containing `"mfa"` under both `passkey-fresh` and `mfa` `acr` spellings and across qualifying method values |
| `packages/auth-hono/tests/oauth-client-allowlist.test.ts` | existing, updated in Lot 1 | Non-empty allowlist and fail-closed subject evaluation across all 4 issuance legs |
| `api/tests/unit/oauth-register-client.test.ts` (Lots 1/2/5/6), `deploy/ci/idp-identity-sync/sql-test.sh` + `deploy/ci/idp-identity-sync/fixtures/{prod.sql,preprod.sql,assertions.sql}` (Lot 2) | existing, updated in Lots 1/2/5/6 | `kvm-gateway` declaration round-trip and persisted DB readback; missing/empty (`""` / `'{}'`)/placeholder/unresolved owner subject rejected before any DB write; removing last allowlist entry rejected (never writes `'{}'`); explicit client disable/delete fails closed; R-GOV-4 weakening (`--allow-weaken`, `--expected-policy-version`, `--operation-id`, `--approval-ref`, `--declaration-digest`) CAS/approval/digest/readback. In `sql-test.sh` (`export-prod.sql:7-10`, `reader-role.sql:30-37`, `client-postcondition.sql:7`, `import-preprod.sql:35-154`): client policy and account/credential security columns stay tier-local; ordinary sync preserves local `is_mfa_protected`, `security_generation`, and `trusted` bindings; imported keys insert as `unverified_email` (`security_generation = 0`) and never gain `trusted`; protected-account collision/re-key fails closed (`protected account rekey forbidden`); new recovery tables drop as `ephemeral-auth` on re-key; `security_transition_records` is never repointed or rewritten |
| `packages/auth-hono/tests/oauth-consent-policy.test.ts`, `packages/auth-hono/tests/oauth-token.test.ts`, `packages/auth-hono/tests/session-service.test.ts` | existing, updated in Lots 2/3/5 | Cookie swap during consent; policy/protection/binding/generation change before consent or token exchange refuses stale continuation/code; refresh preserves `mfaCompletedAt` and `security_generation` and never elevates; revoked generation cannot be revived by refresh replay; `enrolment_only` / `recovery_pending` sessions rejected at `authorize`, `consent`, `token`, `userinfo`, credential management, and `/me*` |
| `api/tests/unit/auth/session-manager.test.ts`, `api/tests/api/auth/session.test.ts`, `api/tests/unit/auth/webauthn-authentication.test.ts`, `api/tests/unit/auth/oauth-state-adapter.test.ts` | existing, updated in Lots 2/3/5 | Real host refresh route (`api/src/routes/namespaces/session-lifecycle.ts:50` → `api/src/services/auth/session-adapter.ts:105` → `api/src/services/session-manager.ts:308,:320`) preserves existing `mfaVerified`/`createdAt` behaviour and extends preservation to `mfaCompletedAt`, `security_generation`, and `session_purpose` (never elevating a weak or stale session); host state adapter removes `acr === 'urn:sentropic:loa:passkey-fresh' ? ['hwk', 'user', 'mfa'] : ['pwd']` fallback (`api/src/services/auth/oauth-state-adapter.ts:282`); legacy sessions/continuations/codes without current `security_generation` or trusted binding rejected for protected issuance; concurrent first `is_mfa_protected` activation settles once with one transaction/version winner |
| `packages/auth-hono/tests/webauthn-registration-before-persist.test.ts`, `api/tests/unit/auth/webauthn-registration.test.ts` | existing, updated in Lots 3/4 | Persist-time authorization recheck at `/register/verify` (`packages/auth-hono/src/webauthn-registration-route-handlers.ts:164,:168`, `api/src/services/webauthn-registration.ts:200,:208`), policy/protection/generation change between `/register/options` and `/register/verify`, concurrent capability consumption race (at most one credential created), failed credential persistence rollback and retry |
| `api/tests/api/auth/magic-link-recovery.test.ts`, `api/tests/api/auth/registration-hardened.test.ts`, `api/tests/api/auth/account-protection.test.ts` (new Lot 3); `api/tests/api/auth/passkey-mfa-session.test.ts`, `api/tests/api/auth/registration.test.ts`, `api/tests/api/auth/magic-link.test.ts`, `api/tests/api/auth/credentials.test.ts` (updated Lots 1/3/4) | new + existing in Lots 1/3/4 | Real-verifier UV=false refusal (`webauthn-authentication.ts:173,:200,:215`) vs route mock; unified `R-REC-0` / `P-MAGIC-HAS` / `P-MAGIC-NONE` matrix for `is_mfa_protected = true` vs `false` across 0, 1, and `>= 2` trusted keys; `unverified_email` key never satisfies `R-REC-5` or protected issuance; first `is_mfa_protected = true` transition refused until all five `R-REC-1` prerequisites hold; weak/stale/non-MFA sessions cannot add, confirm, or delete trusted keys (`adminMaxMfaAgeSeconds = 900s`). In `account-protection.test.ts` (covering both `api/src/routes/namespaces/auth.ts:70,:74,:84,:108` and standalone IdP projection `apps/auth-idp/idp-app.ts:168` into `api/src/routes/namespaces/auth/account.ts:71,:78,:86,:95,:163,:188`): magic-link/federation weak sessions, stale MFA sessions, and `enrolment_only`/`recovery_pending` capabilities cannot deactivate (`POST /api/v1/auth/me/deactivate`) or delete (`DELETE /api/v1/auth/me`) the protected owner (leaving `account_status`, subject, credentials, and `security_generation` unchanged); `DELETE /api/v1/auth/me` is refused while `is_mfa_protected = true` (`account_protected_deletion_forbidden`) until R-GOV-4 de-protection; authorized fresh-MFA (`adminMaxMfaAgeSeconds = 900s`) deactivation and Job reactivation preserve `users.id` and `is_mfa_protected = true` |
| `api/tests/unit/auth/federation-broker.test.ts`, `api/tests/unit/auth/federation-lot2.test.ts`, `packages/auth-hono/tests/federation-resolve-user.test.ts` | existing, updated in Lot 3 | `P-LINK` weak-session link/unlink refusal (`api/src/routes/namespaces/auth/federation.ts:298,:363`, `api/src/services/auth/federation/broker.ts:299,:337`); `api/src/services/auth/federation/broker.ts:242` and `packages/auth-hono/src/federation/resolve-user.ts:149,:155` refuse to treat an `is_mfa_protected = true` zero-key account as a fresh unprotected shell (`federation_account_protected_recovery_required`); `adminMaxMfaAgeSeconds` and recovery-authority scope enforced |
| `api/tests/unit/auth/mfa-recovery.test.ts`, `api/tests/api/auth/breakglass.test.ts`, `api/tests/api/auth/mfa-recovery-policy.test.ts` | new in Lots 3/4 | Non-circular trust bootstrap from zero `trusted` bindings (legitimate owner key + pre-migration email-enrolled attacker key + active legacy sessions/codes): Mode A confirms named owner keys and revokes attacker key; Mode B issues a 1-key grant that enrolls one `pending-recovery` key (`R-REC-3`, proving a reused grant cannot create a second key), activates key 1 to `trusted` via the independent Job (`R-REC-4`), completes a fresh UV login on key 1, and enrolls key 2 via signed-in `P-ADD` (covering interruption/retry between key 1 and key 2 and refusing premature `is_mfa_protected` activation until both `trusted` keys exist); wrong subject/generation/ceremony, replay & concurrent consume, durable persistence failure rollback, cancellation, weak `admin_app` session refused, deactivated-account reactivation, idempotent retry by `operationId`; full-loss recovery chain through all 4 issuance legs for `kvm-gateway` with no protected token on any shortcut |
| `api/tests/api/auth/recovery-codes.test.ts` | new in Lot 4 **optional sublot** (conditional on `D-P2`) | Built only if owner selects `D-P2` option (ii): stolen recovery code + attacker WebAuthn enrollment (`pending-recovery`) + fresh UV login + `authorize`/`consent`/code/token for `kvm-gateway` denied at all 4 legs while `pending-recovery`, and accepted only after independent operator activation + fresh UV ceremony |
| `api/tests/api/auth/audit-notifications.test.ts` | new in Lots 2/6 | Failed durable write in `security-transition-store.ts` rolls back client policy, credential binding, `is_mfa_protected`, account deactivation/reactivation, or `security_generation` mutation; stale CAS and unauthorized weakening refuse; idempotent retry with same `operationId` succeeds; best-effort logger/exporter/mail outage does not undo a durably committed transition or alter ordinary authorize outcomes |

Scoped runs while evolving (one suite at a time), for example: `make test-api SCOPE=tests/api/auth/magic-link-recovery.test.ts ENV=test-idp-per-app-mfa-recovery`. Lot gate for IdP lots: `make test-api ENV=test-idp-per-app-mfa-recovery` plus the package suite invocation used by that lot, recorded in the BUILD branch `BRANCH.md` with exact commands and results.

### 12.2 UI tests (TypeScript only)

| File | Status | Cases |
|---|---|---|
| `packages/auth-ui/tests/transport-fetch.test.ts`, `packages/auth-ui/tests/webauthn.test.ts` (existing, updated Lot 3); `ui/tests/auth/mfa-recovery.test.ts` (new Lot 3) | existing + new in Lot 3 | Protected-account "Lost your device?" (`AuthLogin.svelte:102,:138`, `ui/src/routes/auth/login/+page.svelte:49`) shows recovery instructions without direct email enrollment; `is_mfa_protected = false` flow unchanged; `enrolment_only` / `recovery_pending` single-enrollment UI confinement |
| `ui/tests/auth/recovery-codes-settings.test.ts` | new in Lot 4 **optional sublot** (conditional on `D-P2`) | Built only if `D-P2` option (ii) is selected: code generation only under fresh MFA (`adminMaxMfaAgeSeconds`), shown once, revocation requires step-up, redemption shows `pending-recovery` state awaiting operator activation |

### 12.3 E2E tests

| File | Status | Cases |
|---|---|---|
| `e2e/tests/02-auth-webauthn.spec.ts`, `e2e/tests/02-auth-devices.spec.ts`, `e2e/tests/02-auth-oauth-authorization-code.spec.ts` (`example-mock-rp` at `:7,:45,:106`, existing, updated Lot 6); `e2e/tests/02-auth-mfa-recovery.spec.ts` + `deploy/ci/kvm-gateway/verify-rp-amr.sh` (new Lot 1/6 against pinned `oauth2-proxy v7.15.5` from `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml`) | existing + new in Lots 1/6 | Browser virtual-authenticator and real-RP callback flows: owner passkey sign-in reaches the real `kvm-gateway` RP callback with `"mfa"` in signed `amr`; otherwise valid signed tokens with absent, empty, or non-MFA `amr` presented directly to the real RP callback are refused by the RP (`403 Forbidden`) while `"mfa"` tokens are accepted under both `passkey-fresh` and `mfa` `acr` spellings; magic-link, federation, unlisted subject, and `pending-recovery` sessions receive `access_denied`; stale-session step-up succeeds only after fresh UV ceremony; spare-key recovery and full-loss approved reset + activation complete end-to-end. Prepared with `make build-api build-ui-image API_PORT=<lot ports> ENV=e2e-idp-per-app-mfa-recovery` and run scoped by `E2E_SPEC` before any full-group gate |

E2E never runs against `ENV=dev` data. AI-flaky acceptance (single success on the same commit plus recorded signature and owner sign-off) applies only to provider nondeterminism, never to the deterministic auth cases above.

### 12.4 Acceptance criteria for the specification itself

This spec is accepted when: every `[EXISTS]` citation resolves at `94a38286e`; P-MFA and P-REC are testable as written; the four kvm-lane options have verdicts; commitments R-KVM-DECL, R-KVM-TEST, and R-KVM-CLOSE name exact files and lots; and section 15 lists only decisions the owner must actually make. Astra max review and the reconciliation record (`.h2a/reviews/spec-idp-mfa-reconciliation.md`, `.h2a/reviews/pr695_treatment.md`) are part of acceptance for this branch, not of BUILD acceptance.

## 13. Implementation lots (BUILD branches — not this spec branch)

Each lot is a separate BUILD branch from the then-current `main`, with its own `BRANCH.md` from `plan/BRANCH_TEMPLATE.md`, its own `ENV=test-<slug>` gates, at most one migration in `api/drizzle/*.sql` (consolidated in Lot 2), and a version bump for every `packages/<pkg>` whose `src/**` it touches. Order follows section 10.2: Lot 2 lands the single migration and durable transition store first; Lots 3 and 4 build on it; first `is_mfa_protected = true` activation waits for Lots 1–4, non-circular trust bootstrap, and the Lot 6 full-loss recovery drill.

| Lot | Deliverable | Key file targets | Gate |
|---|---|---|---|
| Lot 0 — Contract freeze (design only) | Freeze assurance semantics, single section 5.1 `acr`/`amr` table, `mfaCompletedAt`, `adminMaxMfaAgeSeconds = 900s`, `binding_state`, `security_generation`, `policy_version`, `is_mfa_protected`, Mode A/B 1-key bootstrap protocol, identity-sync tier rules, and durable transition store schema on existing ports/adapters; consolidate the single next migration | Spec delta on this file's sections 4–10; no code | Contract examples cover every section 2 path; no method hidden in `acr`; rollback never accepts weak evidence |
| Lot 1 — Declaration, fail-closed allowlist, and RP `amr` pin | `R-KVM-DECL` (`require_non_empty_allowlist: true`), fail-closed owner allowlist validation in registration CLI, pinned KVM RP `amr` config (`deploy/kvm-gateway/oauth2-proxy-amr-check.yaml`), and `R-KVM-TEST` package/API/RP suites | `deploy/oauth-clients/kvm-gateway.yaml` (new), `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` (new), `deploy/ci/kvm-gateway/verify-rp-amr.sh` (new), `api/src/scripts/oauth-register-client.ts`, `packages/auth-hono/tests/oauth-client-required-acr.test.ts`, `packages/auth-hono/tests/oauth-client-allowlist.test.ts`, `api/tests/api/auth/oauth-client-policy.test.ts`, `api/tests/unit/oauth-register-client.test.ts`, `packages/auth-hono/tests/example-oauth-rp.test.ts`, `api/tests/unit/auth/kvm-rp-amr-contract.test.ts` (new) | Scoped suites and `verify-rp-amr.sh` green on `ENV=test-<slug>`; declaration/registration readback green |
| Lot 2 — Single migration, durable transition store, 4-leg evaluator, freshness, and identity-sync guards | Single migration in `api/drizzle/*.sql`, durable transition store, 4-leg evaluator (`authorize`, `consent`, code issue, `token`), `R-FRESH-1…R-FRESH-3`, host refresh preservation, and tier-local identity-sync guards (client exclusions, `unverified_email` import default, protected re-key refusal, FK classification) | `api/src/db/schema.ts`, `api/src/services/auth/security-transition-store.ts` (new), `packages/auth-hono/src/oauth/authorize-handler.ts`, `consent-decision-handler.ts`, `issue-authorized-code.ts`, `token-handler.ts`, `session-resolver.ts`, `wellknown-handler.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/routes/namespaces/session-lifecycle.ts`, `api/src/services/auth/session-adapter.ts`, `api/src/services/session-manager.ts`, `deploy/k8s/overlays/preprod/idp-identity-sync/client-postcondition.sql`, `import-preprod.sql`, `deploy/k8s/overlays/prod/idp-identity-sync/export-prod.sql`, `reader-role.sql`, `deploy/ci/idp-identity-sync/sql-test.sh`, `deploy/ci/idp-identity-sync/fixtures/{prod.sql,preprod.sql,assertions.sql}` | 4-leg evaluator, exact age boundaries, host refresh, durable rollback, and `sql-test.sh` sync checks green; no-policy clients byte-identical |
| Lot 3 — Stored account protection, email-path closure, account-lifecycle & federation guards | `R-REC-0…R-REC-5`, `R-STEP-1` (`adminMaxMfaAgeSeconds = 900s`), `R-KVM-CLOSE`, atomic `is_mfa_protected` transitions (`R-REC-1` 5-prerequisite gate), persist-time `/register/verify` recheck, `P-LIFECYCLE` `/me/deactivate` step-up & `DELETE /me` refusal (API + `apps/auth-idp`), `P-LINK` federation link/unlink & zero-key shell guards, and UI lost-device confinement | `api/src/routes/namespaces/auth/magic-link.ts`, `registration.ts`, `credentials.ts`, `account.ts`, `federation.ts`, `api/src/routes/namespaces/auth.ts`, `apps/auth-idp/idp-app.ts`, `api/src/services/webauthn-registration.ts`, `api/src/services/auth/federation/broker.ts`, `packages/auth-hono/src/webauthn-registration-route-handlers.ts`, `packages/auth-hono/src/federation/resolve-user.ts`, `packages/auth-ui/src/components/AuthLogin.svelte`, `ui/src/routes/auth/login/+page.svelte`, `api/tests/api/auth/account-protection.test.ts` (new), Lot 3 API/unit/UI test suites | Unified `is_mfa_protected` outcome matrix, `account-protection.test.ts`, persist-time registration race, federation shell refusal, and UI suites green |
| Lot 4 — Non-circular trust bootstrap, break-glass Job, and pending-recovery activation | Option (a) 2-authenticator prerequisite, (b) non-circular trust bootstrap (Mode A and Mode B 1-key grant → Job activation → UV login → `P-ADD` key 2) and full-loss break-glass reset/reactivation (`R-REC-6`); recovery codes (c) only as a deferred **optional sublot** conditional on `D-P2` | `api/src/services/auth/mfa-recovery.ts` (new), `api/src/scripts/auth-breakglass-reset.ts` (new), `deploy/k8s/base/37-auth-breakglass-reset-job.yaml` (new), `api/tests/unit/auth/mfa-recovery.test.ts`, `api/tests/api/auth/breakglass.test.ts`, `api/tests/api/auth/mfa-recovery-policy.test.ts` (plus `api/tests/api/auth/recovery-codes.test.ts` and `ui/tests/auth/recovery-codes-settings.test.ts` only if `D-P2` option (ii) is chosen) | Mode A/B bootstrap, break-glass reactivation, and `pending-recovery` 4-leg denial green; conditional code sublot never satisfies protected issuance while `pending-recovery` |
| Lot 5 — Consumer qualification and method-neutral cutover | `R-POL-1`, section 10.1 `M-1…M-4`: qualify all internal/external consumers (including `verify-rp-amr.sh` and `sql-test.sh`), remove ACR-to-AMR fallbacks, switch global emission to `urn:sentropic:loa:mfa` and the section 5.1 `amr` table, and update `kvm-gateway` declaration to `mfa` | `packages/auth-hono/src/oauth/authorize-handler.ts`, `consent-decision-handler.ts`, `issue-authorized-code.ts`, `token-handler.ts`, `session-resolver.ts`, `wellknown-handler.ts`, `api/src/services/auth/oauth-state-adapter.ts`, `api/src/scripts/oauth-register-client.ts`, `deploy/oauth-clients/kvm-gateway.yaml`, `deploy/ci/kvm-gateway/verify-rp-amr.sh`, Lot 5 test suites | Consumer qualification, single `amr` emission table, legacy code drain, and rollback order green |
| Lot 6 — Governance weakening gate, notifications, live full-loss drill, and E2E verification | `R-GOV-1…R-GOV-4` complete weakening CLI/Job gate, section 9.2 operational events, section 9.3 notifications, live full-loss recovery drill before first `is_mfa_protected = true` activation (section 10.2 steps 4–5), real-RP cutover qualification, and E2E verification | `api/src/scripts/oauth-register-client.ts`, `api/src/routes/auth/oauth.ts`, `api/tests/api/auth/audit-notifications.test.ts`, `deploy/ci/kvm-gateway/verify-rp-amr.sh`, `e2e/tests/02-auth-webauthn.spec.ts`, `e2e/tests/02-auth-devices.spec.ts`, `e2e/tests/02-auth-oauth-authorization-code.spec.ts`, `e2e/tests/02-auth-mfa-recovery.spec.ts` | Weakening CAS/history, notification, real-RP qualification, E2E suites, and pre-activation full-loss drill green |

Notes: Lot 1 deliberately ships no guarantee change — it pins behaviour so
Lots 2–5 cannot regress it silently. The Astra max review of this spec and
the reconciliation record in `.h2a/reviews/spec-idp-mfa-reconciliation.md`
gate BUILD authorisation; they are conductor artefacts, not BUILD lots.

## 14. Compatibility, non-goals, and risks

Compatibility kept: clients with no policy keep legacy authorize behaviour
byte-identically; non-hardened accounts keep magic-link recovery and the
current lost-device flow; `tid` derivation, consent persistence, DPoP, PKCE
S256-only, EdDSA signing, and exact-match redirect validation are untouched;
tier-local policy stays excluded from IdP sync; the magic-link utility
endpoints themselves are not removed (their hardened-account enrolment
effect is what changes).

Non-goals: a new MFA method enrolment (TOTP or other), a policy-editing UI,
method-specific or `acr`-string gateway policy for KVM beyond checking `"mfa"` in signed `amr`, Netbird client design beyond
section 11's note, any change to RP session glue, and removal of the
legacy `passkey-fresh` alias (section 10.1, M-4).

Risks and mitigations: owner lockout if Lot 3 ships before the second
credential exists (mitigated by the section 10.2 order and Lot 4 advisory
mode); recovery codes stored with the mailbox collapsing to T-MAIL
(mitigated by the section 7 conditions and the opt-in decision);
break-glass misuse (bounded by dual possession — cluster plus admin
account — and full audit); freshness default set so tight that step-up
friction trains click-through (bounded by the owner decision in
section 15 and by keeping the bound per client); alias window lingering
(mitigated by M-4: new declarations must use the neutral value).

Unverified at spec time (stated, not assumed): whether any required-MFA client besides `kvm-gateway` already exists in a live database, the live owner subject value, and whether the currently deployed tier RP instance already matches the pinned `deploy/kvm-gateway/oauth2-proxy-amr-check.yaml` digest (verified and enforced via `deploy/ci/kvm-gateway/verify-rp-amr.sh` before Lot 5/Lot 6 cutover). Each is an operator verification in Lot 1/Lot 6, not a spec assumption.

## 15. Décisions propriétaire

Seules les décisions qui appartiennent réellement au propriétaire sont
listées ici. L'inscription de KVM comme client OAuth de l'IdP et les
paramètres donnés de `kvm-gateway` (section 11) sont des exigences
acquises et ne sont pas rouverts. Pour chaque décision : options,
conséquences, recommandation de la spécification.

**D-P1 — Fenêtre de fraîcheur MFA pour `kvm-gateway`.** Options : (i) 300 secondes à l'émission OAuth (`authorize`, `consent`, code, `token`) (étape renforcée presque à chaque nouvelle émission OIDC), (ii) quelques heures (recommandé : 8 h), (iii) 24 h. Conséquences : plus la fenêtre `maxMfaAgeSeconds` est courte, plus l'usage d'une session IdP volée (T-SESS) pour obtenir un nouveau jeton est contenu, mais plus la cérémonie WebAuthn est répétée lors d'une ré-émission OIDC ; 24 h laisse une journée de ré-émission à une session IdP volée. Cette borne gouverne uniquement l'émission OIDC côté IdP (section 5.3) et est indépendante de la durée du cookie de session aval de `kvm-gateway` (`oauth2-proxy`, dont la révocation immédiate en cas d'incident relève de la purge de session RP de R-REC-7) ainsi que de `adminMaxMfaAgeSeconds` (fixé séparément à 900 s par défaut au Lot 0 pour les mutations de sécurité IdP).

**D-P2 — Codes de récupération pour le compte propriétaire KVM.**
Options : (i) différer les codes et livrer d'abord (a)+(b) (recommandé
par la spécification et l'étude parallèle), (ii) construire le sous-lot
codes avec liaison en attente (R-REC-6 : le code ouvre la demande, il
n'active jamais seul un accès MFA), (iii) choisir une activation
autonome code-plus-délai, qui consigne une racine de récupération plus
faible. Conséquences : (i) garde la surface minimale avec une
récupération dépendante de l'opérateur ; (ii) ajoute une commodité sans
chaîne directe code-vers-MFA ; (iii) rend le vol du code éventuellement
suffisant après délai et doit être assumé comme tel.

**D-P3 — Portée du durcissement du compte.** Options : (i) la protection stockée `users.is_mfa_protected` activée explicitement après vérification des prérequis de R-REC-1 (sections 4.2 et 6 : entrée allowlist, première émission MFA vers un client sans allowlist, ou activation opérateur), (ii) étendre la protection à tout compte dès son premier passkey, y compris pour les applications non forcées, avec une migration qui établit d'abord la confiance indépendante et les moyens de récupération requis. Conséquences : (i) préserve la récupération par email des comptes non protégés et limite le changement aux comptes protégés (dont le propriétaire KVM) une fois P-MFA et P-REC prêts ; (ii) ferme pour davantage de comptes la création de credentials et l'ouverture de session sans appareil par email seul, et protège les mutations de credentials et de compte (section 4.2), réduisant ces voies de prise de contrôle même sans exigence MFA applicative. Cette protection élargie augmente les préparatifs de récupération et le risque de perte d'accès ; elle exige d'adapter les déclencheurs et la migration, sans supprimer les prérequis de confiance ni de récupération. Dans les deux options, la protection du compte ne force pas chaque connexion : pour un compte protégé avec appareils, une preuve email peut encore ouvrir une session `bearer` vers un client non-MFA, sans autoriser les mutations protégées ; l'exposition de cette connexion demeure. La spécification recommande (i).

Aucune autre décision propriétaire n'est requise pour autoriser les lots :
le choix des TTL fins (session enrolment-only, grant d'urgence), des noms
d'événements d'audit et du schéma de la table des codes relève des lots
d'implémentation sous les bornes normatives des sections 6 et 9.
