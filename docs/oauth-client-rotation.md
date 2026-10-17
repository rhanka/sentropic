# OAuth client secret rotation runbook (`oauth_clients`)

## Scope

Confidential OIDC clients in `oauth_clients` (e.g. `kvm-gateway`, `netbird`).
`service_clients` rotate via `oauth-rotate-service-client` instead — this runbook
does not cover them. Preprod clients rotate independently with distinct secrets.

## Cycle

- Every 90 days, or immediately on exposure.
- Rotation is an upsert with a new secret: the `client_secret_hash` is replaced
  with NO grace period. Cut over the RP in the same operation (see order below).

## Mint (names only — values never enter git, chat, tickets or messages)

Mint 32 random bytes, base64url, on the operator machine:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Constraints (the IdP Basic decoder does no URL-decoding): no `=`, `:` or `%`.
Reject any `dev-only` value — the registration script refuses it.

Write the value into the RP recovery locations by variable name:

| Client | Issuer | Client id | Client secret | Minted-at |
|---|---|---|---|---|
| `kvm-gateway` | `KVM_GATEWAY_OIDC_ISSUER` | `KVM_GATEWAY_OIDC_CLIENT_ID` | `KVM_GATEWAY_OIDC_CLIENT_SECRET` | `KVM_GATEWAY_OIDC_SECRET_MINTED_AT` |
| `netbird` | `NETBIRD_OIDC_ISSUER` | `NETBIRD_OIDC_CLIENT_ID` | `NETBIRD_OIDC_CLIENT_SECRET` | `NETBIRD_OIDC_SECRET_MINTED_AT` |
| oauth2-proxy cookie (local to the RP, not the IdP) | — | — | `KVM_GATEWAY_COOKIE_SECRET` | — |

Recovery copy: same variable names in the sentropic `.env` (0600), per the four
locations convention. The IdP stores only the sha256 (`printf '%s'`, never `echo`).

## Rotate (governed Job path)

1. Prepare a 0600 env file with ONLY the `OAUTH_CLIENT_*` variables for this
   client (`OAUTH_CLIENT_ID`, `OAUTH_CLIENT_NAME`, `OAUTH_CLIENT_REDIRECT_URIS`,
   `OAUTH_CLIENT_SCOPES`, `OAUTH_CLIENT_TOKEN_AUTH=client_secret_basic`,
   `OAUTH_CLIENT_SECRET`, plus `OAUTH_CLIENT_REQUIRED_ACR` /
   `OAUTH_CLIENT_ALLOWED_USER_IDS` when the client carries a policy).
2. Run `make oauth-register-client-job SECRET_FILE=<0600 env file> ENV=<env>`
   (BRMFA-EX1) against the tier cluster. It creates the temporary
   `oauth-client-registration` Secret from the file, applies the versioned Job
   (`deploy/k8s/base/36-oauth-register-client-job.yaml`), waits for completion,
   prints the Job logs, then deletes the Job and the temporary Secret.
3. IMMEDIATELY update the RP `.env` with the new secret and restart the RP.
   Between step 2 and this restart, the RP cannot authenticate (no grace period).
4. Verify: fresh RP login issues tokens; old secret returns `invalid_client`.
5. Record the new `*_OIDC_SECRET_MINTED_AT` date in both `.env` copies.

## Rollback

Re-run steps 1–5 with the previous secret value (kept in the 0600 recovery
copy until the new secret is verified). The upsert restores the old hash.
