# CI truthfulness test changes

Existing assertion inputs changed: the two translated warning strings listed below. No assertion removed or weakened; no timeout or skip changes.

| File / hunk | Change and evidence | Remaining coverage |
|---|---|---|
| `e2e/tests/02-auth-oauth-revoke.spec.ts`, `buildAuthorizeUrl` | Add `prompt=consent` to the request fixture. Run 35940218518 reached the callback directly on every attempt. `packages/auth-hono/src/oauth/authorize-handler.ts:114` intentionally bypasses consent for covering grants unless this prompt is supplied. | Consent screen, approval, callback/state/code, token exchange, scopes, userinfo success, revocation, and subsequent 401 assertions are unchanged. |
| `e2e/tests/05-i18n.spec.ts`, `ensureMatrixWarningBanner` / `warningText` | Replace stale English “use cases” and French “cas d'usage” strings with “initiatives”, matching both shipped `ui/src/locales/{en,fr}.json:175` translations. The obsolete text made the helper demand the mutually exclusive empty state despite its configured matrix fixture. | Both languages still require the complete exact warning text; matrix empty/dialog fallback, folder labels, and dashboard ROI assertions remain unchanged. |
