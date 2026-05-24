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

## First Publish

This is a brand-new public package. First publish requires the one-shot bootstrap flow from `rules/workflow.md`: trigger `ci.yml` with `bootstrap_publish_target=auth-hono`, handle any npm token or 2FA requirement with the npm owner, then attach the npm OIDC trusted publisher for `rhanka/sentropic` workflow `ci.yml`. Steady-state publishes should use trusted publishing and skip if the version already exists.
