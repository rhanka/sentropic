# SPEC_EVOL — Secret key separation

> Status: DECIDED. Security remediation. The dependency order is owner-ratified and must not be weakened. No live, candidate, or historical secret value belongs in this document, logs, tests, or migration reports. The three already-public legacy fallback literals in Step 4 are reproduced only as an exhaustive deletion manifest and must never be used as test material.

> **Amendment 2026-07-31 — variable name, and what has since shipped.** The at-rest variable is `SECRET_ENCRYPTION_KEY`, ratified by the architect after verifying that code (`api/src/config/env.ts`, `api/src/services/secret-crypto.ts`), the delivery plane (`Makefile` `k8s-bundle-secret`, `docker-compose.yml`, `docker-compose.idp.yml`) and the env schema were already consistent on that spelling while only this document diverged. Earlier revisions said `CREDENTIAL_ENCRYPTION_KEY`; provisioning under that spelling would have made the resolver fall back to the legacy literal — and `spec:163` would still have passed, because the literal is the live production seed. That criterion is satisfiable by the *wrong* configuration; only `spec:166`, which proves the input is ACTIVE rather than merely declared, discriminates. Treat `spec:166` as the gate that counts.
>
> This document was untracked until now, so its mandate had no auditable source. It is committed as written, with one exception: the citation in D1 for the initial byte-identical value was retargeted from `secret-crypto.ts:8` to `:33`, because Step 1A moved that line and D1 rests on it. **Every other code citation below predates the merges listed here and should be read as the state at analysis time, not as current line numbers** — in particular the Step 4 deletion manifest, whose census of the public literal was taken before Steps 1A/1B landed.
>
> Shipped since: `#464` (`b4d21a422`) Steps 1A+1B — `secret-crypto.ts` no longer reads `JWT_SECRET` at all, versioned keyring, unknown `enc:*` versions rejected with a named error type, legacy plaintext passes but is counted; `#469` (`78b80398f`) Google Drive state sealing moved to `OAUTH_SIGNING_KEK` primary with an explicit production refusal; `#467` (`121c9237b`) upstream grant revocation; `#459` (`a9aa8b8e7`) ARCH-11 tenant resolution on the post-login resume. `main` green including `deploy-preprod`, so preprod runs the decoupled resolver — inert while the variable is unset, which is the point of Step 1A.
>
> **The first provisioned value must be the byte-identical legacy literal, not a generated secret.** A state-of-the-art generator here changes the seed and makes every stored `enc:v1:` envelope permanently undecryptable, silently, since GCM fails only on read. The generator belongs to Step 3, after the v2 reader is deployed everywhere, with re-encryption.

## 1. Objective

Separate stored-credential encryption and OAuth continuation-state sealing from `JWT_SECRET` before rotating `JWT_SECRET`, then migrate every stored third-party credential to a fresh at-rest key without losing data or leaving plaintext credentials behind.

The target boundary is:

- `SECRET_ENCRYPTION_KEY`: at-rest credential encryption only.
- `JWT_SECRET`: application-session signing, email-verification signing, Google Drive state HMAC, and future LLM stable-session derivation.
- `OAUTH_SIGNING_KEK`: IdP Ed25519 private-key encryption and, after this remediation, the primary OAuth continuation-state sealing key.

Two separately deployed production processes participate in the same authentication trust domain and are first-class rollout targets:

- the API deployment; and
- the separate `auth-idp` deployment, which runs the same image with `apps/auth-idp/dist/index.js`, composes the API auth/session modules, and receives environment variables from the same Kubernetes Secret.

A later per-protocol signing-key split is not required for this incident.

## 2. Decisions

- **D1 — decouple before either rotation.** `secret-crypto.ts` moves from `JWT_SECRET` to `SECRET_ENCRYPTION_KEY`. Its initial deployed bytes are the current repository fallback referenced at `api/src/services/secret-crypto.ts:33`; the value is intentionally not reproduced here.
- **D2 — preserve ciphertext and KDF bytes first.** Step 1 does not re-encrypt any row. The SHA-256 KDF, input encoding, AES-256-GCM parameters, and envelope parsing stay byte-identical. The injected `SECRET_ENCRYPTION_KEY` must be byte-exact: no trimming, newline insertion, base64 reinterpretation, or encoding conversion. A trailing newline changes the digest and makes every existing envelope unreadable.
- **D3 — keep OAuth state on the OAuth KEK.** Step 1 changes OAuth state resolution from `env.JWT_SECRET ?? env.OAUTH_SIGNING_KEK` to the transitional `env.OAUTH_SIGNING_KEK ?? env.JWT_SECRET`. Step 4 makes `OAUTH_SIGNING_KEK` required and deletes every JWT fallback arm from both OAuth-state and JWKS-KEK resolution. The final invariant is that changing or provisioning `JWT_SECRET` cannot change either consumer's KEK.
- **D4 — rotate `JWT_SECRET` across both deployments.** Provision one fresh, cryptographically random value of at least 32 bytes to every API and `auth-idp` replica in the same session trust domain. A Secret update alone is not a rollout; both deployments must restart onto the new value.
- **D5 — accept bounded auth invalidation.** Step 2 invalidates application sessions, email-verification tokens, Google Drive OAuth state, and any legacy OAuth continuation state not sealed by the configured `OAUTH_SIGNING_KEK`. OAuth state created after D3 under the unchanged KEK is not invalidated by the JWT rotation.
- **D6 — migrate at-rest encryption by expand/backfill/contract.** Readers use an explicit version dispatch, writers use only the fresh key once activated, and the backfill is idempotent, compare-and-swap, and reversible.
- **D7 — make completion structural.** A plaintext pass-through is never proof of decryption. Completion requires every eligible retained credential row to start with `enc:v2:` and authenticate with the fresh key; every non-envelope, unknown-version, malformed, or failed row is counted and blocks cutover.
- **D8 — treat encrypted and plaintext third-party credentials as potentially compromised.** Re-encryption limits future exposure; it does not repair historical exposure. A plaintext credential discovered in the database is more exposed than an `enc:v1` credential under this threat model and receives its own inventory, revocation, and reissue path.
- **D9 — enforce boot requirements and remove all public fallbacks last.** Only after both independent rotations, structural proof, and credential reissue do `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, and `OAUTH_SIGNING_KEK` become `z.string().min(32)` requirements; all JWT fallback arms for OAuth-state/JWKS-KEK resolution and all three legacy fallback spellings then disappear from active source/configuration.
- **D10 — do not re-key existing LLM leases.** Existing `llm_account_leases.stable_session_id` values are read from their rows and are not recomputed for lookup. The JWT rotation affects only future stable-session ids and does not orphan existing leases.
- **D11 — retain evidence, not secret material.** Reports contain deployment, table, row identifier, envelope classification, outcome, owner, and timestamp only. They never contain plaintext, ciphertext, tokens, keys, decrypted hashes, or test signing material.
- **D12 — use a dependency graph, not total serialization.** The allowed order is `Step 1 → (Step 2 in parallel with Step 3) → Step 4`. Steps 2 and 3 are independent after Step 1; Step 4 requires both to be accepted.

## 3. Scope

In scope:

- Effective environment measurement and rollout of both the API and the separate `auth-idp` deployments in both production clusters.
- API/IdP environment validation for the final required variables.
- The key resolver, KDF compatibility, envelope dispatch, and protected-call-site behavior in `api/src/services/secret-crypto.ts`.
- Every current credential reader and writer, including settings paths for which source currently shows a decrypting reader but no corresponding `encryptSecret` writer.
- OAuth continuation-state precedence in `api/src/routes/auth/oauth.ts`.
- The `JWT_SECRET` rotation and its application-session, verification-token, Google Drive state, OAuth-state, JWKS-readability, and future LLM-affinity effects.
- A read-only database inventory, reversible backfill, structural proof, and cutover.
- A separate plaintext-secret inventory and removal/reissue path.
- Upstream credential revocation/rotation and account reconnection.
- Fix-discriminating tests and a named repository/artifact secret scan.

Explicitly not changed:

- Ed25519 generation, token algorithms, JWKS table shape, or the use of PostgreSQL `pgp_sym_encrypt`/`pgp_sym_decrypt` for IdP private keys.
- OAuth client secrets as a protocol, DPoP, PKCE, refresh-token design, session schema, authorization policy, or account roles.
- Full separation of every signing/HMAC purpose into its own variable.
- Existing LLM lease identifiers or lookup behavior; no stable-session-id backfill is required.
- Ciphertext plaintext contents beyond envelope/key rotation.
- The stateful session, verification-code, OAuth-code, and Google Drive callback checks described in §4.4; they remain defense in depth.

## 4. Verified current state

### 4.1 At-rest helper and incomplete writer coverage

`secret-crypto.ts` derives its AES-256-GCM key by hashing `JWT_SECRET` or a repository fallback (`api/src/services/secret-crypto.ts:7-15`). It emits an `enc:v1` envelope with a random IV, GCM tag, and body and verifies the tag during decryption (`api/src/services/secret-crypto.ts:12-20,29-40`). Changing the seed makes existing tags fail.

The current reader returns any value not prefixed by `enc:v1:` unchanged (`api/src/services/secret-crypto.ts:22-23`). Consequently:

- plaintext is silently accepted as if it had been decrypted; and
- an `enc:v2:` value read by a pre-expand build is returned verbatim as the credential instead of failing.

The repository is public, so repository fallback material must be treated as public. Exposure still requires a database, dump, or other read path to stored values; the public key alone does not reveal a value the attacker cannot read.

Source proves these storage relationships, but it does not prove the format of live rows:

| Store | Proven source behavior | Current uncertainty |
|---|---|---|
| `settings.value` | `provider-connections.ts:190-198` encrypts its declared provider keys. `provider-credentials.ts:20,40-48` decrypts `ai_provider_key_user:<provider>:<userId>` and `ai_provider_key_workspace:<provider>:<workspaceId>`. `google-drive-oauth.ts:16,176-179` decrypts `google_drive_oauth_client_secret`. | The latter three key families are not in `provider-connections.ts:91-98`, and no repository writer was found that encrypts them. Production rows may be plaintext or an envelope. |
| `llm_provider_accounts.token_secret` | Writes call `encryptSecret` at `llm-account-transports.ts:368,460,791,858`; schema at `api/src/db/schema.ts:493-506`. | Live malformed or plaintext legacy rows are not verifiable from source. |
| `document_connector_accounts.token_secret` | Writes call `encryptSecret` at `google-drive-connector-accounts.ts:135,249`; schema at `api/src/db/schema.ts:461-474`. | Live malformed or plaintext legacy rows are not verifiable from source. |

Repository-wide, the only `encryptSecret` call sites found are `provider-connections.ts:197`, `llm-account-transports.ts:368,460,791,858`, and `google-drive-connector-accounts.ts:135,249`. Therefore this spec does not claim that all user/workspace provider settings or the Google Drive OAuth client secret are currently protected. It is correct whether the live rows are plaintext or `enc:v1`; the required read-only inventory decides which branch applies.

### 4.2 Key consumers and required target

| Purpose | Current behavior | Required behavior |
|---|---|---|
| At-rest credential encryption | `JWT_SECRET` or repository fallback in `secret-crypto.ts` | `SECRET_ENCRYPTION_KEY` only |
| Application-session signing/verification | `JWT_SECRET` or fallback in `session-manager.ts`; host port in `routes/auth/oauth.ts` | Fresh `JWT_SECRET`, shared by API and `auth-idp` |
| Email verification | `JWT_SECRET` or fallback | Fresh `JWT_SECRET` |
| Google Drive OAuth state | `JWT_SECRET` or fallback | Fresh `JWT_SECRET` |
| LLM stable-session derivation | `JWT_SECRET` or fallback | Fresh `JWT_SECRET` for future rows only |
| OAuth continuation state | `JWT_SECRET ?? OAUTH_SIGNING_KEK` at `routes/auth/oauth.ts:443-448` | `OAUTH_SIGNING_KEK ?? JWT_SECRET` |
| JWKS private-key KEK | `OAUTH_SIGNING_KEK` in production; `JWT_SECRET` outside production at `jwks-adapter.ts:152-163` | Existing keys must continue resolving to `OAUTH_SIGNING_KEK` in every environment where JWT rotates |

The seven direct consumer files remain `secret-crypto.ts`, `session-manager.ts`, `email-verification.ts`, `routes/auth/oauth.ts`, `google-drive-oauth.ts`, `llm-account-transports.ts`, and `services/auth/jwks-adapter.ts`.

The environment helper `isE2eProductionImageRuntime` can make `isProduction` false for a production image (`api/src/config/env.ts:199-205`). Because the non-production JWKS branch uses `JWT_SECRET`, rotating JWT in such a runtime can irreversibly orphan the encrypted Ed25519 private keys. Merely assuming that a production image follows the production branch is insufficient.

### 4.3 The second production deployment is part of the trust domain

`apps/auth-idp/idp-app.ts:31-33` imports `../../api/src/config/env` and `../../api/src/routes/auth`. It therefore composes the module-level JWT resolver in `api/src/routes/auth/oauth.ts:34-36` and the session path.

`deploy/k8s/base/35-auth-idp.yaml:72,94-105` defines a separate `Deployment auth-idp` with one replica, `Recreate` strategy, the same `sentropic-api` image, command `["node","apps/auth-idp/dist/index.js"]`, and `envFrom.secretRef: sentropic-api`. `apps/auth-idp/README.md:69-70` declares `JWT_SECRET` for session/state signing.

A Kubernetes Secret update does not restart either deployment. Rolling only API leaves the IdP process using the previous module-level key. That creates a split trust domain: the IdP can continue signing sessions or sealing state with the retired fallback while the API rejects it. API-only health checks cannot detect this.

### 4.4 Corrections to the incident assertions

The key-management defect is confirmed. These stronger exploit claims are not supported by the verified source and are not acceptance assumptions:

1. A public signing key is not an unconditional session-forgery path. Validation requires the exact full-token hash and session id to exist and resolves the effective role from the user row (`session-manager.ts:156-216`; `packages/auth-hono/src/middleware.ts:86-124`).
2. A forged email-verification JWT is insufficient by itself. Verification first requires the exact token in `email_verification_codes` (`email-verification.ts:211-230`).
3. `oauth.ts:323,331,335` do not sign OAuth authorization codes. Codes are random, persisted, and single-use (`packages/auth-hono/src/oauth/issue-authorized-code.ts:20-46`; `oauth-state-adapter.ts:32-46,137-152`).

Google Drive callback also requires a valid matching application session/user/workspace (`api/src/routes/api/google-drive.ts:225-240`).

LLM stable-session ids do not orphan. `computeStableSessionId` has one call site, its result is inserted into `llm_account_leases.stable_session_id`, and later reads use the stored row value. The lease id is independently generated, so an existing stable id is never recomputed for lookup. Rotation affects future values only.

## 5. Dependency-ordered remediation

### Global preconditions

Before Step 1 starts, and again immediately before any key-changing rollout:

1. Measure the effective, value-redacted environment of both `Deployment api` and `Deployment auth-idp` in both production clusters. Record image digest, command, referenced Secret/ConfigMap names, pod revision, variable presence, and effective key-source classification only. The prior API-only measurement is insufficient.
2. Set `OAUTH_SIGNING_KEK` in every environment where `JWT_SECRET` will change. From a real `auth-idp` replica, prove that the effective JWKS KEK source is `OAUTH_SIGNING_KEK` and that the existing private-key row decrypts before rotation. If runtime classification selects the non-production JWT branch, stop: correct the configuration or resolver path before changing JWT.
3. Run a read-only, value-redacted database inventory covering:
   - every `settings.value` matching `^enc:`, regardless of setting key;
   - every source-known secret-bearing settings key/pattern, including the provider-connections keys, `ai_provider_key_user:*`, `ai_provider_key_workspace:*`, and `google_drive_oauth_client_secret`;
   - every non-null `llm_provider_accounts.token_secret`; and
   - every non-null `document_connector_accounts.token_secret`.
   Report counts by key classification and envelope class only. Do not retrieve values into operator output.
4. Confirm backup/restore readiness, the rollback-key escrow mechanism, the maintenance control that can quiesce credential refresh writers, and owners for upstream credential revocation.
5. Resolve whether the two clusters share session and database trust domains. Key distribution and rollout grouping follow the measured trust domain, never an assumption.

The dependency graph is:

```text
Step 1A at-rest decoupling ─┐
                            ├─ Step 1 accepted ─┬─ Step 2 JWT rotation ─┐
Step 1B OAuth precedence ───┘                   └─ Step 3 at-rest rotation ─┤
                                                                          └─ Step 4 contract
```

Steps 2 and 3 may run in parallel after all Step 1 gates pass. Each has its own rollback and acceptance record in both clusters. A single rollout owner must enforce one explicit mutex covering `Deployment/api`, `Deployment/auth-idp`, and the shared `sentropic-api` Secret. The lanes may prepare and verify work in parallel, but every Secret write and every rollout must acquire that mutex and be serialized against the other lane; field-scoped Secret mutations must preserve the other lane's keys. Each `auth-idp` rollout is a full IdP outage because its single replica uses `Recreate`, so the owner must schedule and record that outage for every roll. Step 4 waits for both.

### Step 1A — decouple at-rest encryption without changing bytes

Change:

1. Add `SECRET_ENCRYPTION_KEY` as temporarily optional configuration.
2. Make `secret-crypto.ts` resolve only `SECRET_ENCRYPTION_KEY`, with the existing at-rest fallback retained temporarily for rollout compatibility. Do not read `JWT_SECRET` in this module.
3. Keep the KDF byte-for-byte identical: the same raw UTF-8 input bytes feed the same SHA-256 derivation. Do not trim or normalize.
4. Provision the initial compatibility bytes through the production secret pipeline to both deployment environments.
5. Explicitly roll both the API and `auth-idp` deployments. The IdP may not call the at-rest helper, but it runs the same image/config contract and must not be left on an unmeasured revision.

Why first: changing `JWT_SECRET` today changes the AES key. Decoupling with unchanged bytes removes that coupling without changing ciphertext or exposure.

Acceptance gate:

- Every API and `auth-idp` pod reports the expected image revision and presence/source of `SECRET_ENCRYPTION_KEY`, without its value.
- A real API replica using the production secret-injection path decrypts a pre-Step-1 reference envelope byte-for-byte and performs a new write/read round trip.
- The exact injected bytes succeed; a staging/canary injection with an added trailing newline fails the reference-envelope check. Neither run prints a key, digest, plaintext, or ciphertext.
- With a fixed at-rest key, changing only `JWT_SECRET` does not change legacy-envelope readability.
- With a fixed `JWT_SECRET`, changing only `SECRET_ENCRYPTION_KEY` changes fresh ciphertext authentication. This proves the new input is active rather than merely declared.

Rollback:

- Before either Step 2 or Step 3 changes a key, roll both deployments back to the prior resolver and remove the new variable; ciphertext is unchanged.
- After either downstream step starts, never roll back Step 1A alone. Keep the decoupled build or first complete the applicable downstream rollback. Re-coupling a fresh JWT to AES makes stored values unreadable.

### Step 1B — make the OAuth KEK primary for continuation state

Change:

1. Change `resolveOAuthStateSecret` to `env.OAUTH_SIGNING_KEK ?? env.JWT_SECRET`.
2. Keep `JWT_SECRET` only as the explicit non-production fallback when no OAuth KEK is configured.
3. Roll both API and `auth-idp`; both compose the OAuth module.
4. Leave the JWKS algorithms and stored keys unchanged.

Why now: today production happens to seal state with `OAUTH_SIGNING_KEK` only because `JWT_SECRET` is absent. Adding JWT without this inversion silently moves state sealing to JWT and recreates the coupling this spec removes.

Acceptance gate:

- With distinct, runtime-generated test keys configured for JWT and OAuth KEK, both API and `auth-idp` seal/accept state only with the OAuth KEK. State produced solely with the configured JWT is rejected.
- Cross-target flow succeeds: state initiated through the IdP is accepted by the intended API/IdP callback path.
- Regression guard only, not fix-discriminating evidence: a production-like real replica continues to report `OAUTH_SIGNING_KEK` as the state source without reporting its value. This observation can already pass when production has no `JWT_SECRET`; the discriminating check is §7.1 with both values present and distinct.
- Existing JWKS private keys remain decryptable from a real `auth-idp` replica.

Rollback:

- Before Step 2, the precedence-only change may be rolled back on both deployments while leaving key values unchanged.
- After Step 2, do not restore JWT-first precedence. Roll forward on the OAuth-state implementation or rotate the OAuth KEK and restart affected flows. Reverting precedence would permanently re-couple state sealing to JWT.

Step 1 is accepted only when both Step 1A and Step 1B gates pass in both clusters.

### Step 2 — rotate `JWT_SECRET` on API and `auth-idp`

Change:

1. Generate a fresh random value of at least 32 bytes in the approved secret manager.
2. Distribute it consistently to every API and `auth-idp` replica in each measured session trust domain. Keep `SECRET_ENCRYPTION_KEY` and `OAUTH_SIGNING_KEK` unchanged.
3. Explicitly roll both deployments in a bounded window. Account for the IdP's one-replica `Recreate` strategy and temporary authentication unavailability.
4. Reject every session, token, or state produced by a signing key that is not currently configured. Do not add dual verification for the retired JWT signer.

Why independent: Step 1 removed both at-rest and OAuth-state dependence on JWT. Step 2 no longer waits for the Step 3 database backfill.

Operational impact:

- Everyone is logged out; users authenticate again.
- In-flight email-verification tokens fail and users request a new code.
- Google Drive OAuth state fails and those flows restart.
- OAuth continuation state created after Step 1B under the unchanged OAuth KEK remains valid. Legacy state created under an unconfigured JWT/fallback signer is rejected.
- OAuth authorization codes already issued remain database-backed and are not cryptographically invalidated.
- Existing LLM lease rows remain usable; only future stable-session ids change.
- Stored third-party credentials remain readable through Step 1A/Step 3 readers.

Acceptance gate:

- A new login issued through `auth-idp` succeeds on a protected API route across the intended replica set.
- Every pre-rotation application session is rejected by the API and by the IdP session path.
- The IdP rejects a pre-rotation/fallback-signed session artifact and OAuth state produced by any signer other than the configured OAuth KEK. Tests generate old/new keys at runtime and never contain the repository fallback literal.
- Every API and `auth-idp` pod reports the new deployment revision and current JWT source without reporting its value.
- Google Drive state produced by an unconfigured signer is rejected.
- OAuth state sealed with the unchanged configured OAuth KEK remains accepted.
- A real `auth-idp` replica decrypts the existing JWKS private key before and after the JWT rotation; public JWKS identity is unchanged.
- Stored-credential reads still succeed independently of whether Step 3 has started.

Rollback:

- Roll application images/manifests back on both deployments only while preserving the fresh `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, OAuth KEK precedence, and `OAUTH_SIGNING_KEK`.
- If any `enc:v2:` row exists, an image rollback is bounded to post-expand images. A pre-expand image is deployable only after the §3.3 reverse-backfill gate proves zero v2, unknown-version, malformed, failed, and pending rows under quiescence.
- Never restore a public fallback. If the fresh value is malformed or suspected, replace it with another fresh value across both deployments and accept another logout.
- Restoring old sessions is intentionally not a rollback objective.

### Step 3 — rotate at-rest encryption, backfill, and reissue credentials

Step 3 may start as soon as Step 1 is accepted, whether or not Step 2 has completed.

#### 3.1 Expand: explicit-version read, fresh write

Introduce temporary `CREDENTIAL_ENCRYPTION_PREVIOUS_KEY` support and a new `enc:v2:` envelope.

- Before deploying the hard-fail reader, run the §3.2 structural classification over every candidate population. Deployment is gated on zero unresolved unknown-`^enc:` rows: each occurrence must be resolved or have a recorded, owner-approved disposition that prevents it from reaching a credential consumer.
- Before any v2 write, roll the expand build to both API and `auth-idp` and prove every pod is upgraded.
- Any value matching `^enc:` is an envelope. A recognized version is parsed strictly; an unrecognized version, malformed envelope, or failed tag returns a typed credential-envelope error and is never returned as plaintext. Every protected caller must convert that error to `null` or a recorded account-error state; it must never escape as an unhandled request-path exception.
- With no previous key configured, the expand build reads and writes `enc:v1:` for rollout compatibility.
- After every pod runs the expand build, set the active at-rest key to a fresh random value of at least 32 bytes and the previous key to the byte-exact legacy material in one controlled rollout. A Secret update is insufficient: explicitly roll both API and `auth-idp` and verify every pod revision before enabling v2 writes.
- For `enc:v1:`, decryption tries the fresh key first and then the previous key only after GCM authentication failure.
- With the previous key configured, every credential writer emits `enc:v2:` with the fresh key only.
- For `enc:v2:`, decryption uses the fresh key only.
- A non-envelope value may be classified temporarily as `plaintext_legacy` for inventory/remediation. Pass-through cannot satisfy backfill, proof, application acceptance, or cutover.
- Add or correct the settings write boundaries for `ai_provider_key_user:*`, `ai_provider_key_workspace:*`, and `google_drive_oauth_client_secret` so future retained values are encrypted. If the authoritative writer is outside the repository, block cutover until its encrypted-write contract is identified and verified.

#### 3.2 Structural inventory and compare-and-swap backfill

Use these row populations:

| Store | Row identity | Candidate predicate |
|---|---|---|
| `settings.value` envelope inventory | `(user_id, key)` | Any value matching `^enc:`, irrespective of key name |
| `llm_provider_accounts.token_secret` | `id` | Every non-null value |
| `document_connector_accounts.token_secret` | `id` | Every non-null value |

The settings predicate is structural, not an enumeration from `provider-connections.ts`. A newly introduced or previously omitted settings key with an envelope must be found automatically. The separate plaintext settings inventory is handled in §3.4 because plaintext cannot be recognized as secret by value shape alone.

For each recognized `enc:v1:` row:

1. Read the primary identity and original ciphertext.
2. Decrypt in memory with fresh-first/previous-second logic.
3. Encrypt to `enc:v2:` with the fresh key.
4. Decrypt the candidate with the fresh key and compare plaintext in memory.
5. In a transaction, update only when the primary identity and original ciphertext still match.
6. Commit one row or a bounded batch only after every row in that transaction verifies.
7. On failure, roll back, record metadata-only classification, and leave the original bytes unchanged.

An authenticated `enc:v2:` row is complete and skipped. Unknown versions, malformed envelopes, non-envelope protected-column values, and undecryptable values are reported and never mutated by this worker. A compare-and-swap loss is re-read and retried. No error path writes null, plaintext, a partial envelope, or an unverified candidate.

#### 3.3 Structural completion proof and cutover

Define the final eligible population as:

- every settings row structurally matching `^enc:`;
- every source/inventory-classified secret-bearing settings row that is retained;
- every retained non-null LLM account token; and
- every retained non-null document connector token.

Completion requires:

- Every eligible retained value starts exactly with `enc:v2:` and authenticates with the fresh key.
- Counts reconcile per store:
  `eligible = v2_authenticated + v1 + unknown_version + malformed + non_envelope + undecryptable + concurrent_retry`.
- The `non_envelope` count is always reported. Plaintext pass-through is never counted as authenticated.
- Two consecutive full scans report zero `v1`, unknown-version, malformed, non-envelope, undecryptable, and pending-retry rows.
- A real API replica with `CREDENTIAL_ENCRYPTION_PREVIOUS_KEY` disabled performs the same structural check and representative application reads.
- Representative token refreshes and credential reads succeed in both clusters.
- A fresh backup restore passes the same v2-only structural/authentication proof without exposing values.

Then remove `CREDENTIAL_ENCRYPTION_PREVIOUS_KEY` from deployment configuration, canary the API, and explicitly roll both API and `auth-idp`. Keep the previous key recoverably escrowed, not injected, for the bounded rollback window. Destroy it only after the window closes and §3.4 evidence is complete.

#### 3.4 Plaintext-secret inventory, revocation, and reissue

Maintain a separate read-only inventory for settings rows whose keys/patterns are known to carry credentials but whose values do not match `^enc:`. At minimum it covers:

- keys declared by `provider-connections.ts:91-98`;
- `ai_provider_key_user:<provider>:<userId>`;
- `ai_provider_key_workspace:<provider>:<workspaceId>`; and
- `google_drive_oauth_client_secret`.

Also classify non-envelope values in both protected `token_secret` columns as plaintext-secret candidates. Because source cannot establish live formats, both outcomes are valid inventory results; neither may be assumed.

For every plaintext-secret candidate:

1. Confirm the key classification without copying the value into output.
2. Revoke/rotate the upstream credential where supported.
3. Store the replacement through a verified v2-encrypting writer, reconnect the account, or delete the obsolete row.
4. If temporary continuity requires wrapping the old plaintext before reissue, use the same verify-and-CAS discipline; this does not satisfy upstream revocation/reissue.
5. Drive unresolved plaintext-secret counts to zero before final acceptance.

For every credential formerly protected by the public at-rest key, also revoke/rotate provider API keys and OAuth tokens where supported and reconnect affected accounts. Record provider, internal row/account id, outcome, owner, and timestamp only.

Operational impact:

- Forward dual-read backfill is online, bounded, throttleable, and pausable.
- Provider connections may be unavailable from revocation until reconnection.
- Re-encryption does not revoke an upstream token.
- A reverse rollback requires a maintenance window because live refresh writers must be quiesced.

Rollback:

- Before cutover, stop the worker. Mixed v1/v2 state remains readable only by the expand build.
- Never deploy a pre-expand reader while any v2 value exists: that reader returns `enc:v2:` verbatim as a credential.
- Before reverse backfill, quiesce and drain every credential writer, including Google Drive connector refresh writes at `google-drive-connector-accounts.ts:135,249`, LLM account refresh writes at `llm-account-transports.ts:791,858`, settings updates, reconnect flows, and migration workers.
- With writers proven quiescent, inject both keys into the expand build and run the same verified compare-and-swap algorithm in reverse: fresh decrypt, legacy encrypt, verify, update.
- Run two structural scans with writers still quiescent and prove zero v2, unknown-version, malformed, failed, and pending rows. Only then may both API and `auth-idp` roll back to the pre-expand image/configuration.
- If any writer cannot be quiesced, reverse rollback is unavailable; keep the expand build and roll forward.
- Upstream revocation is intentionally irreversible. Its rollback is a new authorization/reissue, never restoration of a revoked credential.

### Step 4 — contract boot configuration and remove every fallback literal

Precondition: Step 2 and Step 3 are both accepted in both clusters, plaintext-secret counts are zero, the rollback window is closed, and upstream reissue evidence is complete.

Change:

- Set `JWT_SECRET: z.string().min(32)`, `SECRET_ENCRYPTION_KEY: z.string().min(32)`, and `OAUTH_SIGNING_KEK: z.string().min(32)`.
- Delete the `?? JWT_SECRET`/`?? env.JWT_SECRET` fallback arms from OAuth-state resolution in `oauth.ts` and JWKS-KEK resolution in `jwks-adapter.ts`; both consumers resolve only `OAUTH_SIGNING_KEK`.
- Remove the at-rest fallback, the protected-call-site plaintext compatibility path, and the previous-key code path after escrow destruction.
- Keep hard failure for every unrecognized `^enc:` version.
- Remove all three already-public fallback spellings from active source/configuration.

> **STALE SNAPSHOT — REGENERATE AGAINST `main` AT EXECUTION TIME. Do not act on the table below.**
>
> Unlike the descriptive citations elsewhere in this document, which are a dated analysis snapshot and harmless as such, this table is a **normative action list**: it says what must be deleted. A wrong action list is dangerous where a stale citation is merely inert. It was taken before Steps 1A/1B landed and is already false — `secret-crypto.ts` no longer carries the literal on that line or reads `JWT_SECRET` at all, and the `oauth.ts` / `google-drive-oauth.ts` resolvers have both moved and changed shape.
>
> Refreshing it now would only re-stale it at every Step 2 and Step 3 merge. The list must be **derived at use, not stored** — which is the through-line of this whole remediation: never trust a stored snapshot of a living state.
>
> Derivation, to re-run when Step 4 is actually executed:
>
> ```sh
> git grep -n -F 'dev-secret-key-change-in-production-please' -- ':!spec/'
> git grep -n -F 'default-secret-change-in-production'        -- ':!spec/'
> git grep -n -F 'dev-idp-jwt-secret-change-in-production'    -- ':!spec/'
> ```
>
> Run against `main` on 2026-07-31, the derivation already finds sites the stored table never contained at all — not merely at different line numbers: a **second** occurrence in `oauth.ts` (both `:49` and `:473`, where the table carried one), and **two `Makefile` occurrences** of the IdP spelling that the table omitted entirely while listing only the compose file. Acting on the stored list would therefore have left public literals in place at Step 4. That is the concrete reason this list is derived and not stored.
>
> Each hit is either a site to strip or a deliberate exception to justify in the Step 4 record. Two classes of hit are expected and must be handled, not merely deleted:
>
> - **Byte-identity tests that spell a literal out on purpose.** `api/tests/unit/secret-crypto.test.ts` writes the at-rest literal verbatim so that editing it in the source breaks the test — that is the guard protecting the byte-identical mandate. Step 4 retires the literal and must retire that pinning in the same change, or Step 4 breaks its own tests.
> - **Local-only compose smoke targets.** The `Makefile` `JWT_SECRET` occurrences belong to `smoke-idp` / `smoke-idp-screens` and carry the *third* spelling, not the first. They never reach a deployed runtime and are a separate decision from the production fallbacks.
>
> The snapshot as taken at analysis time, kept for the record only:
>
> | Retired literal spelling | Locations at analysis time (NOT current) |
> |---|---|
> | `dev-secret-key-change-in-production-please` | `secret-crypto.ts:8`, `session-manager.ts:49`, `oauth.ts:35`, `llm-account-transports.ts:293`, `google-drive-oauth.ts:200`, `jwks-adapter.ts:157` |
> | `default-secret-change-in-production` | `email-verification.ts:175,228` |
> | `dev-idp-jwt-secret-change-in-production` | `docker-compose.idp.yml:39` |

The only permitted current-tree occurrences after implementation are the ones the derivation above deliberately keeps, recorded with a justification. They are retired public literals, not valid test fixtures, defaults, examples, or allowlisted runtime material.

- Add and run a repository-owned, Docker-first Make target for the redacted Gitleaks current-tree/artifact scan (for example, `make test-security-secrets`), with its exact Gitleaks version and ruleset recorded. Its allowlist may identify only the three exact manifest occurrences above; it may not allow any active-code/configuration occurrence.
- Explicitly roll both API and `auth-idp` after the Secret/schema/config changes.

Operational impact: correctly configured pods restart normally. A missing or short required value fails both entrypoints at boot. The IdP's `Recreate` rollout can briefly interrupt authentication.

Rollback:

- Revert schema strictness on both deployments only if integration is defective, while preserving all fresh keys, OAuth precedence, strict envelope dispatch, and encrypted rows.
- If legacy-row evidence appears, restore the expand build and previous-key injection, then return to Step 3 proof.
- Never restore any retired public literal, plaintext pass-through for protected stores, or JWT-first OAuth-state precedence.

## 6. Acceptance criteria

The remediation is accepted only when every statement below is evidenced:

1. A two-sided runtime test proves the at-rest resolver depends on `SECRET_ENCRYPTION_KEY`, not merely a renamed variable: fixed at-rest key/two JWT values preserve v1 readability, while fixed JWT/two at-rest keys change fresh-envelope authentication. This test fails against the current coupled resolver.
2. Missing, empty, and fewer-than-32-byte `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, or `OAUTH_SIGNING_KEK` values fail both API and `auth-idp` boot after Step 4.
3. Both production clusters have value-redacted effective-environment and rollout evidence for every API and `auth-idp` pod.
4. Rotating only `JWT_SECRET` leaves every retained stored credential structurally readable.
5. With fixed `JWT_SECRET`, changing only `SECRET_ENCRYPTION_KEY` changes fresh ciphertext authentication while an existing application session remains valid. This cannot pass as a no-op against the current code because the new variable is currently ignored.
6. Every pre-Step-2 session is rejected by both trust-domain targets; every newly issued session is accepted across the intended API/IdP replica set.
7. The IdP rejects artifacts produced by the retired/fallback signer, using runtime-generated pre-rotation material rather than a repository literal.
8. With both variables configured, OAuth continuation state is sealed/verified by `OAUTH_SIGNING_KEK`; changing JWT alone does not change that behavior, and no JWT fallback arm remains.
9. Existing Ed25519 private keys decrypt through `OAUTH_SIGNING_KEK` on a real `auth-idp` replica before and after JWT rotation, including production-image E2E runtime classification; changing JWT alone cannot change JWKS KEK resolution.
10. Every eligible retained credential value starts with `enc:v2:` and authenticates with the fresh key; completion reports zero v1, unknown-version, malformed, non-envelope, undecryptable, or pending rows.
11. The separate plaintext-secret inventory reports zero unresolved credential rows, and every formerly plaintext writer path emits v2.
12. A simulated GCM-tag failure leaves the original row byte-for-byte unchanged and emits metadata-only evidence.
13. A simulated stop after any committed batch resumes idempotently without double transformation or value loss.
14. A concurrent write loses compare-and-swap, is re-read, and is never overwritten with stale plaintext.
15. Reverse backfill refuses to start while refresh writers are live and proves zero v2 rows under quiescence before any pre-expand reader is deployable.
16. The repository-owned Docker-first Make target runs Gitleaks in redacted current-tree/artifact mode with its exact version and ruleset recorded and reports zero unallowlisted secret material; logs, traces, reports, and snapshots contain no key, token, plaintext credential, ciphertext, or decrypted hash. Tests generate signing material in memory. The only literal allowlist is this spec's three retired deletion-manifest entries.
17. A current-tree exact scan finds each of the three retired fallback spellings only in this deletion manifest and nowhere in active source, tests, examples, or configuration.
18. Every affected upstream credential has revocation/rotation and reissue evidence, or a named blocking exception with owner and deadline; an exception blocks final acceptance and previous-key destruction.
19. Exact persisted session-token, verification-token, OAuth-code, and Google Drive callback checks remain covered and passing.
20. Existing LLM leases remain readable from stored `stable_session_id` values; no re-key/recompute migration is introduced, and only future ids change.
21. Any `^enc:` value with an unrecognized version produces the typed credential-envelope error in every reader and is never returned as a credential; protected callers convert it to `null` or a recorded account-error state without an unhandled request-path exception.
22. The byte-exact production injection gate runs against a real replica and proves the unchanged KDF; a newline-altered injection cannot pass.

## 7. Required negative tests

### 7.1 Fix-discriminating tests: fail before, pass after

No test contains a live or retired repository key literal. Generate distinct keys in memory and discard them after the test.

- Two-sided resolver test: changing JWT breaks a legacy envelope before Step 1 and no longer breaks it after; changing only `SECRET_ENCRYPTION_KEY` is ignored before Step 1 and changes envelope authentication after.
- OAuth precedence test: with both JWT and OAuth KEK set, current code seals with JWT; the remediated code seals with the OAuth KEK and rejects JWT-only state.
- IdP rollout test: a session issued by `auth-idp` under runtime-generated key A is rejected by both IdP and API after both restart on key B. Omitting the IdP restart must make the gate fail.
- Unknown-envelope test: a synthetic `enc:v99:` value is returned unchanged by the current pass-through and produces the typed credential-envelope error after expand; each protected request-path caller converts it to `null` or a recorded account-error state instead of returning a 500.
- Structural-proof test: a plaintext eligible row currently “decrypts” through pass-through; the remediated completion gate classifies it as `non_envelope` and fails.
- Structural-settings test: an envelope under a settings key absent from `provider-connections.ts:91-98` is missed by the old enumerated predicate and found by the `^enc:` predicate.
- Writer-coverage test: user-scoped provider, workspace-scoped provider, and Google Drive OAuth client-secret writes must persist v2. The test fails until their actual persistence boundaries encrypt.
- Reverse-backfill test: an active simulated refresh writer makes rollback refuse to start; after quiescence, reverse CAS and the zero-v2 proof pass.
- Boot tests: both entrypoints currently accept an absent `SECRET_ENCRYPTION_KEY`; after Step 4 they reject absent, empty, and short `JWT_SECRET`, `SECRET_ENCRYPTION_KEY`, and `OAUTH_SIGNING_KEK` values.
- Legacy-literal test: the exact current-tree scan fails while any of the three spellings remains outside this spec and passes only after all active fallbacks are deleted.
- Byte-exact injection test: the real-replica reference envelope succeeds with exact bytes and fails when the delivery pipeline appends a newline.

### 7.2 Security invariants: already pass before and must remain passing

These are not red-before tests for this incident and must not be represented as proof of a pre-fix auth bypass:

- A forged session token without its exact persisted token hash is rejected (`session-manager.ts:156-170`).
- A forged email-verification token absent from `email_verification_codes` is rejected (`email-verification.ts:215-224`).
- An OAuth authorization code absent from the database, expired, or already used is rejected (`oauth-state-adapter.ts:32-46`).
- A Google Drive callback without a valid matching application session/user/workspace is rejected (`routes/api/google-drive.ts:225-240`).
- Existing LLM leases are read by stored id and are not recomputed for lookup.

## 8. External dependencies and unverified facts

Externally supplied facts:

- The prior Kubernetes measurement covered the API deployment, the 36-key `sentropic-api` Secret, and the 15-key `api` ConfigMap in Scaleway and OVH and reported `JWT_SECRET` absent. It did not measure the separate `auth-idp` deployment and is therefore not sufficient to authorize Step 1 or Step 2.
- GitHub reported `github.com/rhanka/sentropic` as public on 2026-07-27; repository text also describes the project as open source.
- Repository source verifies the separate `auth-idp` manifest/import topology. Its live effective environment remains external state.

Must be measured before rollout:

- The value-redacted effective environment, image revision, runtime classification, and key-source selection of both API and `auth-idp` in both clusters.
- Presence of `OAUTH_SIGNING_KEK` in every environment where JWT changes, plus real-replica proof that JWKS private keys resolve through it.
- A read-only settings inventory separating `enc:v1`, other `^enc:` versions, malformed envelopes, non-envelope values under known secret-bearing key patterns, and non-secret settings. No row value may enter output.
- Non-null token-column counts and their envelope classifications.
- Production row counts, backup readiness, restore time, migration duration, and writer-quiescence controls.
- Whether Scaleway and OVH share one session/database trust domain.
- Which upstream providers support immediate revocation versus rotation/reconnection.
- Whether the approved secret pipeline preserves exact bytes and can distribute/restart both deployments coherently.

Not verified and not claimed:

- Whether any attacker obtained a production database, dump, ciphertext, session token, or credential.
- Whether the public fallback protected every historical ciphertext.
- Whether the source-known user/workspace provider keys or Google Drive OAuth client secret are plaintext or encrypted in production; the spec is deliberately correct under both branches.
- Exploitation in logs or an unconditional session/email takeover path.

Any failed external assumption stops only the affected dependent step. It does not permit bypassing Step 1, destroying the previous key without structural proof, deploying a pre-expand reader over v2 data, or proceeding to Step 4 before both parallel branches are accepted.
