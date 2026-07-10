# SPEC_STUDY_39E_SOCIAL_FEDERATION — Upstream Social/Enterprise Federation for the Sentropic IdP

Status: STUDY (options + trade-offs + recommendations). Non-decisional. This document FRAMES
owner-gated calls; it does not decide them. Rung: harness-brainstorm STUDY.

Lineage: BR-39e (federation-first), previously deferred (memory: "39c app-clients/scopes/OAuth
multi-tenant deferred"; roadmap: "39e (multi-tenant, federation-first)"). This study scopes the
*social/enterprise login federation* half of 39e: letting a human enroll/sign in to the Sentropic
IdP via Google / GitHub / Microsoft / Apple / Facebook, while the IdP remains the single OIDC
authority downstream apps trust.

---

## 0. Grounding — the IdP as it exists on main today (cited)

The Sentropic IdP is a hand-rolled Hono auth stack (`@sentropic/auth-hono` **0.11.1**,
`packages/auth-hono/package.json`), consumed by `api/` and by the standalone IdP app
`apps/auth-idp/web` (SvelteKit), live at `auth.sent-tech.ca`.

Facts that shape this study:

- **Enrollment/login methods present**: WebAuthn/passkey (register + authenticate), magic-link,
  email-verification-code, plus a session/refresh model. Method surface is a fixed contract:
  `AUTH_HONO_AUTH_UI_METHODS` in `packages/auth-hono/src/contracts.ts:3` — the 12 methods are all
  passkey / email / magic-link / session / credential-management. **There is ZERO external/social
  provider seam anywhere**: `grep -riE 'arctic|openid-client|@auth/core|lucia|openauth|passport'`
  over `packages/*` and `api/` returns nothing. No provider button exists in
  `packages/auth-ui/src/components/AuthLogin.svelte` or `AuthRegister.svelte`.
- **The IdP is an OIDC/OAuth2 *server*** (Authorization Server), not a client. Full authorize →
  consent → token → userinfo → JWKS + discovery + revoke + introspect + DPoP + RFC 8707 resource
  indicators + RFC 9207 iss + PRM live under `packages/auth-hono/src/oauth/*`. The authorize handler
  (`oauth/authorize-handler.ts`) already seals an HMAC "continuation" state
  (`oauth/state-codec.ts:1` `OAuthContinuationState`) to bounce the browser to `loginUrl` /
  `registerUrl` / `consentUrl` and resume — **this is the exact hook where a federated-IdP round-trip
  slots in** (federation is a way to satisfy `loginUrl`, upstream of the OAuth server).
- **User + identity model** (`api/src/db/schema.ts`):
  - `users` (line 140): `id`, `email` (unique, nullable), `displayName`, `role`, `accountStatus`,
    `emailVerified` (default false), approval fields. Email is the de-facto natural key.
  - `webauthn_credentials` (162), `user_sessions` (179), `magic_links` (211),
    `email_verification_codes` (224), `oauth_consents` (332, `(userId,clientId)` unique).
  - **No `identities` table exists.** The only "identity-type" concept is
    `IdentityType = 'user' | 'service' | 'agent' | 'nhi' | 'mcp_connector'` re-exported from
    `@sentropic/oauth-verify` (`packages/oauth-verify/src/index.ts:23`) — a *token-subject-type* tag,
    NOT a federated-identity link table. So an `identities` table must be **added** (39h groundwork).
- **How a user record is created today** (`api/src/routes/auth/register.ts`): registration is
  email-proof-gated (email-verification JWT OR `sit_` invite token). New users are created with role
  `editor` (or `admin_app` for the first `ADMIN_EMAIL`) and `accountStatus='pending_admin_approval'`
  (approval due +48h), then `ensureWorkspaceForUser(userId)`
  (`api/src/services/workspace-service.ts:55`) provisions a personal workspace. Magic-link has its
  own create-on-verify path (`packages/auth-hono/src/magic-link.ts:135`), setting `emailVerified=true`.
  **This "proof-of-email → find-or-create user → ensure workspace → mint session" shape is exactly
  what a federation callback must reuse** — a verified-email assertion from Google is *another kind of
  email proof*.
- **Secret-at-rest pattern already in the repo**: `api/src/services/secret-crypto.ts` — AES-256-GCM
  (`enc:v1:` prefix, key = SHA-256(JWT_SECRET)) used to encrypt OAuth *outbound* connector tokens in
  `document_connector_accounts.tokenSecret` (`schema.ts:400`, consumed by
  `api/src/services/google-drive-connector-accounts.ts`) and `llm_provider_accounts.tokenSecret`
  (`schema.ts:432`). **Federation client secrets + Apple's key material should reuse this pattern
  (or SealedSecret at deploy) — do not invent a third secret store.**
- **Session mint** is a clean port call: `createAuthSessionService(...).createSession({ user, deviceInfo })`
  (`packages/auth-hono/src/session.ts:44`) issues the signed session token + refresh + DB row. A
  federation callback ends here, identical to passkey/magic-link finalization.

Net: the IdP has every downstream primitive (OAuth server, sessions, users, workspace provisioning,
secret-crypto) and a clean browser-bounce continuation hook — but **no upstream RP capability at all**.
That absence is the whole of BR-39e-federation.

---

## 1. Providers in scope + per-provider quirks

All five are OAuth2 authorization-code flows, but they diverge sharply in protocol cleanliness and in
whether they yield a *verified* email (the security pivot of §4).

| Provider | Protocol | Verified email? | Quirks that shape design |
|---|---|---|---|
| **Google** | Clean OIDC (discovery, id_token, `email_verified`) | Yes, `email_verified` claim | The reference case. PKCE supported. `sub` is the stable subject. Minimal friction. |
| **GitHub** | OAuth2 **only** (no OIDC, no id_token) | Emails via `GET /user/emails`; each has `verified` + `primary` | Must call the REST API for identity + emails; the account `id` (numeric) is the stable subject. No PKCE historically (now supported for some app types — treat as optional). Email may be private → may get no email at all. |
| **Microsoft** | OIDC (Entra ID) | `email`/`preferred_username`; verification varies | **Tenant vs `common` endpoint**: `common`/`consumers`/`organizations`/`{tenant}` change who can sign in and the `iss`. `sub` is per-(app,tenant) — pair with the immutable `oid` + `tid` for a stable global subject. Personal (MSA) vs work/school accounts behave differently. |
| **Apple** | OIDC-ish (Sign in with Apple) | `email` + `email_verified`; may be a **private-relay** address | **Hardest.** `client_secret` is a **short-lived ES256 JWT you sign** with a downloaded `.p8` key (not a static string). **`response_mode=form_post`** → the callback is a **POST** with the params in the body, not a GET query. **Name + email arrive ONLY on the first authorization** and are in the POST body, not the id_token — must be captured then or lost forever. Private-relay email (`@privaterelay.appleid.com`) forwards to the real inbox; treat as verified but understand it is provider-scoped. |
| **Facebook** | OAuth2 + limited OIDC | Email *may* be absent (user can decline / unverified) | Graph API for profile; email is not guaranteed and verification signal is weak. Lowest identity assurance of the five. |

**Recommended v1 subset + order** (reversible slice):

1. **Google** first — cleanest OIDC, highest verified-email assurance, largest coverage. Proves the
   broker + `identities` table + auto-link policy end-to-end on the easy case.
2. **GitHub** second — the developer-audience provider (relevant to the app-foundry / agent audience);
   forces the "OAuth2-not-OIDC + email-via-API + email-may-be-private" code path early, which is where
   the abstraction earns its keep.
3. **Microsoft** — first enterprise provider; introduces tenant-endpoint config. Gate to when a B2B
   need is real.
4. **Apple** — defer to a dedicated lot: JWT client_secret + form_post + first-auth-only name are a
   material extra surface. Required only if there is a consumer-iOS / App-Store distribution need.
5. **Facebook** — lowest priority / assurance; add only on explicit demand.

**Recommendation**: v1 ships **Google + GitHub**. Microsoft/Apple/Facebook are additive later lots
behind the same seam (no re-architecture — that is the point of the abstraction in §2).

**OPEN OWNER DECISION D-1**: confirm the v1 provider subset (proposed Google + GitHub) and the
priority order for the rest.

---

## 2. Build approach — library vs hand-rolled RP

The IdP is deliberately hand-rolled (no framework auth). A social-login library must fit *that* grain:
give us typed per-provider OAuth2 clients and leave sessions/users/routing to our existing code.

| Option | What it is | Fit with hand-rolled Hono | Apple/MS coverage | Dep/security surface | Control |
|---|---|---|---|---|---|
| **arctic** (+ **oslo** for PKCE/JWT/state primitives) | A thin, typed library of ~50 per-provider OAuth2 clients (authorization URL builder + code→token exchange + refresh). **No sessions, no DB, no framework.** | **Excellent** — it is *only* the RP protocol layer; we keep our authorize/continuation/session code untouched. | Google/GitHub/MS/Apple/Facebook all first-class; Apple's ES256 client_secret helper exists in the oslo/arctic orbit. | Small, focused, actively maintained; we still own the callback logic (where the real security lives). | High — we write the callback, linking, session mint. |
| **@auth/core (Auth.js)** | Full auth framework: providers + session strategy + adapters + its own routing/CSRF model. | **Poor** — it wants to *own* the session and route layer; wrapping it around our OAuth *server* + WebAuthn + magic-link means two competing session models. Adapter friction against our schema. | Excellent provider coverage. | Large; opinionated; couples us to its release cadence and its session semantics. | Low — we cede session/routing control. |
| **Lucia** | (Now largely a "reference/learning" resource rather than a maintained lib after the maintainer's 2024/25 wind-down.) | N/A — not a stable dependency to adopt. | N/A | N/A | N/A |
| **openauth** | A standalone OAuth *server*/issuer (SST). It is an *IdP*, overlapping what we already have. | **Wrong layer** — it competes with `auth-hono`'s OAuth server, not with the missing RP piece. | Some. | Would mean replacing our IdP, not extending it. | N/A |

**Recommendation: adopt `arctic` (with `oslo` for PKCE/state/JWT helpers) as the RP protocol layer;
keep everything else hand-rolled.** Rationale: arctic supplies exactly the piece we lack (typed
provider clients incl. Apple's awkward client_secret and the form_post-friendly token exchange) and
*nothing* we already own. Auth.js/openauth both want to own layers we already have working in
production; adopting them is a rewrite, not an extension. arctic keeps the security-critical callback
(state/nonce/PKCE verification, linking policy, session mint) in our code where it is auditable.

Packaging: add federation as a **new capability inside `@sentropic/auth-hono`** (new
`src/federation/*` module + optional `federation` port bag), OR as a sibling `@sentropic/auth-federation`
that depends on auth-hono. Prefer **inside auth-hono behind an optional port** (mirrors how `tenant`,
`consentStore`, `invites` are already optional ports in `ports.ts:341` — legacy behavior when absent),
so hosts opt in by wiring a `federation` port and provider configs; no new published package until a
second consumer needs it (architecture.md: "package extraction activated by real app consumption").

**OPEN OWNER DECISION D-2**: approve `arctic + oslo` as the RP library (vs hand-rolling the OAuth2
clients, vs Auth.js). Reversible: arctic is used only inside the callback; swapping it later is local.

**OPEN OWNER DECISION D-3**: packaging — federation as an **optional port inside `@sentropic/auth-hono`**
(recommended, additive-minor bump 0.12.0) vs a new `@sentropic/auth-federation` package. New-package =
publish/versioning surface; owner-gated per repo norms.

---

## 3. Federation model — broker vs pass-through

**BROKER (recommended, non-negotiable invariant).** The Sentropic IdP acts as an **OIDC/OAuth2 RP to
the external provider only for the enrollment/login moment**. On a successful upstream callback the IdP
**mints its OWN Sentropic session + its OWN downstream tokens** exactly as passkey/magic-link do today
(`session.ts:createSession`; downstream apps then still go through *our* OAuth server in
`oauth/authorize-handler.ts`). The external provider is used to *establish who the human is*, then
discarded from the downstream trust path.

**Invariant (must be a test): external tokens NEVER leak downstream.** The Google/GitHub/Apple
access_token, id_token, and refresh_token are used only server-side inside the callback to fetch the
verified identity, then either dropped or stored encrypted for *re-auth only* — they are **never** put
in a Sentropic id_token/access_token, never returned to the browser, never forwarded to a downstream
RP. Downstream apps see one issuer (`auth.sent-tech.ca`) and one token format, whether the human
enrolled by passkey or by Google. Federation is strictly **upstream** of the Sentropic IdP (§6).

Pass-through (forwarding the external id_token or making downstream apps trust Google directly) is
**rejected**: it multiplies the issuers downstream apps must trust, leaks provider tokens, and defeats
the single-authority design that the whole `oauth/*` stack exists to provide.

**OPEN OWNER DECISION**: none — broker is the recommendation and the only model consistent with the
existing OAuth-server architecture. (Recorded here for completeness; owner may veto.)

---

## 4. Account model + linking policy (the security core)

### 4a. Storage: new `identities` table (recommended)

No `identities` table exists today (§0). Add one — additive, one migration
(`api/drizzle/*.sql`), no change to `users`:

```
identities (
  id                       text PK,
  user_id                  text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 text NOT NULL,          -- 'google' | 'github' | 'microsoft' | 'apple' | 'facebook'
  provider_subject         text NOT NULL,          -- the provider's STABLE subject (Google sub, GitHub numeric id,
                                                    --   MS oid+tid, Apple sub, FB id) — NOT the email
  email_at_link            text,                    -- the email asserted by the provider at link time (audit)
  email_verified_by_provider boolean NOT NULL,      -- did the provider assert this email as verified?
  linked_at                timestamp NOT NULL,
  last_login_at            timestamp,
  UNIQUE (provider, provider_subject)               -- one external identity maps to exactly one user
)
```

Rationale for a table (not columns on `users`): a user may link *several* providers; the natural key
downstream is `(provider, provider_subject)`, not email; and `IdentityType` in oauth-verify is a
token-subject tag, orthogonal to this link table. This is also the 39h groundwork (an `identities`
spine the token/claim layer can reference later). Encrypted provider refresh tokens (if stored for
re-auth) reuse `secret-crypto.ts` in a nullable `token_secret` column — but v1 need not store them at
all (broker uses the provider once and drops it).

### 4b. Linking policy — the confused-deputy / account-takeover surface

Three cases at callback time, keyed on `(provider, provider_subject)`:

1. **Known identity** (`(provider, provider_subject)` already in `identities`): log in that `user_id`.
   Simple, no email involved. Safe.
2. **Unknown identity, no email collision**: create a new `users` row (proof-of-email = the provider
   assertion, if verified) + `identities` row + `ensureWorkspaceForUser`. Mirrors cold register.
3. **Unknown identity, email collides with an existing Sentropic user**: the dangerous case.

**Auto-link rule (recommended, strict):** auto-link the new external identity to the existing
Sentropic user **ONLY IF the provider asserts the email as VERIFIED** (`email_verified` true /
GitHub email `verified:true` / Apple `email_verified`) **AND** policy allows auto-link for that
provider. Otherwise **do NOT auto-link** — instead require the user to prove control of the existing
account (log in with the existing passkey/magic-link first, *then* link from an authenticated settings
flow), or surface a "an account with this email exists — sign in to link" challenge.

**Why this is load-bearing (spell out the attack):**
- **Account takeover via unverified email.** GitHub lets you list an email you do not own if it is
  unverified; Facebook may return an unverified/absent email; a malicious provider app could assert
  any string. If we auto-linked on *unverified* email, an attacker who controls a social account
  claiming `victim@corp.com` (unverified) would be silently merged into the victim's Sentropic user —
  full takeover. **Verified-email gate closes this.**
- **Confused deputy.** Treating "the provider says this email" as "the human controls this email" is
  the classic confused-deputy: the IdP is deputized by the provider's assertion. Only a *verified*
  assertion + a per-provider trust decision (we trust Google's `email_verified`; we may not trust
  Facebook's) is safe. Private-relay Apple emails are provider-verified and safe to treat as verified,
  but they are provider-scoped (a different relay per app) — do not cross-link relay emails across
  providers.
- **No email at all** (GitHub private, Facebook declined): case 2/collision cannot be evaluated →
  create a fresh user with no email, or ask the user to add+verify one; never guess.

**OPEN OWNER DECISION D-4**: ratify the linking policy — **auto-link to an existing user ONLY on a
provider-verified email; unverified/absent email = create-fresh-or-challenge, never silent merge.**
Also: is *any* auto-link acceptable in v1, or must first-time collision ALWAYS require an authenticated
manual link (most conservative)? Recommendation: allow auto-link on verified email for Google;
require manual-link-when-authenticated for the rest until each provider's verification is trusted.

**OPEN OWNER DECISION D-5**: per-provider "trust this provider's `email_verified`" allowlist —
default-trust Google + Microsoft; default-DISTRUST GitHub-unverified + Facebook (they fall to the
manual/challenge path). Owner sets the initial trust map.

---

## 5. Security

Every item below is a callback-side concern the RP library (arctic) does not decide for us:

- **State** (CSRF/session-fixation on the callback): generate a random `state` per start, bind it to
  the browser (short-lived HttpOnly cookie or the existing HMAC continuation `state-codec.ts`), verify
  it exactly on callback. Reuse `createOAuthHmacStateCodec` / `sha256Base64url` (`oauth/crypto-utils.ts`)
  rather than a new primitive.
- **Nonce** (OIDC replay): for OIDC providers (Google/MS/Apple) generate a `nonce`, send it, and verify
  it in the returned id_token.
- **PKCE** where supported (Google, MS, Apple, GitHub-modern): always send `code_challenge=S256`; the
  IdP's own authorize handler already mandates S256 (`authorize-handler.ts:232`) — mirror that rigor
  upstream.
- **Open-redirect on `returnTo`**: the post-login `returnTo` / `continue` MUST be validated against the
  same allowlist logic the OAuth server already applies to `redirect_uri`
  (`oauth/redirect-utils.ts validateRedirectUri`). Never redirect to an arbitrary caller-supplied URL.
- **Apple `form_post`**: the callback route must accept **POST** (body-encoded params) for Apple, GET
  for the others — one route, two parsers. Capture Apple's first-auth name/email from the POST body
  immediately (it never comes again).
- **Secret storage**: per-provider `client_id`/`client_secret` and Apple's `.p8` key + key_id/team_id
  are secrets. Store as env / SealedSecret at deploy (like `JWT_SECRET`), and if any provider
  refresh token is persisted, encrypt with `secret-crypto.ts` (`enc:v1:` AES-256-GCM). Apple's ES256
  client_secret JWT is minted at runtime from the `.p8` — never stored as a static string.
- **Redirect URI registration** (owner action): each provider console needs the exact callback URL
  (`https://auth.sent-tech.ca/auth/federation/{provider}/callback`) registered; Apple needs the domain
  + return URL verified. This is an out-of-band owner/ops task per provider.
- **Rate-limit / abuse**: the start endpoint should be rate-limited like the email endpoints
  (`AuthHonoEmailCodePolicy` window) to prevent enumeration/spam.

**OPEN OWNER DECISION D-6**: secret placement — env/SealedSecret for client secrets (recommended,
matches `JWT_SECRET`) vs a DB-backed per-provider config table (needed only if providers are
tenant-configurable at runtime — defer). And: where do provider secrets live for the standalone IdP
deploy (auth.sent-tech.ca) — same SealedSecret bundle as the auth-idp image.

---

## 6. IdP surface — new routes + interplay with the existing OAuth server

New RP-side routes (all *upstream* of the OAuth server):

- `GET /auth/federation/:provider/start` — build the provider authorization URL (state+nonce+PKCE),
  set the state cookie, carry the sealed `continue` (the pending OAuth authorize continuation, if the
  user arrived via a downstream app's `/authorize` → `loginUrl` bounce), 302 to the provider.
- `GET|POST /auth/federation/:provider/callback` — verify state/nonce/PKCE, exchange code→token
  (arctic), fetch verified identity, apply §4 linking policy, `ensureWorkspaceForUser`, mint the
  Sentropic session (`session.ts:createSession`), then **resume**: if a sealed `continue` is present,
  redirect back into `/authorize?continue=…` so the OAuth server finishes the downstream SSO exactly
  as it does after passkey login (`authorize-handler.ts resumeLoginContinuation`); else redirect to the
  post-login app.

**Discovery impact: NONE on the RP side.** Our `/.well-known/openid-configuration`
(`oauth/wellknown-handler.ts`) describes us *as an issuer to downstream apps*; being an RP to Google
adds nothing to it. We *consume* the providers' discovery documents (or hardcode their endpoints via
arctic), we do not publish new metadata.

**Interplay invariant**: a social-enrolled user is, from the OAuth server's perspective, just a normal
`users` row with a live session. They subsequently use the **Sentropic** OAuth server for downstream
app SSO identically to a passkey user. Federation replaces *how the session is established*, not the
downstream token issuance. The continuation `state-codec.ts` is the single integration seam — no change
to token-handler, consent, JWKS, or userinfo.

---

## 7. UI — provider buttons (auth-ui, DS-styled)

Add a DS-styled provider-button row to `packages/auth-ui/src/components/AuthLogin.svelte` and
`AuthRegister.svelte` (both already import `@sentropic/design-system-svelte` `Button`). The buttons are
plain links/`<Button>`s to `/auth/federation/:provider/start?…` (federation is a browser redirect, not
an XHR through the `AuthUiTransport` fetch contract) — so this is additive props, not a transport
change:

- A `federationProviders?: Array<{ id, label, icon }>` prop (empty = no change; legacy hosts unaffected).
- Buttons render under the passkey primary action ("or continue with Google / GitHub"), DS-themed via
  the host's `ThemeProvider` (auth-idp already wraps in `entropicTheme` — layout §Adjacent).
- Three flows share the same button but differ in copy/handler intent:
  - **Enrollment** (register screen): first social login → create user.
  - **Login** (login screen): returning social user.
  - **Link-existing-account** (authenticated settings, e.g. alongside `AuthDevices.svelte`): a
    logged-in user adds a provider — this is the *safe* linking path from §4 (proves account control).

DS coordination: buttons must use DS components/tokens (no bespoke brand-colored buttons) to satisfy
the "reuse UI, no entropy" rule. Provider glyphs are the one asset that may need adding to the DS icon
set (coordinate with DS owner) or inlined as licensed brand marks.

**OPEN OWNER DECISION D-7**: auth-ui minor bump adding `federationProviders` prop + button row —
additive-minor (recommended, no breaking change). Confirm the link-existing-account flow is in v1 or
deferred (recommend: include, it is the safe collision path from §4).

---

## 8. Multi-tenant landing

Where does a social-enrolled user land? Today registration → `ensureWorkspaceForUser` (a personal
workspace) and `accountStatus='pending_admin_approval'`. Tenancy is modeled by `tenant_memberships`
(`schema.ts:820`, status `requested|invited|approved|…`) and the optional `AuthHonoTenantPort`
(`ports.ts:296`) that derives the `tid` claim only from an **approved** membership.

For v1: a social-enrolled user follows the **exact same path as a cold email registrant** — personal
workspace + `pending_admin_approval` + no tenant claim until an approved `tenant_memberships` row
exists. No special-casing. Enterprise auto-provisioning ("anyone with an `@corp.com` Microsoft login
auto-joins tenant corp") is a **Microsoft-era, BR-39e-tenancy concern — deferred**; it depends on the
verified-domain trust of §4/§5 and the membership-approval flow, and should not gate v1
(Google/GitHub).

**OPEN OWNER DECISION D-8**: confirm v1 lands social users in the same personal-workspace +
pending-approval path as email registrants (recommended), deferring domain-based tenant
auto-provisioning to the Microsoft/enterprise lot.

---

## 9. Spec-ladder + roadmap (reversible v1 slice)

**v1 (reversible, minimal, owner-gated at D-1..D-8):**
- Broker model (§3), external tokens never leak downstream (test-enforced invariant).
- `arctic + oslo` RP layer, wired as an **optional `federation` port inside `@sentropic/auth-hono`**
  (legacy behavior when absent).
- New `identities` table (one migration), UNIQUE `(provider, provider_subject)`.
- Providers **Google + GitHub** only.
- Linking policy: **auto-link only on provider-verified email (Google); manual-link-when-authenticated
  for GitHub-unverified**; never silent-merge on unverified/absent email.
- Routes `/auth/federation/:provider/{start,callback}`; resume via existing continuation seam.
- auth-ui `federationProviders` prop + DS-styled button row; link-existing-account flow included.
- Social users land in personal-workspace + pending-approval (no tenant special-casing).

**Gated / later lots (each additive behind the same seam):**
- Microsoft (tenant-endpoint config) → introduces enterprise + domain-trust.
- Apple (JWT client_secret + form_post + first-auth capture) → dedicated lot.
- Facebook (lowest assurance) → on demand.
- Domain-based tenant auto-provisioning (BR-39e tenancy).
- 39h: `identities` referenced by the token/claim layer (identity-type spine).

Suggested lot decomposition for the build branch (harness-plan later):
- Lot 0 — `identities` table + migration + repo port.
- Lot 1 — federation port contract in auth-hono + arctic wiring (Google).
- Lot 2 — callback + linking policy + tests (verified-email gate is the keystone test).
- Lot 3 — GitHub (OAuth2/email-via-API/private-email path).
- Lot 4 — auth-ui buttons + auth-idp host wiring + UAT.

---

## 10. Owner decisions (batched)

Each decision below has inline context (source + stakes + consequence). These are the calls this study
FRAMES; the owner decides.

- **D-1 — v1 provider subset & order.** *Source*: §1. *Stakes*: scope/effort of v1; each provider is a
  distinct code path (OIDC-clean vs OAuth2-only vs form_post). *Consequence*: picks what ships first and
  what is deferred. *Reco*: Google + GitHub in v1; MS → Apple → Facebook as later lots.
- **D-2 — RP library.** *Source*: §2. *Stakes*: dependency + security-maintenance surface; framework
  lock-in. *Consequence*: `arctic + oslo` keeps sessions/routing hand-rolled; Auth.js/openauth would be
  a rewrite. *Reco*: `arctic + oslo`; reversible (used only in the callback).
- **D-3 — packaging.** *Source*: §2. *Stakes*: new published package vs additive port; versioning norms
  ("no new package without a decision"). *Consequence*: optional `federation` port inside
  `@sentropic/auth-hono` (0.12.0 additive-minor) vs new `@sentropic/auth-federation`. *Reco*: optional
  port inside auth-hono.
- **D-4 — linking policy (SECURITY).** *Source*: §4. *Stakes*: account-takeover / confused-deputy — the
  single most dangerous decision. *Consequence*: auto-link to an existing user ONLY on provider-verified
  email; unverified/absent = create-fresh-or-challenge, never silent merge. *Reco*: ratify as stated;
  in v1 allow verified-email auto-link for Google only, manual-link-when-authenticated elsewhere.
- **D-5 — per-provider verified-email trust map.** *Source*: §4/§5. *Stakes*: which provider's
  `email_verified` we trust for auto-link. *Consequence*: default-trust Google/Microsoft;
  default-distrust GitHub-unverified/Facebook (→ manual path). *Reco*: adopt that default map.
- **D-6 — secret placement.** *Source*: §5. *Stakes*: where client secrets + Apple `.p8` live; runtime
  vs deploy config. *Consequence*: env/SealedSecret (matches `JWT_SECRET`) vs DB config table.
  *Reco*: env/SealedSecret in the auth-idp deploy bundle; reuse `secret-crypto.ts` for any stored
  provider refresh token.
- **D-7 — auth-ui prop + flows.** *Source*: §7. *Stakes*: additive-minor UI contract change; whether the
  link-existing-account flow ships in v1. *Consequence*: `federationProviders` prop + DS button row;
  include the safe manual-link flow. *Reco*: additive-minor; include link flow.
- **D-8 — multi-tenant landing.** *Source*: §8. *Stakes*: enterprise auto-provisioning scope creep.
  *Consequence*: v1 = same personal-workspace + pending-approval as email registrants; domain-based
  tenant auto-join deferred to the Microsoft/enterprise lot. *Reco*: confirm deferral.

---

## Adjacent: DS header on auth screens

Two chromes exist today and they diverge:
- The **canonical brand header is app-local**: `ui/src/lib/components/Header.svelte` — a rich,
  session-aware header (brand SENT, right burger, workspace-scope selectors, identity/lang accordions,
  chat-widget-aware compaction). It is *not* a DS component; it is `ui/`-specific.
- The **IdP auth screens use the DS chrome**: `apps/auth-idp/web/src/routes/+layout.svelte:21` renders
  `@sentropic/design-system-svelte` `AppChrome brandName="SENT" productName="Sentropic ID"` inside the
  `entropicTheme` `ThemeProvider`. `AppChrome` gives brand + built-in language selector but not the
  app-specific session/workspace machinery of `ui/`'s Header.

So the two are *not* duplicates of the same component — they serve different surfaces (full app vs
IdP screens). The reversible options for coherence:

- **(a) Promote a shared DS chrome** consumed by BOTH `ui/` and `apps/auth-idp/web`: extract the
  brand-zone + burger shell into a DS component (`AppChrome` variant or a new `AppHeaderShell`), and
  have `ui/`'s Header compose it while keeping its app-local session/workspace logic as slotted
  content. Pros: single brand source of truth, no entropy, DS-owned brand change propagates
  everywhere. Cons: a DS-owned change (coordination + version bump); `ui/`'s Header is heavily
  app-coupled, so only the *shell* is shared, not the whole component.
- **(b) Configure `AppChrome`'s brand zone** so the IdP screens match the app brand exactly (feed
  `AppChrome` the same brand tokens/slot `ui/`'s Header uses). Pros: cheapest, no `ui/` refactor,
  stays within the DS's existing extension points. Cons: two implementations remain; brand parity is
  by-configuration, not by-construction.
- **(c) App-local duplicate** of the header inside auth-idp — **rejected** (entropy; two brand
  headers drift; violates reuse/no-entropy).

**Recommendation: (b) now, (a) if/when a second host needs the shared shell.** (b) achieves brand parity
on the auth screens immediately with a DS-config change and no `ui/` risk; it is fully reversible into
(a) later. Both (a) and (b) are **DS-owned changes** — coordinate with the design-system owner before
touching `AppChrome`; do not fork it app-locally. If the owner wants one brand header everywhere as a
principle, choose (a) and scope it as a DS branch (extract shell → `ui/` composes → auth-idp consumes).
