# SPEC STUDY — IdP OIDC RP evolutions for third-party apps (BR-63, immo-driven)

## State

- Document type: **ARCHITECT study** (analysis + verdict + conditions). NOT an implementation plan.
- Implementation scope: **39etc** (auth lane). This study does not authorize or schedule code.
- Priority: **owner's call**. NOT asserted urgent relative to WP16 (`#353`). The owner decides if/when 39etc picks this up.
- Driver: the **immo** lane (BR-63) requested two IdP-side OIDC capabilities that today force degraded UX when a third-party RP (immo) integrates with the standalone IdP (`auth.sent-tech.ca`).

## Context

The standalone IdP exposes a published OIDC discovery contract (ARCH-12 / D11 surface) consumed by external Relying Parties (RPs): the h2a-gateway client, the design-system client, and immo. Two RP-side flows are currently blocked or degraded because the IdP `authorize` endpoint and the discovery document do not yet expose standard OIDC affordances. This study documents the contract analysis for both evolutions, records the architect verdict (all additive-compatible), and fixes the conditions that 39etc must honor at implementation time.

Files analyzed (read from this worktree, off `origin/main`):
- `packages/auth-hono/src/oauth/authorize-handler.ts`
- `packages/auth-hono/src/oauth/wellknown-handler.ts`
- `packages/auth-ui/src/components/AuthRegister.svelte`
- host: `ui/src/routes/auth/register/+page.svelte` (and `apps/auth-idp/web/src/routes/auth/register/+page.svelte`)

---

## EVOLUTION 1 — Account switch + RP-initiated logout

### Problem

- `authorize-handler.ts` (prompt handling, lines 42-75) recognizes only `prompt=login`, `prompt=none`, and `prompt=consent`. It does **not** handle `prompt=select_account`. An RP that wants the user to switch accounts has no standard lever.
- There is **no `end_session_endpoint`**. Logout today is `DELETE /api/v1/auth/session` — a same-origin API call, **not navigable** from a third-party RP like immo (a browser cannot drive a cross-origin `DELETE` to clear the IdP session, and there is no front-channel logout URL to redirect the user to).
- The discovery document (`wellknown-handler.ts`, `/openid-configuration`) advertises neither `end_session_endpoint` nor `prompt_values_supported`, so RPs cannot even discover the capability.

### Requirement

Support **`prompt=select_account`** AND/OR a navigable **`end_session_endpoint`** (OIDC RP-Initiated Logout, with `post_logout_redirect_uri`). Publish `prompt_values_supported` and `end_session_endpoint` in discovery (`wellknown-handler.ts`).

---

## EVOLUTION 2 — Invitation → direct device-enrollment

### Problem

- An invitation → enrollment deep-link currently falls back to the generic login screen: the `authorize` flow reads neither `login_hint` nor any invitation token (`authorize-handler.ts`, request-validation path, lines ~143-185). The invited user's email and invitation context are lost on the way to the IdP.
- The host registration route `register/+page.svelte` does **not** wire the `presetEmail` / `presetVerificationToken` props. Note: `AuthRegister.svelte` (lines 31-32, 43-46) **already exposes** `presetEmail`, `presetVerificationToken`, and `skipEmailVerification` props — so the component-side affordance exists; the gap is the host page not passing them through from the deep-link parameters.

### Requirement

Honor **`login_hint`** (standard OIDC parameter) and an invitation token (**custom**) on `authorize`, and wire the `preset*` props in the host registration page so an invited user lands directly in device (passkey) enrollment with email/verification pre-filled.

---

## ARCHITECT VERDICT (recorded verbatim)

All **5 additions are ADDITIVE-COMPATIBLE** to the **PUBLISHED OIDC discovery contract** (ARCH-12 / D11 surface) — **zero breaking** for existing RPs (h2a-gateway, design-system, immo). **NO major bump.**

1. **`end_session_endpoint`** — additive (new discovery field + new endpoint).
2. **`prompt_values_supported`** — additive discovery field.
3. **`prompt=select_account`** — additive (a standard OIDC `prompt` value, currently unhandled).
4. **`login_hint`** — additive (standard OIDC parameter, currently ignored).
5. **`invite_token`** — additive, but **MUST be namespaced** with a vendor prefix (e.g. `sentropic_invite_token`) to avoid collision with a future standard parameter.

---

## ARCHITECT CONDITIONS (mandatory for 39etc implementation)

- **C1** — `end_session_endpoint` MUST validate `post_logout_redirect_uri` against the client's **REGISTERED** redirect URIs. An open post-logout redirect is a phishing vector. **Non-negotiable.**
- **C2** — `prompt=select_account` MUST actually **force the account-chooser / re-auth** (it must NOT silently reuse the existing session), and it MUST compose correctly with the existing session-resolution logic.
- **C3** — the invitation token MUST be **single-use + TTL**, and MUST leak **no account-enumeration signal** in the preset flow (a non-existent or already-consumed token must not be distinguishable from a valid one to an attacker). Use the **namespaced** name from verdict point (5).
- **C4** — the discovery document is the **PUBLISHED ARCH-12 / D11 surface** → ship under an **additive version bump**. If a discovery-contract snapshot / golden test exists, **edit it in the SAME PR** (visible, reviewable). This work is **orthogonal to the tenant / membership claim-set work (BR-39n / 39e)** — do **not** mix the two.

---

## Coordination note

The **radar** lane already completed its **RP-side half** (PR `#293`: `select_account` → `login` mapping on the RP, plus an `/enroll` route follow-up). The **IdP-side** implementation of both evolutions is **39etc**.

## Feedback-Loop note (attention)

- Implementation owner: **39etc** auth lane (not this lane; this is doc-only).
- Priority: **owner's call** — sequencing against WP16 (`#353`) and other lanes is not decided here.
