# GitHub App enrollment operator runbook (SG0-app)

Implements G0 v3 §2.7. The first registry targets are `rhanka/radar-immobilier`
and `rhanka/sentropic`, with separate storage scopes, opaque repoIds and
enrollment references. No App or installation is created by deploying this code.
Creation starts only when the authenticated owner submits the manifest to GitHub.

## Cluster-mesh host composition

Mount `createGitHubAppRouter` at the cluster-mesh public HTTPS origin. Do not mount
it in the artifacts service or a build worker. Inject:

- `resolveOwner(request)`: authenticate the human session, resolve the repository
  from the trusted host registry and verify current owner authority. Return the
  ownerId, storageScopeId, repoId and locator. On callbacks resolve the same target
  from the enrollment reference and current owner session; changing the active
  workspace must not grant another scope. Browser JSON never selects a locator.
- `authenticateBroker(request)`: authenticate the SG0-net trusted service using
  the host service identity boundary (for example mTLS), then resolve its permitted
  scope/repo tuple. Never derive service identity from unverified request headers.
- `createEncryptedGitAppCustodian({ store, key })`: the key is borrowed from the
  host secret custodian, referenced by name, such as `secret-crypto:v1`. The key
  is 32 bytes; a domain-specific HKDF key encrypts each enrollment with AES-GCM.
  Do not copy the key into artifacts, module metadata or a worker environment.
- `store.transaction(ref, action)`: provide durable, serializable transactions
  shared by all cluster-mesh replicas. Persist the returned ciphertext and result
  atomically. Enforce uniqueness on the enrollment reference. An existing row is
  locked for the entire action, including forge calls; concurrent callback replay
  must not pass on another replica. There is no in-memory production store.
- `onCredentialsChanged(event)`: idempotently discard adapter caches and fence
  dependent publication jobs for the supplied scope/repo/ref and credential epoch.
  A failed notification or token revocation leaves enrollment closed. Retry the
  owner `revoke` operation for the same ref to drain the retained revocation cache.
  A key-rotation failure that closes enrollment requires the owner enrollment flow.

Create the service with `createGitHubAppEnrollment({ custody, github:
createGitHubAppApi(), publicBaseUrl, onCredentialsChanged })`. The host must retain
the returned enrollment reference in its repository registry. Persisted custody
contains the actual App identity, private key, webhook secrets and installation id;
the artifacts registry receives only `installationRef`, `webhookSecretRef` and
sanitized status. Ciphertext is authenticated to its reference to prevent swapping.

Disable query/body/header capture for these routes at every access-log and tracing
layer: manifest callbacks contain a conversion code; installation callbacks contain
the installation id; key upload and webhook configuration contain secret material.
Neither this router nor the REST adapter logs them. Responses set `no-store` and
`no-referrer`; provider error bodies and transport error text are suppressed.

## Exact owner gesture and prompt location

The owner opens `<cluster-mesh HTTPS origin>/github-app` in an authenticated owner
session for the intended registered repository. The page shows **Enroll
rhanka/radar-immobilier** or **Enroll rhanka/sentropic**, using the host registry.
Clicking it starts a scope-bound enrollment and redirects to the `promptUrl`:
`/github-app/<installationRef>`. Host administration UI may also display that
returned URL as its enrollment prompt link. It grants no access without owner auth.

1. On the prompt page, click **Enroll <repository>**. This posts a nonsecret App
   manifest to GitHub's App-creation page under the signed-in owner's account.
2. Review the GitHub App creation screen and approve **Create GitHub App**; complete
   GitHub 2FA when requested. Cluster-mesh receives the manifest conversion code,
   exchanges it server-side and keeps the returned credentials in encrypted custody.
3. The callback redirects to GitHub's installation screen. Choose **Only select
   repositories**, select exactly the intended repository, and approve **Install**.
   Complete any GitHub-required additional consent. Do not choose all repositories.
4. GitHub returns to the installation callback. Cluster-mesh verifies the state,
   App/installation identity, exact permissions and selected repository, then drops
   the callback query and redirects to `/github-app/<installationRef>/status`.
   Only `ready` permits leases. Retain the opaque references in the host registry.
5. Repeat in the other repository's owner scope. Never reuse the first scope's ref.

There is no PEM copy, installation-id entry or token paste during enrollment.
Callback states expire after ten minutes and are consumed once, even on a provider
failure. A failed or expired flow must be restarted by its owner.

P2's real GitHub prompt count and one-approval-click target remain **unverified**.
The screens above are the operator path to witness, not a claimed live receipt.
The fake GitHub suite proves local protocol behavior only. Record actual screens,
2FA and forge receipts before activation; no real enrollment was run for this wagon.

## Lease and verification composition

Inject only `{ acquire: service.acquire }` as `GitInstallationLeasePort` and
`{ verify: service.verify }` as `GitWebhookVerificationPort`. Never inject the
enrollment administration service into artifacts. The equivalent authenticated
HTTP routes are `POST /github-app/broker/lease` and `/github-app/broker/verify`;
the latter encodes rawBody as canonical base64 on the wire, returning only validity
and an opaque secret version. The lease JSON admits only the frozen three fields.

Every mint requests one repository id and exactly `contents:write` plus
`metadata:read`; the adapter reads the resulting token's repository inventory and
rejects extra repositories or permissions. App grants are rechecked on every mint.
Tokens expire within one hour, are never cached for reuse, and are retained only
in encrypted custody until expiry or revocation so all issued leases can be revoked.
Artifacts receives only the short-lived token response. It still checks expiry,
repo/permission equality and current epoch, and enforces branch/path/principal/CAS
rules before forge access. A1 contents permission itself is repository-wide.

## Rotation and revocation

Open `/github-app/<installationRef>/rotation` as the current repository owner.

For an App key, use GitHub App settings to generate the next private key. Upload
the downloaded PEM file through **Verify and switch App key**; do not paste it into
a terminal, report or environment. Cluster-mesh verifies RS256 authentication against
the same App id, switches custody, changes the credential epoch, invalidates host
caches/jobs and revokes issued leases. Verify a fresh repository lease through the
trusted host. Then delete the previous key in GitHub App settings and remove the
downloaded replacement file from the owner device. Erasing the old local custody
copy alone does not retire the old forge key. P2 must witness GitHub key provisioning
and retirement; no API for generating/deleting GitHub private keys is assumed here.

For the webhook secret, click **Stage webhook secret (10 minute overlap)**.
Cluster-mesh generates the next secret internally, persists it, and accepts both
versions until the recorded overlap deadline. Click **Switch GitHub webhook sender**
to update GitHub's App hook configuration, then verify a delivery. Retry this switch
if GitHub is unavailable; do not stage another version during the overlap. Once
the recorded window closes, use **Retire previous webhook secret**. Verification
also erases an expired previous version when used. The old secret never verifies
after its deadline. A late sender switch requires operator recovery before use.

**Revoke enrollment** closes new leases, changes the epoch, fences host jobs/caches
and revokes outstanding tokens. Signed installation deletion/suspension, removal of
the enrolled repository, or changed permissions also close leases. Forge access is
revalidated at every acquire to catch a missed webhook. Failed revocations remain
in encrypted custody for retry; never clear them by substituting a personal token.
Re-enrollment requires a new owner flow; no credentials are silently reused.

Before SG2 uses a real installation, retain P2 receipts for both repositories,
cross-repo refusal, permission denial, expiry/renewal, revocation/uninstall and both
rotations. A1 activation separately requires the contract's P7 and IG1 gates.
