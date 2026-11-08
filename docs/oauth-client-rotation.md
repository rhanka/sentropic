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
   (BR45-EX1) against the tier cluster. It creates the temporary
   `oauth-client-registration` Secret from the file, applies the versioned Job
   (`deploy/k8s/base/36-oauth-register-client-job.yaml`), waits for completion,
   prints the Job logs, then deletes the Job and the temporary Secret.
   Omitting `OAUTH_CLIENT_REQUIRED_ACR` / `OAUTH_CLIENT_ALLOWED_USER_IDS`
   preserves the stored policy (rotation never wipes it); providing them
   replaces it. The Job output prints the effective `required ACR` and
   `allowed user IDs` — verify them before cutting over.
3. IMMEDIATELY update the RP `.env` with the new secret and restart the RP.
   Between step 2 and this restart, the RP cannot authenticate (no grace period).
4. Verify: fresh RP login issues tokens; old secret returns `invalid_client`.
5. Record the new `*_OIDC_SECRET_MINTED_AT` date in both `.env` copies.

## Rollback

Re-run steps 1–5 with the previous secret value (kept in the 0600 recovery
copy until the new secret is verified). The upsert restores the old hash.

## Account approval (governed Job path, `cm-account-approve-job`)

Operator path to approve a `cm_identity` account or change its global role when
no admin_app browser session is available to call
`POST /api/v1/admin/identity/users/:id/approve`. The script
(`api/src/scripts/cm-account-approve.ts`) calls the same service as that route
(`changeCmAccountAsAdmin`, approve action): the `account.approved` audit event,
the custody profile approval fields and the subject revision are written exactly
as by the admin API. Run it only on a recorded owner authorization.

1. Prepare a 0600 env file with exactly these four lines (ids, no secret):
   `CM_ACCOUNT_APPROVE_ACTOR_ID` (an active admin_app account with a custody
   profile), `CM_ACCOUNT_APPROVE_USER_ID` (the target; must differ from the
   actor), `CM_ACCOUNT_APPROVE_ROLE` (`admin_app`, `admin_org`, `editor` or
   `guest`), `CM_ACCOUNT_APPROVE_REASON` (non-empty, at most 256 characters;
   cite the authorization record).
2. Run `make cm-account-approve-job SECRET_FILE=<0600 env file>
   CM_ACCOUNT_APPROVE_JOB_NAMESPACE=<ns> KUBECONFIG=<0600 kubeconfig> ENV=<env>`
   (BRCMA-EX1). The wrapper refuses any other key in the file, resolves the image
   from the namespace's `api` Deployment, creates the temporary
   `cm-account-approval` Secret, applies `deploy/k8s/base/38-cm-account-approve-job.yaml`
   annotated with `sentropic.io/approval-reason`, prints a receipt line (image,
   reason) and the Job log, then deletes the Job and the Secret, even on failure.
3. The Job prints one JSON line `{userId, roleBefore, roleAfter, status}` and
   exits non-zero on any refusal (self-approval, missing or invalid variable,
   unknown target, actor not an active admin_app, missing custody profile).
4. Keep the receipt line and the JSON line in the run report: the cluster-mesh
   `account.approved` audit event carries the actor and the subject but no
   reason field, so the reason is persisted only in that report.

Rollback: run the Job again with the previous role (`roleBefore`) and an actor
other than the target.
