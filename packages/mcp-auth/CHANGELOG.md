# Changelog

## 0.2.2

- Stop forwarding `requiredScopes` to the token verifier so a missing scope returns the documented `403 insufficient_scope` instead of `401 invalid_token`. Scope enforcement is now solely the local assertion in `src/core.ts`.
- Observable contract change (RFC 6750 §3.1): a valid token missing the operation scope now gets `403 insufficient_scope` where `0.2.1` returned `401 invalid_token`. Hosted clients must handle `403` as step-up/insufficient-scope, not as re-authorization; no reconnection is expected (unverified until i-cond UAT 2b).
- Ordering (fail-closed, no escalation): the missing-scope `403` precedes DPoP proof verification, so a DPoP-bound token presented without proof and without the required scope receives `403 insufficient_scope`, not `401`.

## 0.2.1

- Replace the local oauth-verify dependency reference with `^0.1.0` so npm consumers can resolve the published dependency outside the monorepo.
- Guard published dependency declarations against local file, workspace, link, and parent-directory references.
