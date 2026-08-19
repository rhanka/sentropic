# SPEC DECISION — Per-tier authentication pattern (all projects)

Status: **standard**, owner-directed 2026-08-18 ("on fera un pattern standard pour les autres").

The rule any project follows when it deploys a non-production tier behind the Sentropic IdP —
sentropic itself, radar-immobilier, openerp, geo, and whatever comes next. It exists because the
first two projects to need one did it differently, and neither difference was a decision.

---

## R1 — A tier authenticates against the IdP OF ITS OWN TIER

| tier | IdP |
|---|---|
| production | `auth.sent-tech.ca` |
| non-production | `preprod.auth.sent-tech.ca` |

This holds regardless of what the tier contains. A non-prod tier seeded with a production data copy
still authenticates against the non-prod IdP.

The tempting inversion — "this tier holds real PII, so it should use the real IdP for accountable
identities" — ties two independent things: *identity assurance* (a property of the accounts) and
*which instance issues the token* (a property of the IdP deployment). Real, accountable identities
can exist on a non-prod IdP; provisioning them there is cheap. Using the production IdP instead
hands **its entire population** a second, less-guarded surface, and couples the blast radius of the
two tiers in both directions.

Traceability is obtained by R2, not by borrowing the production issuer.

## R2 — Authentication is never authorization

A valid token proves *who*, never *what they may reach*. Every tier enforces an explicit access
decision at the relying party — an allowlist of subjects, a required claim, a group — **independent
of token validity**.

This is not optional on tiers holding production data, and it is the rule most easily skipped
because everything appears to work without it: the tier is reachable, login succeeds, and the gap is
invisible until someone who was never meant to have access simply logs in.

Two anti-patterns, both observed in this codebase:
- gating on token validity alone, so *any* principal the IdP can mint for gets full access;
- `isAdmin = user.email === "<literal>"` as the only differentiation — a placeholder, not a control.

**Registration is open by default.** `api/src/routes/auth/register.ts` treats an invite as optional
(an invalid invite "simply behaves like a normal registration"), there is no domain allowlist or
invite-only switch anywhere in `api/src`, and `api/src/routes/auth/oauth.ts:144-147` returns
`allowed: true` for a `pending_admin_approval` account — that status downgrades the *session role*
(`resolveSessionRole`, `:152`) but never blocks token issuance. So "the IdP only has a handful of
trusted accounts" describes who has registered, not what the system permits. **Never let a control
rest on that premise**; make it an enforced invariant instead.

## R3 — One OAuth client per (project, tier)

Each pair gets its own `oauth_clients` row, in the database of **that tier's IdP**:

| project | tier | client_id | registered in |
|---|---|---|---|
| radar-immobilier | prod | `radar-immobilier` | prod IdP DB |
| radar-immobilier | non-prod | `radar-immobilier-preprod` | **non-prod IdP DB** |
| `<project>` | non-prod | `<project>-preprod` | non-prod IdP DB |

Server-side relying parties (a Traefik forward-auth, an API acting as RP) are **confidential**
clients: `token_endpoint_auth_method = client_secret_basic` with a generated secret. Only clients
that genuinely cannot hold a secret — a browser SPA, a hosted third-party connector such as the
claude.ai MCP client — use `none` + PKCE.

The secret is generated **once, cluster-side**, written to the tier's own Secret and passed to the
registration in the same operation. It never transits a chat, a ticket or a message. The IdP stores
only its sha256; the plaintext is never persisted server-side.

### Registration

Preferred, once the deployed image carries it (PR #497):

```
OAUTH_CLIENT_ID=<project>-preprod \
OAUTH_CLIENT_NAME="<Project> (preprod)" \
OAUTH_CLIENT_REDIRECT_URIS=https://<host>/api/v1/auth/oauth/callback \
OAUTH_CLIENT_SCOPES=openid,profile,email \
OAUTH_CLIENT_TOKEN_AUTH=client_secret_basic \
OAUTH_CLIENT_SECRET=<generated cluster-side> \
npm run oauth:register-client:dist
```

Idempotent upsert on `client_id`; `tenant_id` defaults to `sentropic`. Check the image first —
`kubectl -n <ns> exec <api-pod> -- ls dist/scripts/`. Older images have neither the compiled script
nor `tsx` (pruned by `npm prune --omit=dev`), and need the SQL upsert instead.

Hashing the secret by hand: `printf '%s' "$SECRET" | sha256sum`, **never** `echo` — a trailing
newline yields a different hash, and the symptom is an `invalid_client` indistinguishable from a
wrong client id.

## R4 — Host-shaped values are declared, never derived

Every `*_BASE_URL`, `*_ORIGIN`, issuer and resource URI is pinned in `deploy/k8s/base/` with the
production value and overridden in the tier overlay. None is left to fall through to a
request-derived default.

Derived values look correct until the one request that arrives without the expected proxy header
(an internal probe, a direct ClusterIP call, a different ingress host). The resulting
`redirect_uri_mismatch` or `invalid_target` then points the investigation at the third party instead
of at the deployment. Where the derived value is also **memoised** — as `getMcpAuth` does in
`api/src/routes/api/mcp.ts` — a single early request freezes the wrong value for the pod's entire
lifetime, and the failure becomes intermittent across restarts.

OAuth redirect matching is **exact-string**, not URL normalisation. `…/callback`,
`…/callback/`, `…:443/callback` and a differing case are four different URIs. Compare by
copy-paste, never by reading.

---

## Recorded exceptions

- **radar-immobilier non-prod, R2** — the relying party gates on token validity alone, with no
  allowlist. The owner, principal on both the IdP and the data, accepted this explicitly
  (2026-08-18) after the exposure was stated. Recorded so it is a known exception rather than an
  oversight; it does not extend to any other project.
- **Third-party clients where we are the relying party** (Google OAuth for Drive/Gmail) are **shared
  across tiers**, with the non-prod redirect URIs added to the production client. Owner decision
  2026-08-18; separation cost is external (Console work, possible re-verification). The accepted
  consequence is that a non-prod compromise exposes the production client secret — a bearer
  credential at the token endpoint, where exact-match redirect URIs bound nothing. Any rotation
  requires a coordinated redeploy of both tiers.

## Recorded drift

`SPEC_DECISION_DEPLOYMENT_PLANE.md` (revision 2026-06-22, DV1) ratified `dev.*` naming —
`dev.sentropic.sent-tech.ca`, `dev.auth.sent-tech.ca` — superseding `preprod.*`. What is deployed is
`preprod.sentropic.sent-tech.ca` and `preprod.auth.sent-tech.ca`. This document describes what
exists. Reconciling the two is a separate decision; nothing here depends on which name wins.
