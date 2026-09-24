# CI truthfulness test changes

No existing test assertions have been changed.

| File / hunk | Change and evidence | Remaining coverage |
|---|---|---|
| `e2e/tests/02-auth-oauth-revoke.spec.ts`, `buildAuthorizeUrl` | Add `prompt=consent` to the request fixture. Run 35940218518 reached the callback directly on every attempt. `packages/auth-hono/src/oauth/authorize-handler.ts:114` intentionally bypasses consent for covering grants unless this prompt is supplied. | Consent screen, approval, callback/state/code, token exchange, scopes, userinfo success, revocation, and subsequent 401 assertions are unchanged. |
