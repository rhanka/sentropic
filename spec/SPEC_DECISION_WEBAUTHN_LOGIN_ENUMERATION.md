# DECISION — WebAuthn `/auth/login/options` email-enumeration oracle

Status: **OPEN — owner decision required (A vs C; B optional).** Domain-owner: auth/IdP lane.
Prod-affecting. **Non-blocking** for the all-users preprod clone (the oracle is at prod↔preprod
parity — same users, same code, rate-limit-bounded on both sides — so the clone adds no new severity).

## Finding (CONFIRMED against `origin/main`)

`POST /api/v1/auth/login/options` is an **email-enumeration oracle**. It always returns HTTP 200 with
a valid challenge, but the body differs by whether the supplied email is a real user with a passkey:

- **known email + passkey** → `options.allowCredentials` **populated** (and exposes that user's
  `credentialId`s);
- **unknown email, or user without a passkey** → `allowCredentials` **absent**.

Code path:
- `api/src/routes/auth/login.ts:122-133` — `resolveAuthenticationOptions({email})` looks the email up
  and returns `{ userId: user?.id }` (`undefined` when not found).
- `api/src/services/webauthn-authentication.ts:54,92` — `allowCredentials` is built only when a
  `userId` is present; the response is `allowCredentials.length > 0 ? allowCredentials : undefined`.
- `packages/auth-hono/src/webauthn-authentication-route-handlers.ts:88-90` returns the options verbatim.

An attacker can test a list of emails and confirm which are real users. Present on **prod and preprod**
(same code). Severity: **email/credential-id harvesting, rate-limit-bounded** — not a dump, not an
auth bypass. The already-deployed auth rate limiters + the #456 trusted-proxy config (infra lane) bound
the harvest rate on both tiers.

## Why this is a decision, not a one-line patch

The naive fix ("stop returning `allowCredentials`") is **not safe**:

1. Registration uses `residentKey: 'preferred'` (`api/src/services/webauthn-registration.ts:108`), NOT
   `'required'`. So credentials are **not guaranteed discoverable** — a user with a non-resident
   (roaming security key) credential **needs** `allowCredentials` to be found. Blindly removing it
   would break their login.
2. The email→`allowCredentials` path is an **intentional feature**: OIDC `login_hint` pre-scopes the
   passkey challenge to the known user (`apps/auth-idp/web/src/routes/auth/login/+page.svelte:13-15`;
   default flow is usernameless, so the oracle is exposed **only when an email is supplied** —
   legitimately via `login_hint`, or by an attacker POSTing directly).

## Options

| | What | Closes oracle | Cost / risk |
|---|---|---|---|
| **A (target)** | `residentKey: 'required'` + login purely usernameless (drop the email→allowCredentials path) | **Yes, cleanly** | New creds all discoverable; the rare existing non-resident creds must re-enrol. Standard passkey-first posture. |
| **B** | Keep pre-scoping but only honor the email when it arrives via a **signed/bound** authorize continuation, not a bare POST | Yes, keeps UX | More work: `login_hint` is currently a plain, replayable param → must be signed. |
| **C (interim)** | Accept + document; rely on the deployed rate-limit + #456 trusted-proxy config to bound the harvest | No (bounded, not closed) | Least effort; oracle persists at a slow rate on both tiers. Acceptable immediate posture. |

## Recommendation

- **Interim: C** — already effectively in place (rate-limit deployed; #456 config is infra's follow-up).
  Bounds the harvest now, adds nothing to the clone's risk.
- **Target: A** — the clean, standard close. Adopt for new credentials; re-enrol the rare non-resident
  holders. Pursue as a reviewed change (touches registration policy + login, prod-affecting).
- **B** only if the `login_hint` pre-scoping UX is judged worth the extra binding work.

## Decision requested from owner

1. Interim posture = **C** (accept + rely on rate-limit)? (recommended)
2. Target = **A** (`residentKey:'required'` + usernameless), or is **B** preferred to keep login_hint
   pre-scoping?
3. Prod rollout of the target: prod-affecting → standard owner-gated release once the target is chosen.

## Provenance

Audited 2026-08-22 by the auth/IdP lane; verified against `origin/main`. Surfaced by the all-users
preprod clone risk review (i-infra flagged the harvest vector; i-cond routes the record). Rate-limit +
`resolveClientIp` anti-spoof are already merged (`api/src/middleware/auth-rate-limiters.ts`,
`api/src/utils/client-ip.ts`); the trusted-proxy ConfigMap values are the #456 infra follow-up.
