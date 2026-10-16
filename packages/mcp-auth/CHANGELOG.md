# Changelog

## 0.2.2

- Stop forwarding `requiredScopes` to the token verifier so a missing scope returns the documented `403 insufficient_scope` instead of `401 invalid_token`. Scope enforcement is now solely the local assertion in `src/core.ts`.

## 0.2.1

- Replace the local oauth-verify dependency reference with `^0.1.0` so npm consumers can resolve the published dependency outside the monorepo.
- Guard published dependency declarations against local file, workspace, link, and parent-directory references.
