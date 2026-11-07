# Secrets Runbook

Operational reference for all environment secrets used by the Sentropic API.

## Secret inventory

| Env var | Purpose | Rotation policy | Source | Required environments |
| --- | --- | --- | --- | --- |
| `OAUTH_SIGNING_KEK` | Passphrase for `pgcrypto.pgp_sym_encrypt` that encrypts Ed25519 private keys stored in `id_token_signing_keys`. Without this, OAuth token signing fails on startup in production. | Every 90 days. KEK rotation requires re-encrypting stored private key bytes (see procedure below). | GitHub Actions environment secret + Kubernetes SealedSecret (`05-sealed-sentropic-api.yaml`). | prod, staging, all branch envs that exercise OAuth E2E (`e2e-feat-*`). Dev/test may fall back to `JWT_SECRET` — TEMPORARY; remove this fallback at next major release. |
| `OAUTH_ACCESS_TOKEN_TTL_SEC` | Override access token lifetime (seconds). | N/A (tuning knob, not a secret). | ConfigMap or `.env`. | Optional. Default: `3600`. |
| `OAUTH_ID_TOKEN_TTL_SEC` | Override ID token lifetime (seconds). | N/A. | ConfigMap or `.env`. | Optional. Default: `3600`. |
| `OAUTH_AUTHORIZATION_CODE_TTL_SEC` | Override authorization code TTL (seconds). RFC 6749 allows up to 10 min; 60s is intentionally tighter. | N/A. | ConfigMap or `.env`. | Optional. Default: `60`. |
| `OAUTH_DPOP_IAT_SKEW_SEC` | Allowed clock skew for DPoP proof `iat` claim (seconds). | N/A. | ConfigMap or `.env`. | Optional. Default: `60`. |
| `OAUTH_ISSUER_URL` | Override issuer claim (e.g. `https://api.sentropic.io`). Defaults to the API origin derived from `AUTH_CALLBACK_BASE_URL`. | N/A. | ConfigMap or `.env`. | Optional. |
| `PUBLIC_BASE_URL` | Public API base URL used for OAuth discovery and callback construction. | N/A. | ConfigMap or `.env`. | Required when `AUTH_CALLBACK_BASE_URL` is not set. |
| `OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC` | Lifetime (seconds) of stateless service access tokens issued by the `client_credentials` grant. Short TTL is the primary security control (service tokens are NOT revocable in 39d — see below). | N/A (tuning knob). | ConfigMap or `.env`. | Optional. Default: `900`. |
| `OAUTH_SERVICE_RESOURCE_URI` | Resource indicator (RFC 8707 `aud`) this API accepts on S2S tokens and advertises to clients. Defaults to the resolved issuer origin. | N/A. | ConfigMap or `.env`. | Optional. |
| `OAUTH_SELF_SERVICE_CLIENT_ID` | Client id of the self-S2S dogfood client used by `GET /api/v1/auth/s2s/self-check`. | Together with its secret. | ConfigMap (id is not sensitive). | Optional (dev/test/e2e). Seeded as `sentropic-self-s2s`. |
| `OAUTH_SELF_SERVICE_CLIENT_SECRET` | Secret for the self-S2S dogfood client. Dev/test seed value is well-known; set a real value for any reachable env or leave unset to disable `self-check`. | Rotate via `make oauth-rotate-service-client`. | GitHub Actions environment secret + Kubernetes SealedSecret. | Optional. Required only to enable the `self-check` activation probe. |
| `PROD_EMAIL_CODE_HMAC_KEY_ACTIVE` | Active (issuing) key of the email-code HMAC ring, prod tier (Q-K=A). Stored as 64 lowercase hex; the HMAC key is the 32 hex-decoded bytes. Protects emailed verification codes against offline guessing from a database copy. | 90-day three-phase cycle (reader install → promote → proof-gated retire), see `docs/runbooks/email-code-hmac-cred-cycle.md` §4. | Central `.env` → GitHub environment secret `EMAIL_CODE_HMAC_KEY_ACTIVE` (`sentropic-idp-prod`) → workflow-applied k8s Secret `email-code-hmac` in `sentropic`. | prod wherever the A4 email-code composition runs. |
| `PROD_EMAIL_CODE_HMAC_KEY_PREVIOUS` | Single non-issuing ring member, prod tier. Present together with `PROD_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF` or absent together; never empty. | Same 90-day cycle; removed only after the §4.4 zero-count proof. | Same chain as ACTIVE (`EMAIL_CODE_HMAC_KEY_PREVIOUS` in `sentropic-idp-prod`). | prod. |
| `PREPROD_EMAIL_CODE_HMAC_KEY_ACTIVE` | Active (issuing) key of the email-code HMAC ring, preprod tier. Distinct value from prod, generated separately. | 90-day three-phase cycle, preprod rotates and verifies first. | Central `.env` → GitHub environment secret `EMAIL_CODE_HMAC_KEY_ACTIVE` (`sentropic-idp-run`) → workflow-applied k8s Secret `email-code-hmac` in `sentropic-preprod`. | preprod. |
| `PREPROD_EMAIL_CODE_HMAC_KEY_PREVIOUS` | Single non-issuing ring member, preprod tier. | Same cycle as prod PREVIOUS. | Same chain as ACTIVE (`EMAIL_CODE_HMAC_KEY_PREVIOUS` in `sentropic-idp-run`). | preprod. |

The matching `*_EMAIL_CODE_HMAC_KEY_ACTIVE_REF` / `*_EMAIL_CODE_HMAC_KEY_PREVIOUS_REF` variables are non-secret metadata (`email-code-hmac:v1:<tier>:<fp16>`); they travel as GitHub environment **variables** and inside the same k8s Secret so one apply moves value and ref together. Test/e2e compositions generate throwaway keys with the same `make email-code-hmac-*` targets against `.env.$(ENV)` (tier segment `test`).

## OAUTH_SIGNING_KEK — detailed procedure

### Generation

```bash
openssl rand -base64 32
```

Store the output as a GitHub Actions environment secret and in the Kubernetes SealedSecret for each environment.

### First-time key bootstrap (after migration)

After running `make db-migrate`, create the first active Ed25519 signing key:

```bash
make exec-api CMD="npm run oauth:init-keys" API_PORT=<port> UI_PORT=<ui-port> MAILDEV_UI_PORT=<mail-port> ENV=<env>
```

The script is idempotent: it exits without error if an active key already exists.

### Signing key rotation (monthly recommended, matches access_token TTL)

Rotate the active Ed25519 signing key without disrupting in-flight tokens:

```bash
make oauth-rotate-keys API_PORT=<port> UI_PORT=<ui-port> MAILDEV_UI_PORT=<mail-port> ENV=<env>
```

This calls `JwksService.rotateKey()` which:

1. Generates a new Ed25519 keypair encrypted with the current `OAUTH_SIGNING_KEK`.
2. Sets it as `active=true` in `id_token_signing_keys`.
3. Sets the previous active key to `active=false`.
4. Leaves all rotated keys in the JWKS response for `≥ access_token TTL + JWKS cache TTL` (≥ 65 minutes), so tokens signed with the old key remain verifiable by RPs.

See `packages/auth-hono/README.md` §Key rotation policy for the full policy.

### KEK rotation (every 90 days)

When rotating `OAUTH_SIGNING_KEK` itself:

1. Generate a new KEK: `openssl rand -base64 32`.
2. For each row in `id_token_signing_keys`, re-encrypt the `private_key_encrypted` column:
   ```sql
   -- In a transaction; requires both old and new KEK available
   UPDATE id_token_signing_keys
   SET private_key_encrypted = pgp_sym_encrypt(
     pgp_sym_decrypt(private_key_encrypted, '<OLD_KEK>'),
     '<NEW_KEK>'
   );
   ```
3. Update the secret in GitHub Actions environment and in the Kubernetes SealedSecret.
4. Roll the API pod to pick up the new KEK.

## Kubernetes secret location

OAuth secrets are merged into the existing `sentropic-api` SealedSecret managed in `deploy/k8s/05-sealed-sentropic-api.yaml`. Add `OAUTH_SIGNING_KEK` alongside `JWT_SECRET`, `DATABASE_URL`, and `AUTH_CALLBACK_BASE_URL` when sealing.

Example (using `kubeseal`):

```bash
kubectl create secret generic sentropic-api \
  --from-literal=OAUTH_SIGNING_KEK="<value>" \
  --dry-run=client -o yaml \
  | kubeseal --format yaml >> deploy/k8s/05-sealed-sentropic-api.yaml
```

## GitHub Actions environment secrets

Add `OAUTH_SIGNING_KEK` to the `production` and `staging` environments in the repository settings under **Settings → Environments**. The CI workflow (`ci.yml`) passes environment secrets to the API container at deploy time.

## Dev / test fallback

In `ENV=dev` and `ENV=test-*` environments, `OAUTH_SIGNING_KEK` is optional. The JWKS adapter falls back to `JWT_SECRET` as the KEK. This fallback is intentional for local development but **must not be relied on in any externally reachable environment**.

To enforce production-like behaviour locally:

```bash
echo 'OAUTH_SIGNING_KEK=<your-local-kek>' >> .env
```

## Email-code HMAC key (Q-K=A)

Emailed verification codes are protected with `HMAC-SHA256(keyRef, canonical preimage)` under a key held apart from the database (owner decision Q-K=A, 2026-11-02; binding method `qk-secret-custody-r2`, validated through k8s). A database copy alone can no longer be used to guess live codes offline.

- **Names** (per tier `prod`/`preprod`): central `.env` `PROD_EMAIL_CODE_HMAC_KEY_{ACTIVE,PREVIOUS}` + `_REF` variants (and `PREPROD_…`); GitHub environment secret `EMAIL_CODE_HMAC_KEY_ACTIVE`/`_PREVIOUS` plus ref **variables** in `sentropic-idp-prod` / `sentropic-idp-run`; k8s Secret `email-code-hmac` (Opaque) in `sentropic` / `sentropic-preprod` with the same four keys; pod env on Deployment `api`. The full table is in the runbook `docs/runbooks/email-code-hmac-cred-cycle.md`.
- **Generation**: only via `make email-code-hmac-generate ENV=<preprod|prod>` — CSPRNG `randomBytes(32)`, written to `.env` through a private exclusive 0600 descriptor (atomic rename), never printed, never in argv; the GitHub deposit pipes the value to `gh secret set` on stdin. The terminal-printed `openssl rand` style used above for `OAUTH_SIGNING_KEK` is **not** used for this key.
- **Rotation and restore checks**: 90-day three-phase cycle; verification without exposure uses the keyed fingerprint `HMAC-SHA256(keyBytes, "sentropic/email-code-hmac/fingerprint/v1")` and the HMAC test vector over the synthetic input `["cm-email-code","1","custody-test@example.invalid","000000"]` — never a bare hash of the key (`make email-code-hmac-fingerprint`, `make email-code-hmac-verify-vector`).
- **Fail closed**: missing/invalid key at pod start, in the workflow, or at issuance refuses — no empty, default, derived or SHA-only issuance fallback. The dev/test `JWT_SECRET` fallback above does **not** extend to this key.
- **Non-goals**: not a SealedSecret, never added to the `sentropic-api` bundle, not in git, not in any database (rows carry `digest_key_ref` only), not derived from `JWT_SECRET`/`SECRET_ENCRYPTION_KEY`/the connector constant.
- **Related platform credential** (separate custody, no HMAC material): writer service account `sentropic-ci-email-code-hmac` per tier; `.env` names `K8S_EMAIL_CODE_HMAC_WRITER_PREPROD_KUBECONFIG_B64` / `K8S_EMAIL_CODE_HMAC_WRITER_PROD_KUBECONFIG_B64`; GitHub environment secret `KUBE_CONFIG_DATA_EMAIL_CODE_HMAC` in both environments. Mint/renewal dates are recorded by k8s in `preprod-cred-governance.md#email-code-hmac-writer` (poc-k8s repo); renew the kubeconfig before its token expiry 2027-02-01T00:12:16Z.

## Service-to-service (S2S) auth — `client_credentials` (BR-39d)

Backend services obtain scoped, audience-bound access tokens from the IdP using
the OAuth2 `client_credentials` grant. Clients live in the `service_clients`
table (created by migration `0029_service_clients.sql`), separate from the
human-facing `oauth_clients` table.

### Provisioning a service client

A service client has: `client_id`, `client_secret_hash` (sha256 of the secret),
`allowed_scopes`, `resource_indicators` (RFC 8707 audiences), and an opt-in
`dpop_bound_access_tokens` flag. Sample rows for dev/test/e2e are seeded by:

```bash
make exec-api CMD="npm run oauth:seed-clients" ENV=<env>
```

This seeds `example-service-rp` and the self-S2S dogfood client
(`sentropic-self-s2s`). The dev/test/e2e secrets are well-known and MUST NOT be
used in preprod or production.

### Governed provisioning (preprod and production)

Preprod and production service clients are provisioned only through the one-off
Job `deploy/k8s/base/37-oauth-register-service-client-job.yaml`, run by
`make oauth-register-service-client-job` (script
`api/src/scripts/oauth-register-service-client.ts`). Never use a manual SQL edit.
In one serializable write the Job upserts the `service_clients` row (sha256 secret
hash, no exchange policy, so `client_credentials` is granted) and binds the client
to its CM tenant. The Job image is the namespace's running `api` image. The wrapper
deletes the Job and its temporary Secret on exit, even after a failure.

1. Write a 0600 env file outside git that holds only `OAUTH_SERVICE_CLIENT_*` lines
   (the wrapper refuses any other key and any other file mode). The secret is
   generated straight into the file and is never printed:

   ```bash
   umask 077; f="$(mktemp)"
   printf 'OAUTH_SERVICE_CLIENT_ID=%s\nOAUTH_SERVICE_CLIENT_SCOPES=%s\nOAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS=%s\nOAUTH_SERVICE_CLIENT_SECRET=%s\n' \
     "<client-id>" "<scope>,<scope>" "<https resource>" "$(openssl rand -hex 32)" > "$f"
   ```

   - Scopes must belong to `KNOWN_SERVICE_CLIENT_SCOPES`
     (`api/src/services/auth/service-client-provisioning.ts`): `service:ping`,
     `remote.evidence.issue`, `remote.sessions.revoke`, `github-app:broker`,
     `artifacts:builder`.
   - Without `OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS`, the resource defaults to
     `OAUTH_SERVICE_RESOURCE_URI`, else `AUTH_CALLBACK_BASE_URL`, both read from
     the `api` ConfigMap.
   - Optional keys: `_NAME`, `_TENANT` (CM slug, default `sentropic`), `_DPOP`.
2. Copy the secret value from that file into the consumer's own secret store, and
   into the ignored 0600 central `.env` under a documented name. Never commit or
   print it.
3. Run the Job:
   `make oauth-register-service-client-job SECRET_FILE="$f" OAUTH_SERVICE_CLIENT_JOB_NAMESPACE=<ns> KUBECONFIG=<0600 tier kubeconfig> ENV=<env>`.
   The log reports `created`, `updated (...)` or `unchanged (replay no-op)`, the
   scopes, resources and tenant, and `rotation due by`. It never contains the
   secret or its hash.
4. Verify reprise: mint a token with the consumer's credential (as shown below)
   and check the HTTP status only, for example with `-o /dev/null -w '%{http_code}'`.
   Then record the client id, the tier, the secret location by name, the creation
   date and the due date in the tenant credential register, and delete `$f`.

Replays are idempotent. These cases are refused and roll the whole write back:
a revoked row (restoring access needs a separate owner authorization), a row with
an exchange policy, the reserved `immo-mcp-workload` id (the named-Secret identity
sync owns both, see `deploy/ci/idp-identity-sync/CRED_CYCLE.md`), an id that
already names an `oauth_clients` row, and a tenant rebind. Granting more authority
(an added scope or resource, or a dropped DPoP requirement) also needs
`OAUTH_SERVICE_CLIENT_ALLOW_WIDEN=true`. Granting less (a removed scope or
resource, or an added DPoP requirement) needs
`OAUTH_SERVICE_CLIENT_ALLOW_DOWNGRADE=true`.

**Rotation cycle: 90 days**, or at once on suspected exposure. The cycle runs from
`secret_rotated_at`, else from `created_at`. Generate a new secret into the same
file, add `OAUTH_SERVICE_CLIENT_ROTATE_SECRET=true`, and re-run the Job. This is a
single-secret immediate cutover: the old secret stops minting at commit, and
tokens it already issued expire at their TTL. Update the consumer and `.env`, then
verify that the new secret mints and the old one is refused. Record the next due
date that the Job printed.

### Minting and using a token

```bash
# Basic auth (client_secret_basic) — also supports client_secret_post.
curl -s -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=client_credentials \
  -d 'scope=service:ping' \
  -d "resource=$RESOURCE_URI" \
  "$ISSUER/api/v1/auth/oauth/token"

# Call a protected resource-server route:
curl -s -H "authorization: Bearer $ACCESS_TOKEN" "$ISSUER/api/v1/auth/s2s/ping"
```

`resource` selects the token `aud`; it must be one of the client's
`resource_indicators`. Empty/absent `scope` grants the client's full
`allowed_scopes`.

### DPoP (recommended for production S2S)

Set `dpop_bound_access_tokens = true` on the service client and use
`@sentropic/auth-client` with `dpop: true`. The client sends a DPoP proof on the
token request and binds each resource call with an `ath` claim (RFC 9449). The
resource server enforces `ath` and replays via the DPoP jti store. DPoP is
opt-in in 39d but strongly recommended for any externally reachable S2S path.

### Secret rotation

```bash
make oauth-rotate-service-client CLIENT_ID=<client-id> ENV=<env>
```

This generates a new secret, prints it once, replaces `client_secret_hash`, and
stamps `secret_rotated_at`. Rotation is **single-secret immediate cutover**
(BR39d-D2): coordinate the consumer redeploy with the new secret. A
zero-downtime dual-secret grace window and an admin UI are deferred to BR-39g/39h.
Clients created by the governed provisioning Job rotate through that Job instead
(see the rotation cycle above), so that their secret is never printed.

### Stateless tokens — no revocation in 39d

Service tokens are **stateless** (BR39d-D5): the grant issues a signed Ed25519
JWT and writes **no** `oauth_tokens` row. There is no per-token revocation or
introspection for service tokens in 39d. The security controls are the short TTL
(`OAUTH_SERVICE_ACCESS_TOKEN_TTL_SEC`, default 900s) and secret rotation (which
stops new tokens but does not invalidate already-issued ones before expiry).
Service-token revocation + introspection are deferred to BR-39h, which reworks
the token tables under the unified identities model. Resource servers verify
statelessly via JWKS, so they have no DB dependency on the IdP.
