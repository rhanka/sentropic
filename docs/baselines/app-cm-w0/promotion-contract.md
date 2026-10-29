# P verifier, acceptance and key contract

P remains a required TG slot. W0's read-only GitHub API observations at 23:26 UTC found only `github-pages`, `sentropic-idp-prod`, `sentropic-idp-run`; no app `production` Environment or qualified equivalent promotion receipt exists in this evidence. `main` protection requires `changes`, `enforce-package-bump`, `validate-publishable-manifests`, `ci-gate`, with strict checks and force-push/deletion disabled. No repository or Environment configuration was changed.

## Canonical verifier pin and vectors

Consume **`@sentropic/h2a@0.98.6`**, the registry `latest` observed in W0, with the exact tarball/integrity in `published-tuple.json`. Do not consume the host's unpublished `0.98.7-rc.4` merely because it is installed. Both versions' observed primitive hashes happen to agree; the published package was installed and its public exports exercised independently in a disposable container.

Public API: `createEnvelope`, `signEnvelope`, `verifyEnvelopeSignature`, `isH2AEnvelope`, `canonicalize`, `computeHash`. Implementation bytes in the published archive:

| File | SHA-256 |
|---|---|
| `dist/canonical.js` | `5ba272e3b44cff97672341f8ea377cbdf9b714d60bf16cf477f2cdac4ba29f20` |
| `dist/signature.js` | `fa5d6f48baf170a4b349adf41592747e4ebb2bc9acba7ff6983ffc4ff254fe00` |
| `dist/envelope.js` | `b6a48e52fa154ce5e73097aba9b3c1a4968210f94b2ba0a90ce0b8488e4b1048` |

`computeHash(manifest)` returns `sha256:<hex>` over h2a's recursively key-sorted JSON, excluding undefined object fields and rejecting nonfinite numbers. Preserve array order; accept only JSON data for release inputs. `signEnvelope` signs the canonical envelope **excluding only `signatures`**, so actor, timestamps and the body manifest hash are covered. `verifyEnvelopeSignature(envelope, publicKeyPem, {by: signerInstance})` checks Ed25519; it does not establish trust, expiry, revocation or receipt success. Use this existing format; no string comparison, custom canonicalizer or second detached-signature format.

[verifier-vectors.json](verifier-vectors.json) pins a synthetic manifest, public fixture key, signed envelope and four exercised cases: valid true; altered manifest hash false; wrong signer false; missing signatures false. Its private key existed only in process memory and was discarded. The fixture signer/key is **never** authorized for a release. These vectors prove the primitive, not P's authorization policy or a production acceptance.

## Envelope and protected trust data

The selected h2a envelope has `type: event`, `actor.instance` equal to the authorized signer, `createdAt`, and body `kind: app-release-acceptance`, `schemaVersion: 1`, `manifestHash`, `repository`, `sourceSha`, `workflowSha`, `targetEnvironment`, `expiresAt`, `receiptIds`. `manifestHash` covers the entire canonical release manifest. The verifier rejects unsupported schema, missing/invalid fields or dates, signer/actor mismatch and any context mismatch before checking referenced successful receipts. SC generates it only after independent reviews and qualification close.

TG owns protected-main `scripts/release/acceptance-trust.json`: public signer instance, SPKI PEM public key and SHA-256 fingerprint of its DER bytes, validity interval, explicit revocation state, allowed repository/environment/action and policy version. Under the owner's [Q3/Q4 answers](owner-decisions.md), the owner signs qualified acceptance himself from an instance he designates, using a new dedicated acceptance identity/key with its own revocation cycle. This signature is distinct from his native GitHub production approval. The public-key source will be that dedicated identity's h2a public export, bound to the owner's acceptance role. CI never receives a signing key, registry private material or model/provider credentials. Do not trust a key embedded in the input envelope, a PR branch's trust file or a self-asserted actor.

**B05 owner decisions are settled; enrollment remains later:** Q3 names the owner as signer and Q4 selects a new dedicated key. Dedicated-key enrollment is a later authorized action, outside this W0 documentation task; W0 creates no identity or key. Designated instance: **PENDING — owner designation at enrollment**. SPKI DER SHA-256 fingerprint: **PENDING — populate only after dedicated-key enrollment**. That later action records the public export, fingerprint, validity/revocation policy and role binding before reviewed protected-main installation in P. Its revocation cycle is dedicated to the acceptance role. No private key belongs in W0 records, the repository, review artifacts or CI; none is collected here.

The deferred public fingerprint is not an unresolved W0 owner choice. No fixture, installed host key, conductor label or possession of a valid h2a key substitutes. P implementation can use fixtures; production validation fails closed until enrollment and reviewed trust installation are complete. Refresh revoked/expired key policy before use and after the approval wait.

## Release manifest and gated execution

Required manifest fields: repository; full merged source and workflow SHA; target namespace/environment; API/UI/IdP/content `@sha256` images and commands; package/lock hashes; rendered manifests/environment-specific config hashes; migration IDs/checksums plus expected live frontier; previous deployable tuple; allowed stop/fence/rollback actions; owner-path, isolation, restore, rollback and review receipt IDs/hashes. API = IdP = content image digest; UI has its own digest. Receipts resolve to successful qualification of these exact bytes. Any source/config/tuple change invalidates acceptance and production GO.

New `.github/workflows/release-prod.yml` accepts `app_ref`, immutable manifest/evidence refs, `release_kind: app|app_no_migration|rollback`, and `probe_only`. Protected-main/ref validation and a credential-free job publish exact manifest hash/tuple/evidence before approval. Deployment has `needs` validation and `environment: production`; diagnostics are mutually exclusive with deployment. Required reviewer `rhanka`, main-only restrictions, disabled admin bypass and a protected release-tag ruleset are operator configuration gates, not supplied by this PR.

Immediately after approval, revalidate the identical manifest, envelope, trust state and receipt bytes before credential decoding/use. Production namespace credentials exist only behind the Environment; inventory/remove bypassing automation routes. Preprod/PR credentials cannot write production. Pin from successful main publication once, qualify in preprod and promote without rebuild or mutable-tag resolution. The existing raw `make k8s-deploy` is not this mechanism.

The tenant operator checks live frontier/prior tuple and takes/verifies fresh database backup and object checkpoint. API alone runs W1's additive migrations through one executor/journal under a writer fence before scaling; IdP/content never migrate. `app_no_migration` proves unchanged frontier. Migration permissions name IDs explicitly. Rollback uses the same native gate and an approved previous manifest, preserving committed artifacts and deny state; destructive live restore requires separate authority.

## TG and W5 gates retained

- `scripts/release/tests/verify-acceptance.test.mjs`: missing/bad/expired/revoked signature; signer/key mismatch; wrong repo/environment/source/workflow; changed digest/config/receipt; absent/failed qualification; stale frontier; revalidation after approval.
- `scripts/test-app-release-gate.sh`: alternate tag/ref denial, workflow/Environment structure, preprod credential production-write denial and isolated positive promotion/rollback rehearsal.
- After TG is merged with its own owner GO, `probe_only=true` records the native unapproved Environment barrier and is then rejected/cancelled without deployment. Operator configuration/RBAC receipts and this probe gate TG exit; W5 needs separate G-PROD, live approval/run receipts and 24 h observation.
