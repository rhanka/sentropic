# SPEC_EVOL_39E_SOCIAL_FEDERATION — Committed Design for Upstream Social/Enterprise Federation

Status: EVOL (committed design). Decision-grade, grounded, ready for `harness-plan`. Spec only — NO
implementation code, NO schema/migration edits.

Rung: harness-brainstorm EVOL. Input: `spec/SPEC_STUDY_39E_SOCIAL_FEDERATION.md` (the STUDY, left
as-is). This EVOL encodes the owner decisions ratified 2026-07-09 (OD1–OD4) and the reconciled
Opus-4.8 + Codex-5.5xhigh review refinements (R1–R9) as HARD design constraints.

Lineage: BR-39e (federation-first). This is the *social/enterprise login federation* half of 39e:
letting a human enroll/sign in to the Sentropic IdP via Google / GitHub / Microsoft / Apple /
Facebook, while the IdP remains the single OIDC authority downstream apps trust.

---

## 1. Purpose + broker architecture (grounded)

### 1.1 Purpose

Add **upstream Relying-Party (RP) capability** to `@sentropic/auth-hono` so a human can enroll or sign
in through an external identity provider, without the IdP ceding any downstream trust. The IdP already
owns every downstream primitive — OAuth2/OIDC *server*, sessions, users, workspace provisioning,
secret-crypto — and a clean browser-bounce continuation seam. The one missing capability is RP-side
federation. That absence is the whole of BR-39e-federation.

### 1.2 Grounding (cited, current main)

- **IdP is an OAuth2/OIDC *server*, not a client.** Full `authorize → consent → token → userinfo →
  JWKS + discovery + revoke + introspect + DPoP + resource-indicators` live under
  `packages/auth-hono/src/oauth/*`. `@sentropic/auth-hono` is at **0.11.1**
  (`packages/auth-hono/package.json`). No RP/social seam exists anywhere (`grep -riE
  'arctic|oslo|openid-client|@auth/core|lucia' packages/ api/` → nothing).
- **The continuation seam is the integration point.** `oauth/authorize-handler.ts:42-44` reads
  `?continue=` and calls `resumeLoginContinuation`; when there is no session it seals an HMAC
  `OAuthContinuationState` (`oauth/state-codec.ts:1`, `createOAuthHmacStateCodec` line 39) and 302s the
  browser to `loginUrl` / `registerUrl` (lines 94-103). **Federation is a new way to satisfy that
  `loginUrl` bounce — strictly *upstream* of the OAuth server.**
- **User model** (`api/src/db/schema.ts:140`): `users(id, email UNIQUE nullable, displayName, role,
  accountStatus, emailVerified default false, …)`. Email is the de-facto natural key. **No `identities`
  table exists.** The `IdentityType` in `@sentropic/oauth-verify` is a token-subject tag, orthogonal to
  a federated-link table.
- **Enrollment shape to reuse** (`api/src/routes/auth/register.ts`): email-proof-gated → find-or-create
  user → `ensureWorkspaceForUser(userId)` (`api/src/services/workspace-service.ts:55`) → mint session.
  Cold users are `role='editor'` (first `ADMIN_EMAIL` → `admin_app`),
  `accountStatus='pending_admin_approval'`, `approvalDueAt=+48h` (register.ts:296-298).
- **Session mint is a clean port call**: `createAuthSessionService(...).createSession({ user,
  deviceInfo })` (`packages/auth-hono/src/session.ts:44-86`) → signed session token + refresh + DB row.
  A federation callback ends exactly here.
- **Secret-at-rest pattern**: `api/src/services/secret-crypto.ts` — AES-256-GCM, `enc:v1:` prefix,
  key = SHA-256(JWT_SECRET). Reuse it for any stored provider material; do not invent a third store.

### 1.3 Broker architecture (the invariant)

**BROKER — non-negotiable.** On a successful upstream callback the IdP mints its **OWN** Sentropic
session and its **OWN** downstream tokens exactly as passkey/magic-link do today. The external provider
establishes *who the human is* for the enrollment/login moment, then is discarded from the downstream
trust path. Downstream apps see **one issuer** (`auth.sent-tech.ca`) and one token format whether the
human enrolled by passkey or by Google.

**Grounded no-leak proof** (this is why broker is *free* here, not a rewrite):
- The downstream access/id token is minted by `oauth/token-handler.ts:363` (`jwks.signJwt`) purely from
  `codePayload` + the `users` row — it never reads any external-provider token.
- `oauth/userinfo-handler.ts:40-44` returns `sub/name/email/email_verified` sourced **only** from
  `options.ports.users.findById` — never from a provider.
- Therefore federation slots in *above* these handlers, and the external token has no path downstream.
  Making that a **test-enforced invariant** (§7 K-LEAK) costs no re-architecture.

Pass-through (forwarding the external id_token, or making downstream apps trust Google directly) is
**REJECTED**: it multiplies downstream issuers, leaks provider tokens, and defeats the single-authority
design the whole `oauth/*` stack exists to provide.

### 1.4 The seam picture

```
downstream app ──/authorize?…──▶ authorize-handler ──(no session)──▶ loginUrl bounce
                                        ▲                                   │
                                        │ ?continue=<sealed>                │  user clicks "Continue with Google"
                                        │                                   ▼
                        resumeLoginContinuation ◀── federation callback ◀── /auth/federation/:provider/{start,callback}
                                                     (mints Sentropic session, then resumes the sealed continuation)
                                                                │
                                                       external provider (Google/…)  ← RP round-trip lives ONLY here
```

Federation replaces *how the session is established*, not the downstream token issuance. The
continuation `state-codec.ts` is the single integration seam — no change to token-handler, consent,
JWKS, or userinfo behavior.

---

## 2. Committed decisions (D1..D18)

Each decision states the **invariant** and **why**. D1–D18 fold OD1–OD4 and R1–R9.

- **D1 — Broker model, external tokens never leak downstream.** *Invariant*: federation is upstream of
  the OAuth server; the callback mints a Sentropic session (`session.ts:createSession`) and the sealed
  continuation resumes normally; the external access/id/refresh token is used server-side inside the
  callback only, then dropped (v1 stores none). *Why*: single downstream issuer; grounded no-leak at
  `token-handler.ts:363` / `userinfo-handler.ts:40`. (Folds STUDY §3.)

- **D2 — v1 providers = ALL FIVE for LOGIN (OD1).** *Invariant*: Google, GitHub, Microsoft, Apple,
  Facebook all support enrollment + login in v1. *Why*: owner-ratified breadth. Auto-link trust is a
  *separate* narrower decision (D8/R4).

- **D3 — RP protocol library = `arctic`, adopted as a dependency-spike (R5).** *Invariant*: `arctic`
  provides the typed per-provider OAuth2/OIDC clients (authorization-URL builder + code→token exchange
  + Apple client-secret helper). Pin the version, gate it through the SCA/security CI. **Do NOT add
  `oslo`** as a second crypto substrate — use `jose` (already in the repo: `oauth-verify`, `auth-hono
  userinfo/state-store`, `auth-client`) for JWT/PKCE crypto. Callback logic, session, and linking stay
  ours. *Why*: arctic supplies exactly the missing RP layer and nothing we already own; swapping it
  later is local to the callback. Auth.js/openauth would be a rewrite. (Refines STUDY §2 / D-2.)

- **D4 — Packaging = optional `federation?` port INSIDE `@sentropic/auth-hono` (OD3).** *Invariant*:
  additive-minor bump **0.11.1 → 0.12.0**; a new `federation?` optional port bag in
  `packages/auth-hono/src/ports.ts` (mirrors `tenant?`/`consentStore?`/`invites?` at
  `ports.ts:357-362`), legacy behavior when absent. **No new published package.** *Why*: owner-ratified;
  no second consumer yet; matches "package extraction activated by real app consumption"
  (rules/architecture.md). (Refines STUDY §2 / D-3.)

- **D5 — Federation flow-state is SERVER-SIDE and distinct from the sealed continuation (R1, CRITICAL).**
  *Invariant*: the upstream-provider CSRF `state`, OIDC `nonce`, PKCE `code_verifier`, and a *pointer*
  to the sealed OAuth continuation are held in a dedicated **one-time federation flow-state** —
  persisted server-side (a new short-lived table) and referenced by an opaque id carried through the
  provider round-trip in a bound `HttpOnly; Secure; SameSite=Lax` cookie. It is verified-and-DELETED on
  callback (single-use). **The sealed HMAC `continue` is NEVER sent through an external provider** — it
  is browser-visible and carries `clientId/redirectUri/scopes/tenant`, and it is NOT the upstream CSRF
  state. *Why*: sending the continuation upstream leaks the downstream authorize parameters to the
  provider and conflates two unrelated CSRF contexts; the flow-state store is the correct binding.

- **D6 — Linking key = `(provider, provider_subject)`, resolved FIRST (R2).** *Invariant*: the callback
  resolves identity **only** by `(provider, provider_subject)` first (`findIdentityBySubject`). Only if
  absent does it consider an **exact normalized** provider-verified-email collision. It **does NOT reuse
  `register.ts`'s fuzzy lookup** (email → `displayName===email` → local-part, register.ts:113-136).
  *Why*: the subject is the stable authoritative key; the fuzzy lookup is a registration convenience
  that would create false collisions and a takeover surface in the federation path.

- **D7 — SAFE linking policy: auto-link only into a NON-credentialed shell; credentialed collision →
  authenticated manual-link, never silent merge (OD2).** *Invariant*: three cases keyed on
  `(provider, provider_subject)` — (1) known identity → log in that `user_id`; (2) unknown identity, no
  email collision → transactional find/upsert user + insert identity + `ensureWorkspaceForUser`; (3)
  unknown identity, email collides — auto-link is permitted **only** when the collided target is a
  **non-credentialed shell user** (no webauthn credential, never a completed sign-in factor) **and** the
  provider is on the auto-link allowlist (D8). A collision with an **already-credentialed** account
  **ALWAYS** routes to the authenticated manual-link path (log in with the existing factor first, then
  link from settings). *Why*: closes account-takeover/confused-deputy; a credentialed account is a real
  human's — it is never silently absorbed by a provider assertion.

- **D8 — Auto-link trust allowlist = GOOGLE ONLY in v1 (R4).** *Invariant*: all five providers do
  LOGIN; only **Google** may AUTO-LINK on a provider-verified email into a non-credentialed shell in
  v1. Microsoft (needs a `tid`/`oid`/`issuer` policy), GitHub (email unverifiable without extra proof),
  Apple (private-relay), and Facebook route their email collisions to the **authenticated manual-link**
  path until per-provider proof rules exist. *Why*: only Google's `email_verified` is trusted enough for
  silent auto-link in v1; the rest need a per-provider trust decision not yet specified.

- **D9 — No-email providers trigger an email-verification CHALLENGE, never a silent no-email user
  (R3).** *Invariant*: `users.create` requires `email: string` and the account policy rejects an
  unverified email; when a provider yields no usable verified email (GitHub private/no-primary,
  Facebook absent/declined), the callback **routes into a local email-verification challenge** (reuse
  the existing `email_verification_codes` flow) before any user/identity row is written. *Why*: a
  no-email user breaks the email-natural-key model and the account-policy contract; the challenge
  re-establishes a verified email the IdP owns.

- **D10 — Per-provider state + nonce + PKCE(S256), CSRF on callback, session rotation (R6).**
  *Invariant*: every start generates a random `state` + (for OIDC providers) a `nonce` + PKCE
  `code_challenge=S256` where the provider supports it; the callback verifies all three (mismatch →
  reject) and rotates the Sentropic session id on federation login (anti session-fixation). External
  provider tokens never reach the browser or a downstream RP. *Why*: mirrors the IdP's own S256 rigor
  (`authorize-handler.ts:232`) upstream; session rotation prevents fixation; §1.3 no-leak invariant.

- **D11 — Redirect target is a FIXED internal page; `validateRedirectUri` does NOT apply (R7).**
  *Invariant*: on callback success, if a sealed continuation is present, resume via
  `resumeLoginContinuation` (client-validated already). If there is **no** continuation, land on a
  **fixed internal post-login page** (or a relative-only allowlist) — **never** a raw caller-supplied
  `returnTo`. *Why*: `oauth/redirect-utils.ts:13` `validateRedirectUri` requires an `OauthClientRecord`
  and only checks a client's registered `redirectUris`; a bare federation `returnTo` has no client, so
  that guard cannot protect it — a fixed page is the only safe default.

- **D12 — Identity lifecycle: unlink forbids removing the last sign-in factor (R8).** *Invariant*: an
  authenticated unlink flow removes an identity + deletes any stored provider token, but **refuses**
  when it would leave the user with zero sign-in factors (no other identity AND no webauthn credential
  AND no magic-link-capable email) — lockout guard. *Why*: unlink must never brick an account.

- **D13 — Email-recycling rule: `(provider, subject)` binding is authoritative (R8).** *Invariant*: a
  changed provider email never re-links or re-collides an existing identity; `email_at_link` is audit
  metadata only, `(provider, provider_subject)` is the single truth. *Why*: providers recycle/rotate
  emails; binding to the subject prevents an old-email collision from hijacking a new owner.

- **D14 — Audit + rate-limit + GDPR (R8).** *Invariant*: link/login/unlink emit events via the existing
  `auditLog` port (`ports.ts:250`); start/callback are rate-limited keyed on IP (reuse the email-code
  policy window); the `identities` FK is `ON DELETE CASCADE` from `users` (GDPR erasure removes stored
  provider profile). *Why*: observability, anti-enumeration/abuse, right-to-erasure.

- **D15 — Secret placement = env/SealedSecret in the auth-idp deploy bundle; stored provider tokens (if
  any) via `secret-crypto.ts` (R6, STUDY D-6).** *Invariant*: per-provider `client_id`/`client_secret`
  and Apple's `.p8` + `key_id`/`team_id` live as env / SealedSecret at deploy (like `JWT_SECRET`); Apple's
  ES256 client-secret JWT is **minted at runtime** from the `.p8`, never stored as a static string. Any
  persisted provider refresh token is encrypted with the `enc:v1:` AES-256-GCM helper. *Why*: reuse the
  established secret store; no third store; runtime-minted Apple secret is required by Apple's design.

- **D16 — Apple is its OWN v1 lot (R9).** *Invariant*: Apple's `client_secret` is a short-lived ES256
  JWT minted at runtime from a `.p8`; `response_mode=form_post` makes the callback a **POST** with
  body-encoded params; name+email arrive **only on first authorization** (in the POST body, not the
  id_token) and must be captured then or lost; the email may be a `@privaterelay.appleid.com` address
  (treat as provider-verified but provider-scoped). *Why*: material extra surface that must not
  contaminate the GET-callback providers.

- **D17 — auth-ui `federationProviders` prop + DS-styled buttons + link/unlink flows; additive-minor
  (OD-adjacent, STUDY D-7).** *Invariant*: `@sentropic/auth-ui` gains an optional
  `federationProviders?: Array<{ id, label, icon }>` prop on `AuthLogin`/`AuthRegister` (empty = no
  change, legacy hosts unaffected); buttons are plain `<Button>` links to
  `/auth/federation/:provider/start?…` (a browser redirect, **not** an `AuthUiTransport` XHR); an
  authenticated link/unlink surface (alongside `AuthDevices.svelte`) drives the safe manual-link path.
  DS-styled via the host `ThemeProvider`; provider glyphs coordinated with the DS owner. Bump
  0.6.0 → 0.7.0. *Why*: additive contract; the manual-link flow is the safe collision path from D7.

- **D18 — v1 landing = same personal-workspace + pending-approval path as an email registrant (STUDY
  D-8).** *Invariant*: a social-enrolled user follows the exact cold-register path —
  `ensureWorkspaceForUser` + `accountStatus='pending_admin_approval'` + no tenant claim until an
  approved `tenant_memberships` row exists. Domain-based tenant auto-provisioning is **deferred** to the
  Microsoft/enterprise lot. *Why*: no special-casing; enterprise auto-join depends on verified-domain
  trust not in v1 scope.

---

## 3. Data shape + federation port contract + transactional linking

### 3.1 `identities` table (additive, one migration, no change to `users`)

```
identities (
  id                          text PK,
  user_id                     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                    text NOT NULL,     -- 'google'|'github'|'microsoft'|'apple'|'facebook'
  provider_subject            text NOT NULL,     -- STABLE subject: Google sub, GitHub numeric id,
                                                 --   MS oid (paired with tid), Apple sub, FB id — NOT the email
  email_at_link               text,              -- provider-asserted email at link time (audit only, D13)
  email_verified_by_provider  boolean NOT NULL,  -- did the provider assert this email verified?
  provider_tenant             text,              -- MS `tid` (null for others); part of the MS subject policy
  token_secret                text,              -- nullable; enc:v1: AES-256-GCM if a provider token is stored
  linked_at                   timestamptz NOT NULL,
  last_login_at               timestamptz,
  UNIQUE (provider, provider_subject)            -- one external identity ↔ exactly one user (D6)
)
```

Index on `user_id` (list a user's identities for the settings surface and the unlink lockout check).
`token_secret` stays null in v1 (broker drops the provider token; D1). This is also 39h groundwork (an
identities spine the token/claim layer can later reference).

### 3.2 Federation port contract (added to `AuthHonoPorts` as optional `federation?`)

Method signatures (design; exact TS lands in the build branch):

```
interface AuthHonoIdentityRecord {
  id: string; userId: string; provider: string; providerSubject: string;
  emailAtLink: string | null; emailVerifiedByProvider: boolean;
  providerTenant: string | null; linkedAt: Date; lastLoginAt: Date | null;
}

interface AuthHonoFederationFlowState {
  id: string;                    // opaque; the pointer carried in the bound cookie (D5)
  provider: string;
  upstreamState: string;         // CSRF state sent to the provider
  nonce: string | null;          // OIDC nonce (null for pure OAuth2)
  codeVerifier: string | null;   // PKCE verifier (null where unsupported)
  continuationToken: string | null;  // POINTER to the sealed OAuth continuation (never sent upstream)
  createdAt: Date; expiresAt: Date;
}

interface AuthHonoFederationPort {
  // identity linkage (D6)
  findIdentityBySubject(provider: string, providerSubject: string): Promise<AuthHonoIdentityRecord | null>;
  findIdentitiesForUser(userId: string): Promise<AuthHonoIdentityRecord[]>;   // unlink lockout (D12)
  linkIdentity(input: {
    userId: string; provider: string; providerSubject: string;
    emailAtLink: string | null; emailVerifiedByProvider: boolean;
    providerTenant?: string | null; now: Date;
  }): Promise<AuthHonoIdentityRecord>;                                        // enforces UNIQUE(provider,subject)
  unlinkIdentity(userId: string, provider: string, providerSubject: string): Promise<boolean>;
  touchLogin(identityId: string, now: Date): Promise<void>;

  // one-time federation flow-state (D5)
  createFlowState(input: Omit<AuthHonoFederationFlowState, 'id' | 'createdAt'> & { now: Date }): Promise<AuthHonoFederationFlowState>;
  consumeFlowState(id: string, now: Date): Promise<AuthHonoFederationFlowState | null>;  // verify-and-DELETE, single-use
}
```

The user find/upsert reuses the existing `users` port (`create`/`findByEmail`/`findById`,
`ports.ts:63-69`); the federation port only owns identity rows + flow-state. Legacy behavior when the
`federation?` port is absent (no federation routes mounted).

### 3.3 Transactional linking algorithm (callback, steps — no code)

Given a verified provider result `{ provider, subject, email?, emailVerifiedByProvider }`:

1. **Consume flow-state** by the cookie-pointer id (`consumeFlowState`, verify-and-delete, D5). Reject
   if missing/expired.
2. **Verify** upstream `state` == flow-state `upstreamState`; verify `nonce` in id_token (OIDC);
   verify PKCE by using the flow-state `codeVerifier` in the token exchange. Any mismatch → reject
   (K-STATE).
3. **Subject-first** (D6): `id = findIdentityBySubject(provider, subject)`.
   - If found → `touchLogin`; load user; **rotate session** (D10); resume continuation or fixed page
     (D11). DONE (case 1).
4. If no email or the email is unverified and the provider is not trusted for this path → **email
   challenge** (D9): drive `email_verification_codes`; on success treat the challenge email as the
   verified email and continue at step 5 with it.
5. **No subject match** → decide by exact normalized `email`:
   - `collision = users.findByEmail(normalizedEmail)` (exact, D6 — NOT the fuzzy register lookup).
   - **No collision** → transactional block: `users.create({ email, emailVerified:true,
     role/status from accountPolicy })` **then** `linkIdentity(...)`; on the UNIQUE(provider,subject)
     conflict (concurrent callback) **re-read** via `findIdentityBySubject` and log that user in
     instead (idempotent). Then `ensureWorkspaceForUser`, rotate session, resume. DONE (case 2).
   - **Collision with a NON-credentialed shell user AND provider on the auto-link allowlist (D8 =
     Google only) AND `emailVerifiedByProvider`** → `linkIdentity(existingUserId, …)`; rotate session;
     resume. DONE (case 3a, SAFE auto-link).
   - **Collision with an ALREADY-CREDENTIALED user, OR provider not on the allowlist, OR unverified
     email** → **do NOT merge**. Route to the authenticated manual-link path: ask the human to sign in
     with their existing factor, then link this identity from settings (D7). DONE (case 3b).
6. **Manual-link path** (authenticated, from settings): the logged-in user starts a federation flow
   flagged `linkTo=<their userId>`; on callback, `linkIdentity(currentUserId, …)` after the same
   state/nonce/PKCE checks — this is the ONLY path that attaches a provider to a credentialed account.

"Non-credentialed shell user" = a `users` row with no `webauthn_credentials` and no completed sign-in
factor (e.g. an invited-but-never-enrolled or magic-link-only-unused shell). The credentialed check is
`findIdentitiesForUser` + a webauthn-credential lookup via the host adapter.

---

## 4. Per-provider matrix

| Provider | Protocol | Verified email in v1 | Auto-link (v1) | Special handling |
|---|---|---|---|---|
| **Google** | Clean OIDC (discovery, id_token, `email_verified`, PKCE S256) | Yes — `email_verified` claim | **AUTO-LINK** (into non-credentialed shell only, D7/D8) | Reference case. `sub` = stable subject. Nonce + PKCE. |
| **GitHub** | OAuth2 only (no OIDC/id_token) | Via `GET /user/emails` (`verified` + `primary`); may be **private/absent** | Manual-link only | Numeric account `id` = subject. Fetch identity + emails via REST. No verified/no email → **email challenge (D9)**. PKCE optional (send S256 if the app type supports it). |
| **Microsoft** | OIDC (Entra ID) | `email`/`preferred_username`; verification varies | Manual-link only (v1) | `common`/`consumers`/`organizations`/`{tenant}` endpoint changes `iss` + who signs in. `sub` is per-(app,tenant) → subject = `oid`, store `tid` in `provider_tenant` and enforce an issuer/`tid` policy before any future auto-link. Nonce + PKCE. |
| **Apple** | OIDC-ish (Sign in with Apple) | `email` + `email_verified`; may be `@privaterelay.appleid.com` | Manual-link only (v1) | **Dedicated lot (D16).** `client_secret` = ES256 JWT minted at runtime from `.p8` (`key_id`/`team_id`). **`response_mode=form_post` → POST callback** (body-parsed). Name+email **only on first auth**, in the POST body — capture immediately. `sub` = subject. Private-relay email = verified but provider-scoped (never cross-link relay emails). |
| **Facebook** | OAuth2 + limited OIDC | Email may be **absent/declined**, weak verification | Manual-link only | Graph API for profile. Lowest assurance. No/unverified email → **email challenge (D9)**. FB `id` = subject. |

**One callback route, two parsers**: GET for Google/GitHub/Microsoft/Facebook, **POST (form_post)** for
Apple. The route detects the method and parses body vs query accordingly (§6).

---

## 5. v1 lot breakdown (reversible, ordered — ready for harness-plan)

Each lot = scope + keystone test(s). Lots 1–5 are additive behind the same seam (no re-architecture).

- **Lot 0 — `identities` table + federation port + flow-state store.**
  Scope: one migration for `identities` (§3.1) + a `federation_flow_states` short-lived table; the
  `federation?` optional port contract in `auth-hono/ports.ts` (§3.2, legacy when absent); host repo
  adapter (Drizzle) implementing it; the bound-cookie helper for the flow-state pointer.
  *Keystone*: K-UNIQUE (UNIQUE(provider,subject) rejects a duplicate insert); K-FLOW
  (`consumeFlowState` is single-use: second consume returns null).

- **Lot 1 — Broker core + Google (auto-link).**
  Scope: `arctic` dependency-spike (pinned, SCA-gated, D3); `/auth/federation/:provider/{start,callback}`
  routes (GET); start builds the auth URL with state+nonce+PKCE and sets the bound flow-state cookie
  carrying the continuation *pointer* (D5); Google callback → verified identity → transactional linking
  algorithm (§3.3) with Google on the auto-link allowlist; session rotation; resume via
  `resumeLoginContinuation` or fixed page (D11); audit events (D14).
  *Keystone*: K-SUBJECT (subject-first ordering); K-AUTOLINK-SHELL (Google verified-email auto-links a
  non-credentialed shell); K-NOLEAK (external token never appears in a downstream token/response);
  K-SEALED (sealed continuation is never sent upstream); K-ROTATE (session id rotates).

- **Lot 2 — GitHub (email challenge + manual-link).**
  Scope: GitHub OAuth2 (no id_token); numeric-id subject; `GET /user/emails` for the primary+verified
  email; private/absent/unverified email → email-verification challenge (D9); collisions route to
  manual-link (not auto-link, D8).
  *Keystone*: K-GH-CHALLENGE (private/no-email GitHub → challenge, no silent no-email user);
  K-GH-MANUAL (GitHub email collision with a credentialed account → manual-link, never merge).

- **Lot 3 — Microsoft (Entra).**
  Scope: OIDC with tenant-endpoint config; subject = `oid`, store `tid` (`provider_tenant`) + enforce
  issuer/`tid` policy; nonce + PKCE; manual-link only in v1.
  *Keystone*: K-MS-SUBJECT (subject is `oid`+`tid`, not the per-app `sub`; a `sub` collision across
  tenants does not merge users).

- **Lot 4 — Apple (dedicated, D16).**
  Scope: ES256 client-secret JWT minted at runtime from `.p8` (via `jose`, D15); `response_mode=form_post`
  → the callback accepts POST + parses the body; capture first-auth name/email from the POST body;
  private-relay email handled as verified-but-scoped; manual-link only.
  *Keystone*: K-APPLE-FORMPOST (POST-body callback parsed; first-auth name/email captured; missing GET
  query does not break the callback); K-APPLE-SECRET (a valid ES256 client-secret JWT is minted).

- **Lot 5 — Facebook.**
  Scope: OAuth2 + Graph profile; absent/declined email → email challenge (D9); manual-link only.
  *Keystone*: K-FB-CHALLENGE (absent email → challenge, no silent no-email user).

- **Lot 6 — auth-ui provider buttons + link/unlink flows (D17).**
  Scope: `federationProviders?` prop on `AuthLogin`/`AuthRegister` (empty = legacy); DS-styled `<Button>`
  links to `/auth/federation/:provider/start`; authenticated link/unlink surface with the last-factor
  lockout guard (D12); auth-idp host wiring; UAT.
  *Keystone*: K-UI-LEGACY (no `federationProviders` → zero UI change; existing tests green);
  K-UNLINK-LASTFACTOR (unlink refused when it would remove the last sign-in factor).

- **Lot A (separate, small — OD4) — AppChrome brand header on auth screens.**
  Scope: configure the DS `AppChrome` brand zone so `apps/auth-idp/web/src/routes/+layout.svelte:21`
  matches the app brand exactly (feed the same brand tokens the `ui/` header uses). Minimal, reversible;
  **DS-owned change — coordinate with the DS owner**, do not fork `AppChrome` app-locally. Option (a)
  (promote a shared `AppHeaderShell` consumed by both `ui/` and auth-idp) is the later, principled
  upgrade if the owner wants one brand header everywhere.
  *Keystone*: visual/UAT parity check — auth screens render the app brand; no `ui/` refactor, no DS fork.

Ordering rationale: Lot 0 unblocks everything; Lot 1 proves the broker + auto-link on the easy case;
Lots 2–5 each add one provider behind the same seam; Lot 6 surfaces them; Lot A is independent DS work.

---

## 6. IdP surface — new routes (upstream of the OAuth server)

- `GET /auth/federation/:provider/start` — build the provider authorization URL (state+nonce+PKCE),
  create the server-side flow-state (D5), set the bound `HttpOnly; Secure; SameSite=Lax` cookie carrying
  the flow-state id, and — if the user arrived via a downstream `/authorize → loginUrl` bounce — record
  the sealed continuation *pointer* inside the flow-state (never in a provider param). 302 to the
  provider. Optional `linkTo` flag for the authenticated manual-link path (§3.3 step 6).
- `GET|POST /auth/federation/:provider/callback` — **GET** for Google/GitHub/Microsoft/Facebook, **POST
  (form_post)** for Apple. Consume flow-state, verify state/nonce/PKCE, exchange code→token (arctic),
  fetch verified identity, run the linking algorithm (§3.3), `ensureWorkspaceForUser`, mint + rotate the
  Sentropic session (`session.ts:createSession`), then resume: sealed continuation present →
  `resumeLoginContinuation` (finishes downstream SSO exactly as after passkey login); else → fixed
  internal page (D11).

Route mounting mirrors the existing pattern (`api/src/routes/auth/index.ts` mounts
`register`/`login`/`magic-link` etc.): a new `federation.ts` router mounted at `/federation`, active only
when the host wires the `federation?` port.

**Discovery impact: NONE on the RP side.** `/.well-known/openid-configuration`
(`oauth/wellknown-handler.ts`) describes us *as an issuer to downstream apps*; being an RP to Google adds
nothing. We consume providers' discovery (or arctic's hardcoded endpoints); we publish no new metadata.

**Interplay invariant**: a social-enrolled user is, to the OAuth server, just a normal `users` row with
a live session; they use the Sentropic OAuth server for downstream SSO identically to a passkey user.
No change to token-handler, consent, JWKS, or userinfo.

---

## 7. Keystone test matrix (adversarial)

| ID | Assertion | Lot |
|---|---|---|
| **K-SUBJECT** | Callback resolves by `(provider, subject)` FIRST; a matching subject logs in that user even if the provider email now differs (D6/D13). | 1 |
| **K-AUTOLINK-SHELL** | Google verified-email collision with a **non-credentialed shell** → auto-links into it (D7/D8). | 1 |
| **K-NOMERGE-CRED** | Verified-email collision with an **already-credentialed** account → routes to manual-link; NO silent merge, NO new identity attached (D7/OD2). | 1/2 |
| **K-NOMERGE-UNVERIFIED** | Unverified/absent provider email NEVER auto-links to any existing user (D7/D9). | 1/2 |
| **K-STATE** | Callback with a mismatched/expired/replayed `state`, `nonce`, or PKCE verifier is rejected (D5/D10). | 1 |
| **K-SEALED** | The sealed OAuth `continue` (HMAC) is NEVER present in any parameter sent to the external provider; the flow-state cookie carries only the opaque pointer (D5/R1). | 1 |
| **K-NOLEAK** | No external access/id/refresh token appears in any Sentropic id_token, access token, userinfo response, or browser-visible payload (D1/§1.3). | 1 |
| **K-ROTATE** | The Sentropic session id after federation login differs from any pre-existing session id (anti-fixation, D10). | 1 |
| **K-FLOW** | Federation flow-state is single-use: a second `consumeFlowState` returns null (D5). | 0 |
| **K-UNIQUE** | A duplicate `(provider, subject)` insert is rejected; the concurrent-callback re-read logs the existing user in (D6/§3.3). | 0/1 |
| **K-GH-CHALLENGE** | GitHub with a private/absent/unverified email → email-verification challenge; no silent no-email user created (D9). | 2 |
| **K-MS-SUBJECT** | Microsoft subject = `oid`(+`tid`); a per-app `sub` collision across tenants does NOT merge users (D6). | 3 |
| **K-APPLE-FORMPOST** | Apple callback parses POST-body params; first-auth name/email captured; a GET-query-only parse would fail (D16). | 4 |
| **K-APPLE-SECRET** | A valid short-lived ES256 client-secret JWT is minted from the `.p8` at runtime (D15/D16). | 4 |
| **K-FB-CHALLENGE** | Facebook with absent email → email challenge; no silent no-email user (D9). | 5 |
| **K-UNLINK-LASTFACTOR** | Unlink is refused when it would remove the user's last sign-in factor (D12). | 6 |
| **K-UI-LEGACY** | With no `federationProviders` prop, `AuthLogin`/`AuthRegister` render unchanged; existing auth-ui tests stay green (D17). | 6 |

---

## 8. Open items still gated (not blocking v1 lot 0/1)

- **DS-owner coordination (Lot A + provider glyphs, D17/OD4)**: `AppChrome` brand-zone config and the
  provider-icon set are DS-owned; confirm the brand tokens and whether the glyphs enter the DS icon set
  or are inlined as licensed marks. Reversible; does not gate the backend lots.
- **Per-provider auto-link expansion beyond Google (D8)**: adding Microsoft/GitHub/Apple/Facebook to the
  auto-link allowlist requires per-provider proof rules (MS issuer/`tid`, GitHub extra verification,
  Apple relay policy) — a later owner decision; v1 keeps them manual-link only.
- **Provider console registration (owner/ops, D15)**: each provider needs the exact callback URL
  (`https://auth.sent-tech.ca/auth/federation/{provider}/callback`) registered; Apple needs the domain +
  return URL verified. Out-of-band owner task per provider before that provider's lot goes live.
- **Domain-based tenant auto-provisioning (D18)**: deferred to the Microsoft/enterprise lot; depends on
  verified-domain trust + membership-approval, out of v1 scope.
- **arctic version pin + SCA gate (D3)**: confirm the pinned version passes `security-sast-sca` before
  Lot 1 merges.
