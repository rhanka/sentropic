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
