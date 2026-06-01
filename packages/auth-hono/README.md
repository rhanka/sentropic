# @sentropic/auth-hono

Reusable Hono authentication route factories, contracts, and server-side auth helpers for Sentropic-compatible apps.

## Boundary

`@sentropic/auth-hono` owns backend auth route composition and reusable ceremony logic for:

- email code verification;
- magic-link verification;
- passkey registration;
- passkey authentication;
- session refresh/logout;
- credential list/rename/revoke;
- Hono auth middleware factories.

Application-owned adapters provide storage, email delivery, audit logging, cookies, token secrets, and workspace/account policy.

## Auth UI Alignment

The package route contract is aligned with the `@sentropic/auth-ui` `AuthUiTransport` shape from BR-39a. Backend implementations must preserve those request/result boundaries while allowing host apps to mount routes under their own prefix, such as Sentropic `/auth/*` or `spa-transpose-cv` `/admin/auth/*`.

## Quick start (per-route mounting)

Each route handler is independent; the host app composes only the ones it wants.

```ts
import {
  createAuthEmailRouteHandlers,
  createAuthWebAuthnRegistrationRouteHandlers,
  createAuthWebAuthnAuthenticationRouteHandlers,
} from '@sentropic/auth-hono';
import { Hono } from 'hono';

const router = new Hono();

const emailHandlers = createAuthEmailRouteHandlers({ service: hostEmailService });
router.post('/email/verify-request', emailHandlers.requestEmailCode!);
router.post('/email/verify-code', emailHandlers.verifyEmailCode!);

const registerHandlers = createAuthWebAuthnRegistrationRouteHandlers({
  prepareRegistrationOptions: hostPrepare,
  resolveRegistrationUser: hostResolveUser,
  service: hostRegistrationService,
  // Optional: own the success response (session creation, cookie, rich body)
  finalizeRegistration: hostFinalizeRegistration,
});
router.post('/register/options', registerHandlers.createPasskeyRegistrationOptions!);
router.post('/register/verify', registerHandlers.verifyPasskeyRegistration!);
```

## Hooks (since 0.2.x)

WebAuthn route handlers expose two host-owned extension points so the package can stay storage- and policy-agnostic while still letting hosts express their flow:

- **Error short-circuit** — `prepareRegistrationOptions` / `resolveRegistrationUser` / `resolveAuthenticationOptions` may return either their normal success value **or** an `AuthHonoRouteHandlerError` (`{ error: { status, code, message } }`). The handler maps it directly to the HTTP response, so the host can refuse early (e.g. unverified email → 403) without throwing.
- **Finalize hook** — `finalizeRegistration` / `finalizeAuthentication` are optional callbacks invoked after a successful credential verification with `{ credentialId, userId, request }` and the Hono `Context`. They return the final `Response`, giving the host full control over session creation, cookies, and the response body. Without a hook the package returns the default structured `{ credentialId, success, userId }` body.

## Response contract (structured)

All package handlers emit structured responses to keep contracts predictable across hosts:

- success bodies carry domain-specific fields (e.g. `{ delivery: 'email', expiresAt, success: true }`, `{ success: true, verificationToken }`, `{ sessionToken, refreshToken, expiresAt, success: true }` when the host's `finalize` builds the session response);
- error bodies are always `{ error: { code, message } }` plus an HTTP status. Hosts that need a host-specific shape (legacy flat errors, additional metadata) can wrap a handler or use the prepare/finalize hooks to project a different payload.

## Mounting recipes

- **Sentropic-style app** with a Drizzle/Postgres backend, WebAuthn-only login, and workspace-scoped sessions: implement `AuthHonoCredentialPort`, an `AuthHonoSessionService` adapter (or the package's `createAuthSessionService` when the full `AuthHonoPorts` bundle is wired), an `AuthHonoWebAuthnRegistrationService`/`AuthHonoWebAuthnAuthenticationService` adapter, and provide `prepareRegistrationOptions`/`resolveRegistrationUser` for first-admin + account-status policy and `finalizeRegistration`/`finalizeAuthentication` for session creation and cookie issuance. Sentropic's `api/src/services/auth/*-adapter.ts` modules show this end-to-end.
- **DB-less admin flow** (e.g. `spa-transpose-cv` mounting at `/admin/auth/*`): use a file- or memory-backed implementation of `AuthHonoCredentialPort` and the relevant ports, skip workspace bootstrap entirely, and either rely on the default verify response or supply a minimal `finalizeAuthentication` that issues a host-managed session cookie. The package never touches workspace state, so no DB schema is required.

## First Publish

This is a brand-new public package. First publish requires the one-shot bootstrap flow from `rules/workflow.md`: trigger `ci.yml` with `bootstrap_publish_target=auth-hono`, handle any npm token or 2FA requirement with the npm owner, then attach the npm OIDC trusted publisher for `rhanka/sentropic` workflow `ci.yml`. Steady-state publishes should use trusted publishing and skip if the version already exists.

## Versioning

This branch ships `0.2.1`:

- `0.2.0` adds `AuthHonoRouteHandlerError` short-circuit on WebAuthn prepare/resolve hooks and the `finalizeRegistration`/`finalizeAuthentication` post-verify hooks. Additive; existing handler signatures stay valid.
- `0.2.1` patches `extractChallenge` (both WebAuthn handlers) to handle `credential.response === null` defensively (returns 400 `invalid_credential` instead of throwing 500).
